const { AsyncLocalStorage } = require("node:async_hooks");

// 回給使用者看的錯誤訊息依前端語言（中文／英文）。前端每次呼叫 callable 都帶
// data.lang（web/src/lib/callable.ts）。同一個 Functions 實例會同時處理多個請求，
// 所以語言放在 AsyncLocalStorage，不能用模組層級變數。沒帶或不在請求內（排程）＝中文。
const store = new AsyncLocalStorage();

/** 包住 onCall handler：這次請求內的 t() 都依 request.data.lang 挑語言 */
function withLang(handler) {
  return (request) => store.run({ lang: request?.data?.lang === "en" ? "en" : "zh" }, () => handler(request));
}

/** 依目前請求的語言挑字串 */
function t(zh, en) {
  return store.getStore()?.lang === "en" ? en : zh;
}

module.exports = { withLang, t };
