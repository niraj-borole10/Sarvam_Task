# Sarvam Healthcare Agent (JavaScript)

**Author:** Niraj Borole  
**Department:** Department of Chemical Engineering, IIT Kharagpur

A Node.js web application and API for multilingual healthcare administration conversations. Open `http://localhost:3000` for the CareConnect frontend: chat, language selection, voice recording/replies, and a care campaign form. Sarvam handles chat, speech transcription, speech generation, and translation. Appointment, insurance, reminder, and campaign actions are sent to a separately authenticated healthcare workflow service; this project does not invent or store clinic data.

## What it includes

- `POST /api/v1/chat` — text conversations with Sarvam Chat Completion and controlled workflow tool calling.
- `POST /api/v1/voice/webhook` — accepts a transcript or a short base64 audio clip, transcribes audio with Saaras, runs the same agent, and returns Bulbul audio by default.
- `POST /api/v1/campaigns/trigger` — submits a campaign to the workflow service.
- `POST /api/v1/translate` — uses Sarvam Translate for text translation.
- Workflow tools for slot lookup, booking, rescheduling, cancellation, cashless verification, pre-authorization status, and reminder scheduling.

## Requirements

- Node.js 20 or newer.
- A Sarvam API key.
- A healthcare workflow adapter/API implementing the routes below before enabling booking, insurance, reminders, or campaigns.

## Setup

1. Set a long, random `API_AUTH_TOKEN` in `.env` and verify `SARVAM_API_KEY` is already set. If `.env` exists from the initial chat setup, add the missing settings from `.env.example` without overwriting the existing key. Keep `.env` private; it is ignored by Git.
2. Install dependencies with `npm install`.
3. Start the API with `npm start` (or `npm run dev` for local auto-reload).
4. The health check is `GET http://localhost:3000/healthz`.

The static frontend is served from `/` and assets are public. It asks you to paste `API_AUTH_TOKEN` from `.env`; the token is held in tab-scoped session storage and sent only in the Authorization header. API routes other than `/healthz` and the frontend require `Authorization: Bearer <API_AUTH_TOKEN>`. Keep this service behind HTTPS in deployment; do not expose the shared token in a public browser app. `WORKFLOW_API_URL` and `WORKFLOW_API_TOKEN` configure the clinic integration.

The API never logs request bodies, transcripts, patient identifiers, insurance data, or provider response bodies. Conversation history is supplied by the caller; this service does not persist it. Send only the minimum necessary information and use opaque, authorized patient identifiers.

## Frontend and chat request

```http
POST /api/v1/chat
Authorization: Bearer <API_AUTH_TOKEN>
Content-Type: application/json
```

```json
{
  "message": "Can I book a cardiology appointment tomorrow?",
  "language_code": "en-IN",
  "voice_reply": false
}
```

For multiple turns, send `messages` as an ordered array of `{ "role": "user" | "assistant", "content": "..." }`. The service adds its own system prompt; caller-supplied system/tool messages are not accepted. The frontend requests both text and Bulbul audio for chat replies. Set `voice_reply` to `true` in direct API requests to get `audio_base64`; if speech generation fails, the text reply is still returned.

## Voice webhook request

The endpoint accepts JSON containing either a recognized `transcript` or audio in `audio_base64` with `audio_mime_type` (`audio/wav`, `audio/mpeg`, `audio/mp4`, `audio/ogg`, `audio/webm`, `audio/flac`, or `audio/aac`). Audio is limited to 5 MB; The web recorder automatically stops at 25 seconds to stay within Saaras synchronous transcription limits. `language_code` must be one of `en-IN`, `hi-IN`, `ta-IN`, `te-IN`, `kn-IN`, `mr-IN`, `bn-IN`, or `gu-IN`. Replies include transcript, text, and (unless `voice_reply` is false) base64 encoded audio.

This is a webhook request/response interface, not a live media-stream bridge. For a low-latency phone call, connect your telephony provider's media stream to Sarvam's realtime Speech-to-Text WebSocket and Bulbul streaming/WebSocket output; validate that provider's webhook signature at the trusted gateway before forwarding events here. See Sarvam's [Twilio voice-agent guide](https://docs.sarvam.ai/api/integration/build-voice-agent-with-twilio) and [realtime STT guide](https://docs.sarvam.ai/api/api-guides-tutorials/speech-to-text/realtime-streaming).

## Campaign trigger

```json
{
  "campaign_type": "post_appointment_followup",
  "patient_ids": ["opaque-patient-id"],
  "message_template_id": "followup-v1",
  "scheduled_time": "2026-10-12T10:00:00+05:30"
}
```

`campaign_type` is `post_appointment_followup`, `preventive_care`, or `reengagement`. Your workflow service must enforce patient consent, contact preferences, suppression lists, authorization, and send limits before dispatching.

## Workflow API contract

Set `WORKFLOW_API_URL` to the root URL of a trusted integration service. Requests are sent as JSON with `Authorization: Bearer $WORKFLOW_API_TOKEN` when a token is configured. Implement these routes and return JSON. Successful side-effect responses must include `"ok": true`; the agent will not tell patients an action succeeded otherwise.

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/v1/appointments/slots?department=...&date=YYYY-MM-DD` | Return currently available slots |
| POST | `/v1/appointments/book` | Book an appointment |
| POST | `/v1/appointments/reschedule` | Reschedule an appointment |
| POST | `/v1/appointments/cancel` | Cancel an appointment |
| POST | `/v1/insurance/cashless/verify` | Submit/check cashless eligibility |
| GET | `/v1/insurance/preauth/status?claim_id=...` | Return current pre-authorization status |
| POST | `/v1/reminders` | Schedule a reminder through the configured channel |
| POST | `/v1/campaigns/trigger` | Validate and dispatch a batch campaign |

The agent requires explicit patient confirmation before it invokes booking, reschedule, cancellation, or reminder-scheduling tools. The workflow service must independently validate identity, consent, eligibility, and authorization; never trust model-generated tool arguments as authorization.

## Safety and deployment notes

This is an integration foundation, not a complete healthcare deployment or a claim of HIPAA compliance. Before handling real patient data, connect a compliant identity/access layer, secure persistence for authorized conversation state, audit trails, retention/deletion controls, secret management, TLS termination, operational monitoring, and approved healthcare workflow systems. Validate your organization's privacy, security, and regulatory requirements. The agent is limited to administrative workflows and directs emergencies to emergency services; it does not provide medical advice.

Sarvam API usage in this project follows the official [JavaScript SDK](https://docs.sarvam.ai/api/getting-started/sdks), [Chat Completion](https://docs.sarvam.ai/api/api-guides-tutorials/chat-completion/overview), [Saaras](https://docs.sarvam.ai/api/api-guides-tutorials/speech-to-text/overview), [Bulbul](https://docs.sarvam.ai/api/getting-started/models/bulbul), and [translation](https://docs.sarvam.ai/api/api-guides-tutorials/text-processing/translation) guides.





