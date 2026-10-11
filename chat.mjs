import { SarvamAIClient } from "sarvamai";

const apiKey = process.env.SARVAM_API_KEY;
if (!apiKey) {
  console.error("Set SARVAM_API_KEY in .env, then run npm run chat.");
  process.exit(1);
}

const client = new SarvamAIClient({ apiSubscriptionKey: apiKey });
const response = await client.chat.completions({
  model: "sarvam-105b-conversations",
  messages: [{ role: "user", content: "Reply with a brief greeting." }],
});

console.log(response.choices[0].message.content);
