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
// 轉讓媒合用的向量；Firestore 向量索引上限 2048 維，這裡固定 768（firestore.indexes.json 要一致）
const EMBEDDING_MODEL = "gemini-embedding-001";
const EMBEDDING_DIMENSIONS = 768;

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

function jsonModel(systemInstruction, temperature) {
  return getClient().getGenerativeModel({
    model: MODEL_NAME,
    systemInstruction,
    generationConfig: {
      temperature,
      responseMimeType: "application/json",
    },
  });
}

/**
 * Calls Gemini with a system instruction + user payload, expecting
 * strict JSON back. Throws if the model does not return parseable JSON.
 */
async function generateJSON({ systemInstruction, userPrompt, temperature = 0.4 }) {
  const model = jsonModel(systemInstruction, temperature);
  const result = await withRetry(() => model.generateContent(userPrompt));
  return parseJSON(result.response.text());
}

/** 同 generateJSON，但附一張圖片（base64，不含 data: 前綴） */
async function generateJSONFromImage({ systemInstruction, userPrompt, imageBase64, mimeType, temperature = 0.2 }) {
  const model = jsonModel(systemInstruction, temperature);
  const result = await withRetry(() => model.generateContent([
    { inlineData: { data: imageBase64, mimeType } },
    { text: userPrompt },
  ]));
  return parseJSON(result.response.text());
}

function safeText(response) {
  try {
    return response.text();
  } catch {
    return "";
  }
}

/**
 * Function calling 迴圈：Gemini 要求呼叫工具時，由 handlers[name](args) 在伺服器端執行
 * （Gemini 不直接碰資料庫），結果送回去，直到它回文字或呼叫 finishTool 為止。
 * 回傳 { text, finish }：finish 是 finishTool 的參數（沒呼叫就是 null）。
 */
async function runWithTools({ systemInstruction, contents, functionDeclarations, handlers, finishTool, maxRounds = 5, temperature = 0.3 }) {
  const model = getClient().getGenerativeModel({
    model: MODEL_NAME,
    systemInstruction,
    tools: [{ functionDeclarations }],
    generationConfig: { temperature },
  });
  const history = [...contents];
  for (let round = 0; round < maxRounds; round++) {
    const result = await withRetry(() => model.generateContent({ contents: history }));
    const calls = result.response.functionCalls() || [];
    if (calls.length === 0) return { text: safeText(result.response), finish: null };
    const finish = calls.find((c) => c.name === finishTool);
    if (finish) return { text: "", finish: finish.args || {} };
    history.push(result.response.candidates[0].content);
    const parts = [];
    for (const call of calls) {
      const handler = handlers[call.name];
      let response;
      try {
        response = handler ? await handler(call.args || {}) : { error: `unknown tool ${call.name}` };
      } catch (err) {
        response = { error: err.message };
      }
      parts.push({ functionResponse: { name: call.name, response: { result: response } } });
    }
    // 工具結果放在 user 回合（新版 API 不接受 role "function"）
    history.push({ role: "user", parts });
  }
  return { text: "", finish: null };
}

/** 文字轉向量（EMBEDDING_DIMENSIONS 維） */
async function embedText(text, taskType = "SEMANTIC_SIMILARITY") {
  const model = getClient().getGenerativeModel({ model: EMBEDDING_MODEL });
  const result = await withRetry(() => model.embedContent({
    content: { role: "user", parts: [{ text }] },
    taskType,
    outputDimensionality: EMBEDDING_DIMENSIONS,
  }));
  const values = result?.embedding?.values;
  if (!Array.isArray(values) || values.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(`Unexpected embedding size: ${values?.length}`);
  }
  return values;
}

module.exports = { generateJSON, generateJSONFromImage, runWithTools, embedText, EMBEDDING_DIMENSIONS };
