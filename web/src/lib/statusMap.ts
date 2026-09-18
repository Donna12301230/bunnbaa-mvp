export const STATUS_MAP: Record<string, { label: string; color: string }> = {
  pending:   { label: "待確認", color: "bg-yellow-100 text-yellow-800" },
  confirmed: { label: "已確認", color: "bg-blue-100 text-blue-800" },
  completed: { label: "已完成", color: "bg-green-100 text-green-800" },
  cancelled: { label: "已取消", color: "bg-gray-100 text-gray-600" },
};

// 含 border，用於 order-detail 頁
export const STATUS_MAP_BORDERED: Record<string, { label: string; color: string }> = {
  pending:   { label: "待確認", color: "bg-yellow-100 text-yellow-800 border-yellow-200" },
  confirmed: { label: "已確認", color: "bg-blue-100 text-blue-800 border-blue-200" },
  completed: { label: "已完成", color: "bg-green-100 text-green-800 border-green-200" },
  cancelled: { label: "已取消", color: "bg-gray-100 text-gray-600 border-gray-200" },
};
