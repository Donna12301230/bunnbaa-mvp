import { httpsCallable as rawHttpsCallable, type Functions, type HttpsCallable, type HttpsCallableOptions } from "firebase/functions";
import { getLang } from "@/lib/i18n";

/**
 * 跟 firebase/functions 的 httpsCallable 一樣，但每次呼叫都在 data 裡帶上目前語言
 * （lang: "zh" | "en"），Functions 端（functions/src/i18n.js）依此回中文或英文的錯誤訊息。
 */
export function httpsCallable<RequestData = unknown, ResponseData = unknown>(
  functions: Functions,
  name: string,
  options?: HttpsCallableOptions
): HttpsCallable<RequestData, ResponseData> {
  const fn = rawHttpsCallable<RequestData, ResponseData>(functions, name, options);
  return ((data?: RequestData | null) =>
    fn({ ...((data ?? {}) as object), lang: getLang() } as RequestData)) as HttpsCallable<RequestData, ResponseData>;
}
