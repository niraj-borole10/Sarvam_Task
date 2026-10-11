import { config } from "./config.js";
import { HEALTHCARE_AGENT_SYSTEM_PROMPT } from "./system-prompt.js";
import { TOOL_DEFINITIONS, executeTool } from "./tools.js";
import { createChatCompletion } from "./sarvam-client.js";

const MAX_TOOL_ROUNDS = 4;
const MAX_MESSAGES = 20;

export async function workflowRequest(method, path, body, query = undefined) {
  if (!config.workflowApiUrl) {
    const error = new Error("Healthcare workflow service is not configured");
    error.statusCode = 503;
    throw error;
  }
  const url = new URL(`${config.workflowApiUrl}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  }
  const headers = { accept: "application/json" };
  if (config.workflowApiToken) headers.authorization = `Bearer ${config.workflowApiToken}`;
  if (method !== "GET") headers["content-type"] = "application/json";

  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(config.requestTimeoutMs),
    });
  } catch {
    const error = new Error("Healthcare workflow service is unavailable");
    error.statusCode = 502;
    throw error;
  }
  const responseText = await response.text();
  let data;
  try {
    data = responseText ? JSON.parse(responseText) : {};
  } catch {
    const error = new Error("Healthcare workflow service returned an invalid response");
    error.statusCode = 502;
    throw error;
  }
  if (!response.ok) {
    const error = new Error(`Healthcare workflow request failed (${response.status})`);
    error.statusCode = response.status === 404 ? 404 : 502;
    throw error;
  }
  return data;
}

function validationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function normalizeMessages(input) {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_MESSAGES) {
    throw validationError(`messages must contain between 1 and ${MAX_MESSAGES} items`);
  }
  return input.map((message) => {
    if (!message || !["user", "assistant"].includes(message.role)
        || typeof message.content !== "string" || !message.content.trim()
        || message.content.length > 4000) {
      throw validationError("Each message must have role user/assistant and non-empty text under 4,000 characters");
    }
    return { role: message.role, content: message.content.trim() };
  });
}

export async function runConversation(inputMessages) {
  const messages = [
    { role: "system", content: HEALTHCARE_AGENT_SYSTEM_PROMPT },
    ...normalizeMessages(inputMessages),
  ];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const response = await createChatCompletion(messages, TOOL_DEFINITIONS);
    const assistant = response.choices?.[0]?.message;
    if (!assistant) throw new Error("Sarvam returned an empty chat response");

    const toolCalls = assistant.tool_calls ?? [];
    if (toolCalls.length === 0) {
      if (typeof assistant.content !== "string") throw new Error("Sarvam returned no reply text");
      return assistant.content;
    }

    messages.push({
      role: "assistant",
      content: assistant.content ?? null,
      tool_calls: toolCalls,
    });

    for (const call of toolCalls) {
      let result;
      try {
        const args = JSON.parse(call.function.arguments);
        result = await executeTool(call.function.name, args, workflowRequest);
      } catch (error) {
        result = { ok: false, error: error.message || "Tool execution failed" };
      }
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }
  }
  return "I could not complete that request in this conversation. Please contact the care team for help.";
}


