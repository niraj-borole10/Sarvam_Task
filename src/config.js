import { SarvamAIClient } from "sarvamai";

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

const workflowApiUrl = process.env.WORKFLOW_API_URL?.replace(/\/+$/, "") ?? "";
const workflowApiToken = process.env.WORKFLOW_API_TOKEN ?? "";
if (workflowApiUrl && !workflowApiToken) {
  throw new Error("WORKFLOW_API_TOKEN is required when WORKFLOW_API_URL is configured");
}

export const config = Object.freeze({
  port: Number.parseInt(process.env.PORT ?? "3000", 10),
  sarvamApiKey: required("SARVAM_API_KEY"),
  apiAuthToken: required("API_AUTH_TOKEN"),
  workflowApiUrl,
  workflowApiToken,
  requestTimeoutMs: Number.parseInt(process.env.REQUEST_TIMEOUT_MS ?? "45000", 10),
  maxBodyBytes: Number.parseInt(process.env.MAX_BODY_BYTES ?? "8000000", 10),
});

if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}
if (!Number.isInteger(config.requestTimeoutMs) || config.requestTimeoutMs < 1000) {
  throw new Error("REQUEST_TIMEOUT_MS must be an integer of at least 1000");
}
if (!Number.isInteger(config.maxBodyBytes) || config.maxBodyBytes < 1024) {
  throw new Error("MAX_BODY_BYTES must be an integer of at least 1024");
}

export const sarvam = new SarvamAIClient({
  apiSubscriptionKey: config.sarvamApiKey,
  timeoutInSeconds: Math.ceil(config.requestTimeoutMs / 1000),
  maxRetries: 2,
});
