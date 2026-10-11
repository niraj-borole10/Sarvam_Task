import { sarvam } from "./config.js";

export async function createChatCompletion(messages, tools) {
  return sarvam.chat.completions({
    model: "sarvam-105b-conversations",
    messages,
    ...(tools ? { tools, tool_choice: "auto" } : {}),
    max_tokens: 700,
    reasoning_effort: "low",
  });
}

export async function transcribeAudio(audioBuffer, mimeType, languageCode = "unknown") {
  const extension = ({
    "audio/wav": "wav",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/ogg": "ogg",
    "audio/webm": "webm",
    "audio/flac": "flac",
    "audio/aac": "aac",
  })[mimeType];
  if (!extension) throw new Error("Unsupported audio content type");

  const audioFile = new File([audioBuffer], `patient-audio.${extension}`, { type: mimeType });
  let result;
  try {
    result = await sarvam.speechToText.transcribe({
      file: audioFile,
      model: "saaras:v4",
      language_code: languageCode,
    });
  } catch (cause) {
    const status = cause?.statusCode;
    const message = status === 403
      ? "Sarvam rejected the API key. Check SARVAM_API_KEY in .env and restart the server."
      : status === 429
        ? "Sarvam is rate limiting requests. Wait a moment and try the recording again."
        : status === 400 || status === 422
          ? "Sarvam could not process this audio. Record a clear clip under 25 seconds and check the selected language."
          : cause?.name === "SarvamAITimeoutError"
            ? "Speech recognition took too long. Try a shorter recording."
            : "Could not reach Sarvam speech recognition. Check the server connection and try again.";
    const error = new Error(message, { cause });
    error.statusCode = 502;
    error.publicMessage = message;
    throw error;
  }
  if (typeof result.transcript !== "string" || !result.transcript.trim()) {
    const error = new Error("Sarvam returned no speech transcript. Try speaking more clearly and record again.");
    error.statusCode = 502;
    error.publicMessage = error.message;
    throw error;
  }
  return result.transcript;
}

export async function synthesizeSpeech(text, languageCode) {
  const result = await sarvam.textToSpeech.convert({
    text,
    language_code: languageCode,
    model: "bulbul:v3",
    speaker: "shubh",
  });
  return result.audios?.[0] ?? null;
}

export async function translateText(input, sourceLanguageCode, targetLanguageCode) {
  const result = await sarvam.text.translate({
    input,
    source_language_code: sourceLanguageCode,
    target_language_code: targetLanguageCode,
    model: "sarvam-translate:v1",
  });
  return result.translated_text;
}
