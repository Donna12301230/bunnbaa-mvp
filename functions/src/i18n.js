const { AsyncLocalStorage } = require("node:async_hooks");

// User-facing error messages follow the frontend language (Chinese/English). The frontend sends data.lang with every
// callable call (web/src/lib/callable.ts). One Functions instance handles several requests concurrently,
// so the language lives in AsyncLocalStorage, not a module-level variable. Missing, or outside a request (schedules) = Chinese.
const store = new AsyncLocalStorage();

/** Wraps an onCall handler: every t() within this request picks the language from request.data.lang */
function withLang(handler) {
  return (request) => store.run({ lang: request?.data?.lang === "en" ? "en" : "zh" }, () => handler(request));
}

/** In schedules, build notifications in the recipient's language (users.lang): t() called inside fn uses the given language */
function inLang(lang, fn) {
  return store.run({ lang: lang === "en" ? "en" : "zh" }, fn);
}

/** Pick the string for the current request's language */
function t(zh, en) {
  return store.getStore()?.lang === "en" ? en : zh;
}

module.exports = { withLang, inLang, t };
