// AI feature 1: list menus from a photo (doc/AI功能設計.md). The vendor owner photographs a paper menu or a dish, and Gemini Vision
// reads it into item drafts; this only returns drafts and doesn't write menu_items. The owner confirms and edits them on the menu page before listing.
// Dietary tags and allergens must be one of the frontend's fixed options (DIETARY_TAGS / ALLERGEN_LIST in web/src/types.ts;
// change both together); any other value from the model is dropped. Allergens are required by food safety law, and the UI reminds the owner to confirm each one.
const { onCall, HttpsError, logger, t, callerVendorId } = require("./common");
const { generateJSONFromImage } = require("./gemini");

const DIETARY_TAGS = ["葷食", "素食", "全素", "辣"];
const ALLERGENS = ["蛋", "奶", "花生", "堅果", "小麥/麩質", "大豆", "海鮮", "芝麻"];
const MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // the frontend first downsizes to a 1600px JPEG, usually < 500 KB
const MAX_ITEMS = 30;

const SYSTEM_INSTRUCTION = `你是台灣小吃店、便當店的上架助手。店主會拍一張紙本菜單、價目表或餐點照片，你把看得到的品項整理成結構化資料。
規則：
- 只列出照片裡確實看得到的品項，不要自行補充或猜測沒出現的品項；價格看不清楚就填 null。
- name 用照片上的中文品名；name_en 給自然的英文譯名（專有名詞用漢語拼音）。
- category 用簡短中文分類，例如「便當」「麵食」「湯品」「飲料」「小菜」。
- dietary_tags 只能從 ${JSON.stringify(DIETARY_TAGS)} 挑；看得出有肉就標「葷食」，確定無肉才標「素食」，不確定就留空陣列。
- allergens 只能從 ${JSON.stringify(ALLERGENS)} 挑，依品名常識推斷可能含有的成分（例：蛋餅→蛋、小麥/麩質）；這只是提醒，店主會再確認。
- description 用一句話描述內容（主菜、配菜、口味），照片沒資訊就留空字串。
- 照片不是菜單或餐點時，items 回空陣列，note 說明原因。

輸出嚴格的 JSON，不要加 markdown。`;

const OUTPUT_SCHEMA = {
  items: [{
    name: "string",
    name_en: "string",
    price: "number | null（新台幣整數）",
    category: "string",
    dietary_tags: "string[]",
    allergens: "string[]",
    description: "string",
  }],
  note: "string，給店主的一句話（例如哪些價格看不清楚），沒有就空字串",
};

function cleanItem(raw) {
  if (!raw || typeof raw.name !== "string" || !raw.name.trim()) return null;
  const price = Number(raw.price);
  const pick = (list, allowed) => [...new Set((Array.isArray(list) ? list : []).filter((x) => allowed.includes(x)))];
  return {
    name: raw.name.trim().slice(0, 60),
    name_en: typeof raw.name_en === "string" ? raw.name_en.trim().slice(0, 80) : "",
    price: Number.isFinite(price) && price > 0 ? Math.round(price) : null,
    category: typeof raw.category === "string" && raw.category.trim() ? raw.category.trim().slice(0, 20) : "一般",
    dietary_tags: pick(raw.dietary_tags, DIETARY_TAGS),
    allergens: pick(raw.allergens, ALLERGENS),
    description: typeof raw.description === "string" ? raw.description.trim().slice(0, 200) : "",
  };
}

/**
 * data: { vendor_id?, image_base64, mime_type }
 * Returns { items: drafts[], note, disclaimer }. Only that vendor's owner or an admin can use it (it spends Gemini quota).
 */
exports.extractMenuFromImage = onCall({ timeoutSeconds: 120, memory: "512MiB" }, async (request) => {
  await callerVendorId(request, request.data?.vendor_id);
  const image = String(request.data?.image_base64 || "").replace(/^data:[^;]+;base64,/, "");
  const mimeType = String(request.data?.mime_type || "image/jpeg");
  if (!image) throw new HttpsError("invalid-argument", "image_base64 is required");
  if (!MIME_TYPES.includes(mimeType)) {
    throw new HttpsError("invalid-argument", t("只支援 JPG、PNG、WebP、HEIC 圖片", "Only JPG, PNG, WebP or HEIC images are supported"));
  }
  if (Math.floor((image.length * 3) / 4) > MAX_IMAGE_BYTES) {
    throw new HttpsError("invalid-argument", t("圖片太大，請小於 4 MB", "The image is too large (max 4 MB)"));
  }

  let result;
  try {
    result = await generateJSONFromImage({
      systemInstruction: SYSTEM_INSTRUCTION,
      userPrompt: JSON.stringify({ task: "extract_menu_items", output_schema: OUTPUT_SCHEMA }),
      imageBase64: image,
      mimeType,
    });
  } catch (err) {
    logger.warn("extractMenuFromImage failed", err);
    throw new HttpsError("unavailable", t("AI 暫時無法辨識，請稍後再試或手動新增", "AI couldn't read the photo right now. Try again later or add items by hand."));
  }

  const items = (Array.isArray(result?.items) ? result.items : []).map(cleanItem).filter(Boolean).slice(0, MAX_ITEMS);
  return {
    items,
    note: typeof result?.note === "string" ? result.note.slice(0, 300) : "",
    disclaimer: t("AI 草稿僅供預填，價格、飲食標記與過敏原請逐項確認後再上架", "AI drafts only pre-fill the form — check price, dietary tags and allergens before listing"),
  };
});
