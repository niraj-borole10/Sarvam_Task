import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { config } from "./config.js";
import { runConversation, workflowRequest } from "./agent-orchestrator.js";
import { synthesizeSpeech, transcribeAudio, translateText } from "./sarvam-client.js";

const LANGUAGES = new Set(["en-IN", "hi-IN", "ta-IN", "te-IN", "kn-IN", "mr-IN", "bn-IN", "gu-IN"]);
const AUDIO_TYPES = new Set(["audio/wav", "audio/mpeg", "audio/mp4", "audio/ogg", "audio/webm", "audio/flac", "audio/aac"]);
const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
const STATIC_ASSETS = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
]);

function json(response, status, payload) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  if (!request.headers["content-type"]?.toLowerCase().includes("application/json")) {
    const error = new Error("Content-Type must be application/json");
    error.statusCode = 415;
    throw error;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > config.maxBodyBytes) {
      const error = new Error("Request body is too large");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    const error = new Error("Request body must be a JSON object");
    error.statusCode = 400;
    throw error;
  }
}

function isAuthorized(request) {
  const header = request.headers.authorization ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return false;
  const presented = Buffer.from(match[1]);
  const expected = Buffer.from(config.apiAuthToken);
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}

function validateLanguage(value) {
  const language = value ?? "en-IN";
  if (!LANGUAGES.has(language)) {
    const error = new Error(`language_code must be one of: ${[...LANGUAGES].join(", ")}`);
    error.statusCode = 400;
    throw error;
  }
  return language;
}

function validateCampaign(body) {
  const invalid = (message) => { const error = new Error(message); error.statusCode = 400; return error; };
  const allowed = new Set(["post_appointment_followup", "preventive_care", "reengagement"]);
  if (!allowed.has(body.campaign_type)) throw invalid("Invalid campaign_type");
  if (!Array.isArray(body.patient_ids) || body.patient_ids.length < 1 || body.patient_ids.length > 500
      || body.patient_ids.some((id) => typeof id !== "string" || !id.trim() || id.length > 128)) {
    throw invalid("patient_ids must contain 1 to 500 non-empty identifiers");
  }
  if (new Set(body.patient_ids).size !== body.patient_ids.length) throw invalid("patient_ids must be unique");
  if (typeof body.message_template_id !== "string" || !body.message_template_id.trim()) {
    throw invalid("message_template_id is required");
  }
  if (body.scheduled_time !== undefined && Number.isNaN(Date.parse(body.scheduled_time))) {
    throw invalid("scheduled_time must be a valid ISO 8601 date/time");
  }
}

