/**
 * Thin wrapper around Gemini on Vertex AI (@google/genai, Vertex mode).
 * Authenticates with the functions' service account (Application Default
 * Credentials) — no API key.
 *
 * One-time GCP setup:
 *   - enable the Vertex AI API (aiplatform.googleapis.com)
 *   - grant the functions' service account roles/aiplatform.user
 * Local emulator: run `gcloud auth application-default login` with an account
 * that has access to the project, or set GEMINI_DISABLED=1 in functions/.env.local.
 */
const { GoogleGenAI } = require("@google/genai");

const MODEL_NAME = "gemini-3.6-flash";
// Embeddings for resale matching; Firestore vector indexes cap at 2048 dimensions, fixed at 768 here (must match firestore.indexes.json)
const EMBEDDING_MODEL = "gemini-embedding-001";
const EMBEDDING_DIMENSIONS = 768;
// Newer models aren't always available in asia-east1, so default to the global endpoint; set VERTEX_LOCATION to pin a region
const LOCATION = process.env.VERTEX_LOCATION || "global";

let client;

function getClient() {
  if (process.env.GEMINI_DISABLED) {
    throw new Error("Gemini is disabled (GEMINI_DISABLED is set).");
  }
  if (!client) {
    const project = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
    if (!project) {
      throw new Error("GCLOUD_PROJECT is not set; cannot reach Vertex AI.");
    }
    client = new GoogleGenAI({ vertexai: true, project, location: LOCATION });
  }
  return client;
}

const MAX_ATTEMPTS = 3;

/**
 * Retries transient overload errors (503 high demand / 429 rate limit)
 * with a short backoff; anything else is thrown immediately.
 */
async function withRetry(call) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await call();
    } catch (err) {
      const transient = err.status === 503 || err.status === 429;
      if (!transient || attempt >= MAX_ATTEMPTS) throw err;
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
    }
  }
}

function parseJSON(text) {
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(
      `Gemini did not return valid JSON. Raw response:\n${text}\n\nParse error: ${err.message}`
    );
  }
}

function generateJSONContent(contents, systemInstruction, temperature) {
  return withRetry(() => getClient().models.generateContent({
    model: MODEL_NAME,
    contents,
    config: {
      systemInstruction,
      temperature,
      responseMimeType: "application/json",
    },
  }));
}

/**
 * Calls Gemini with a system instruction + user payload, expecting
 * strict JSON back. Throws if the model does not return parseable JSON.
 */
async function generateJSON({ systemInstruction, userPrompt, temperature = 0.4 }) {
  const response = await generateJSONContent(userPrompt, systemInstruction, temperature);
  return parseJSON(response.text ?? "");
}

/** Same as generateJSON, but with one image attached (base64, without the data: prefix) */
async function generateJSONFromImage({ systemInstruction, userPrompt, imageBase64, mimeType, temperature = 0.2 }) {
  const response = await generateJSONContent([
    { role: "user", parts: [
      { inlineData: { data: imageBase64, mimeType } },
      { text: userPrompt },
    ] },
  ], systemInstruction, temperature);
  return parseJSON(response.text ?? "");
}

/**
 * Function calling loop: when Gemini asks to call a tool, handlers[name](args) runs it on the server
 * (Gemini never touches the database directly) and the result is sent back, until it replies with text or calls finishTool.
 * Returns { text, finish }: finish is finishTool's arguments (null if it wasn't called).
 * The last round only allows finishTool, so even if it queries tools for too many rounds it still delivers a result.
 */
async function runWithTools({ systemInstruction, contents, functionDeclarations, handlers, finishTool, maxRounds = 5, temperature = 0.3, finalNudge = null }) {
  const config = {
    systemInstruction,
    tools: [{ functionDeclarations }],
    temperature,
  };
  const history = [...contents];
  for (let round = 0; round < maxRounds; round++) {
    const lastRound = finishTool && round === maxRounds - 1;
    const response = await withRetry(() => getClient().models.generateContent({
      model: MODEL_NAME,
      contents: history,
      config: lastRound
        ? { ...config, toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: [finishTool] } } }
        : config,
    }));
    const calls = response.functionCalls || [];
    if (calls.length === 0) return { text: response.text ?? "", finish: null };
    const finish = calls.find((c) => c.name === finishTool);
    if (finish) return { text: "", finish: finish.args || {} };
    history.push(response.candidates[0].content);
    const parts = [];
    for (const call of calls) {
      const handler = handlers[call.name];
      let result;
      try {
        result = handler ? await handler(call.args || {}) : { error: `unknown tool ${call.name}` };
      } catch (err) {
        result = { error: err.message };
      }
      parts.push({ functionResponse: { id: call.id, name: call.name, response: { result } } });
    }
    // The next round is the final, wrap-up-only round: add a note, or the model may hand back filler like "the system had an error".
    // Put it inside the tool result; mixing text and functionResponse in the same turn is rejected by the API
    if (finalNudge && round === maxRounds - 2) parts[parts.length - 1].functionResponse.response.note = finalNudge;
    // Tool results go in a user turn (the API doesn't accept role "function")
    history.push({ role: "user", parts });
  }
  return { text: "", finish: null };
}

/** Text to embedding (EMBEDDING_DIMENSIONS dimensions) */
async function embedText(text, taskType = "SEMANTIC_SIMILARITY") {
  const response = await withRetry(() => getClient().models.embedContent({
    model: EMBEDDING_MODEL,
    contents: text,
    config: { taskType, outputDimensionality: EMBEDDING_DIMENSIONS },
  }));
  const values = response?.embeddings?.[0]?.values;
  if (!Array.isArray(values) || values.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(`Unexpected embedding size: ${values?.length}`);
  }
  return values;
}

module.exports = { generateJSON, generateJSONFromImage, runWithTools, embedText, EMBEDDING_DIMENSIONS };
