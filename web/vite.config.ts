import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // 固定 port；被佔用時直接報錯，避免悄悄換 port 後舊分頁連到別的專案
    port: 5300,
    strictPort: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
