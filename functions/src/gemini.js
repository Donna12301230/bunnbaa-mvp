/**
 * Thin wrapper around the Gemini API.
 * Reads the API key from Cloud Functions config / environment.
 *
 * Set the key before deploying:
 *   firebase functions:config:set gemini.key="YOUR_KEY"
 * or, for 2nd-gen functions with dotenv:
 *   echo "GEMINI_API_KEY=YOUR_KEY" >> functions/.env
 */
const { GoogleGenerativeAI } = require("@google/generative-ai");

const MODEL_NAME = "gemini-3.6-flash";

function getClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not set. Add it to functions/.env or your deploy environment."
    );
  }
  return new GoogleGenerativeAI(apiKey);
}

const MAX_ATTEMPTS = 3;

/**
 * Retries transient overload errors (503 high demand / 429 rate limit)
 * with a short backoff; anything else is thrown immediately.
 */
async function generateWithRetry(model, userPrompt) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await model.generateContent(userPrompt);
    } catch (err) {
      const transient = err.status === 503 || err.status === 429;
      if (!transient || attempt >= MAX_ATTEMPTS) throw err;
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
    }
  }
}

/**
 * Calls Gemini with a system instruction + user payload, expecting
 * strict JSON back. Throws if the model does not return parseable JSON.
 */
async function generateJSON({ systemInstruction, userPrompt, temperature = 0.4 }) {
  const genAI = getClient();
  const model = genAI.getGenerativeModel({
    model: MODEL_NAME,
    systemInstruction,
    generationConfig: {
      temperature,
      responseMimeType: "application/json",
    },
  });

  const result = await generateWithRetry(model, userPrompt);
  const text = result.response.text();

  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(
      `Gemini did not return valid JSON. Raw response:\n${text}\n\nParse error: ${err.message}`
    );
  }
}

module.exports = { generateJSON };