async function serveStatic(pathname, response) {
  const asset = STATIC_ASSETS.get(pathname);
  if (!asset) return false;
  const [filename, contentType] = asset;
  const contents = await readFile(new URL(`../public/${filename}`, import.meta.url));
  response.writeHead(200, {
    "content-type": contentType,
    "cache-control": "no-cache",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    "referrer-policy": "no-referrer",
  });
  response.end(contents);
  return true;
}
async function handle(request, response) {
  const url = new URL(request.url, "http://localhost");
  if (request.method === "GET" && await serveStatic(url.pathname, response)) return;
  if (request.method === "GET" && url.pathname === "/healthz") {
    return json(response, 200, { status: "ok" });
  }
  if (!isAuthorized(request)) return json(response, 401, { error: "Unauthorized" });

  if (request.method === "GET" && url.pathname === "/api/v1/session") {
    return json(response, 200, { authenticated: true });
  }

  if (request.method === "POST" && url.pathname === "/api/v1/chat") {
    const body = await readJson(request);
    const language = validateLanguage(body.language_code);
    const messages = Array.isArray(body.messages)
      ? body.messages
      : typeof body.message === "string" ? [{ role: "user", content: body.message }] : null;
    if (!messages) return json(response, 400, { error: "Provide messages or message" });
    const reply = await runConversation(messages);
    const result = { reply, language_code: language };
    if (body.voice_reply === true) {
      try {
        result.audio_base64 = await synthesizeSpeech(reply, language);
      } catch {
        result.audio_error = "Voice playback is unavailable right now; the text reply is ready.";
      }
    }
    return json(response, 200, result);
  }

  if (request.method === "POST" && url.pathname === "/api/v1/voice/webhook") {
    const body = await readJson(request);
    const language = validateLanguage(body.language_code);
    let transcript = body.transcript;
    if (body.audio_base64 !== undefined) {
      if (typeof body.audio_base64 !== "string" || body.audio_base64.length > Math.ceil(MAX_AUDIO_BYTES * 4 / 3) + 8) {
        return json(response, 413, { error: "Audio payload is too large or invalid" });
      }
      const mimeType = body.audio_mime_type;
      if (typeof mimeType !== "string" || !AUDIO_TYPES.has(mimeType.toLowerCase())) {
        return json(response, 400, { error: "audio_mime_type must be a supported audio type" });
      }
      const audio = Buffer.from(body.audio_base64, "base64");
      if (!audio.length || audio.length > MAX_AUDIO_BYTES) return json(response, 413, { error: "Audio must be between 1 byte and 5 MB" });
      transcript = await transcribeAudio(audio, mimeType.toLowerCase(), language);
    }
    if (typeof transcript !== "string" || !transcript.trim() || transcript.length > 4000) {
      return json(response, 400, { error: "Provide a transcript or supported audio_base64 payload" });
    }
    if (body.messages !== undefined && !Array.isArray(body.messages)) {
      return json(response, 400, { error: "messages must be an array" });
    }
    const priorMessages = Array.isArray(body.messages) ? body.messages.slice(-19) : [];
    const reply = await runConversation([...priorMessages, { role: "user", content: transcript.trim() }]);
    const result = { transcript, reply, language_code: language };
    if (body.voice_reply !== false) {
      try {
        result.audio_base64 = await synthesizeSpeech(reply, language);
      } catch {
        result.audio_error = "Voice playback is unavailable right now; the text reply is ready.";
      }
    }
    return json(response, 200, result);
  }

  if (request.method === "POST" && url.pathname === "/api/v1/campaigns/trigger") {
    const body = await readJson(request);
    validateCampaign(body);
    const result = await workflowRequest("POST", "/v1/campaigns/trigger", body);
    if (result?.ok !== true) return json(response, 502, { error: "Campaign was not accepted by the workflow service" });
    return json(response, 202, result);
  }

  if (request.method === "POST" && url.pathname === "/api/v1/translate") {
    const body = await readJson(request);
    if (typeof body.input !== "string" || !body.input.trim() || body.input.length > 2000) {
      return json(response, 400, { error: "input must be non-empty and at most 2,000 characters" });
    }
    const source = body.source_language_code;
    const target = body.target_language_code;
    if (typeof source !== "string" || typeof target !== "string") {
      return json(response, 400, { error: "source_language_code and target_language_code are required" });
    }
    const translatedText = await translateText(body.input, source, target);
    return json(response, 200, { translated_text: translatedText, target_language_code: target });
  }

  return json(response, 404, { error: "Not found" });
}

const server = createServer((request, response) => {
  handle(request, response).catch((error) => {
    const status = Number.isInteger(error.statusCode) ? error.statusCode : 502;
    // Do not log request bodies, patient identifiers, transcripts, or provider error bodies.
    console.error(JSON.stringify({ event: "request_failed", status, error: error.name ?? "Error" }));
    if (!response.headersSent) {
      const message = error.publicMessage ?? (status >= 500 ? "Service request failed" : error.message);
      json(response, status, { error: message });
    }
    else response.destroy();
  });
});
server.requestTimeout = 60_000;
server.headersTimeout = 65_000;
server.keepAliveTimeout = 5_000;
server.listen(config.port, () => console.log(`Healthcare Agent API listening on port ${config.port}`));

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}




