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

const MODEL_NAME = "gemini-2.0-flash";

function getClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not set. Add it to functions/.env or your deploy environment."
    );
  }
  return new GoogleGenerativeAI(apiKey);
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

  const result = await model.generateContent(userPrompt);
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
