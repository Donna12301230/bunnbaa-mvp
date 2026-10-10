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
// 轉讓媒合用的向量；Firestore 向量索引上限 2048 維，這裡固定 768（firestore.indexes.json 要一致）
const EMBEDDING_MODEL = "gemini-embedding-001";
const EMBEDDING_DIMENSIONS = 768;
// 新模型不一定在 asia-east1 上架，預設走 global 端點；要指定區域就設 VERTEX_LOCATION
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

/** 同 generateJSON，但附一張圖片（base64，不含 data: 前綴） */
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
 * Function calling 迴圈：Gemini 要求呼叫工具時，由 handlers[name](args) 在伺服器端執行
 * （Gemini 不直接碰資料庫），結果送回去，直到它回文字或呼叫 finishTool 為止。
 * 回傳 { text, finish }：finish 是 finishTool 的參數（沒呼叫就是 null）。
 * 最後一輪限定只能呼叫 finishTool，工具查太多輪也一定會交出結果。
 */
async function runWithTools({ systemInstruction, contents, functionDeclarations, handlers, finishTool, maxRounds = 5, temperature = 0.3 }) {
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
    // 工具結果放在 user 回合（API 不接受 role "function"）
    history.push({ role: "user", parts });
  }
  return { text: "", finish: null };
}

/** 文字轉向量（EMBEDDING_DIMENSIONS 維） */
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
