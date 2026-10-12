import { httpsCallable as rawHttpsCallable, type Functions, type HttpsCallable, type HttpsCallableOptions } from "firebase/functions";
import { getLang } from "@/lib/i18n";

/**
 * Same as httpsCallable from firebase/functions, but every call adds the current language to data
 * (lang: "zh" | "en") so Functions (functions/src/i18n.js) returns error messages in Chinese or English.
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
