import type { Config } from "tailwindcss";

// 顏色存成完整色值的 CSS 變數（#hex），Tailwind 無法直接加透明度；
// 以 color-mix 包一層，bg-primary/10、hover:bg-primary/90 這類修飾才會產生
const withAlpha = (cssVar: string) =>
  `color-mix(in srgb, var(${cssVar}) calc(<alpha-value> * 100%), transparent)`;

export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      // 圓角對齊設計系統：sm 6（標籤）/ md 8（按鈕、輸入框）/ lg 12（小卡片）/ xl 16（大卡片、彈窗）
      // lg / xl / 2xl 讀 tokens，cafe 風格會整體放大
      borderRadius: {
        sm: "6px",
        md: "8px",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
        "2xl": "calc(var(--radius-xl) + 4px)",
        // 2026-10-09 統一：大卡片（餐點卡、面板）與內層小塊
        card: "1.75rem",
        tile: "1rem",
      },
      // 暖棕色調陰影，不用純黑（對應 --shadow-sm / md / lg）
      // 讀 tokens；cafe 風格的 --shadow-sm 為 none（靜態卡片改用描邊）
      boxShadow: {
        sm: "var(--shadow-sm)",
        DEFAULT: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
        xl: "var(--shadow-lg)",
      },
      // 字級對齊設計系統（tokens.css --font-*-size）；text-xs/sm/base 等 Tailwind 預設仍可用
      fontSize: {
        display: ["32px", { lineHeight: "1.3", fontWeight: "700" }],
        h1: ["24px", { lineHeight: "1.35", fontWeight: "700" }],
        h2: ["20px", { lineHeight: "1.4", fontWeight: "600" }],
        h3: ["17px", { lineHeight: "1.4", fontWeight: "600" }],
        body: ["15px", { lineHeight: "1.6" }],
        "body-sm": ["13px", { lineHeight: "1.5" }],
        caption: ["12px", { lineHeight: "1.5" }],
        // 只給數字角標、極小徽章用（對應 Badge sm 的 11px）
        micro: ["11px", { lineHeight: "1.2" }],
      },
      transitionTimingFunction: {
        DEFAULT: "cubic-bezier(0.2, 0.8, 0.2, 1)",
      },
      colors: {
        /* ── 設計系統色階：頁面大量寫死 orange-* / amber-* / gray-* / red-* / green-*，
           這裡整組換成品牌色系，不改頁面檔即可整站換裝。
           500 以上的色階皆確保白字對比 ≥ 4.5:1（見 #/design-system 對比檢查）。 */
        orange: {
          // 50–200、500、600 讀 tokens.css --palette-orange-*（cafe 風格會改寫）
          50: withAlpha("--palette-orange-50"),   // --brand-orange-tint
          100: withAlpha("--palette-orange-100"), // --brand-orange-soft
          200: withAlpha("--palette-orange-200"),
          300: "#F7C27A",
          400: "#F29E0C",  // --brand-orange（Logo、icon、裝飾、focus 外框）
          500: withAlpha("--palette-orange-500"), // --brand-orange-strong：主要按鈕底，白字 4.80:1
          600: withAlpha("--palette-orange-600"), // --brand-orange-strong-hover
          700: "#7A3D00",
          800: "#5E3000",
          900: "#472400",
          950: "#301800",
        },
        amber: {
          50: "#FBF1DC",   // --warning-soft
          100: "#F8E6C4",
          200: "#F1D39C",
          300: "#E8BD6A",
          400: "#E0A030",  // --warning
          // 頁面把 amber-500 / 600 當主要按鈕底（登入頁、廠商後台），統一為品牌主行動色
          500: withAlpha("--palette-orange-500"), // = orange-500，白字 4.80:1
          600: withAlpha("--palette-orange-600"), // = orange-600
          700: "#7A4D0F",
          800: "#653F0E",
          900: "#4F310C",
          950: "#352008",
        },
        gray: {
          // 頁面以 bg-gray-50 當整頁底色 → 奶油底；gray-100 為淡灰區塊（骨架、標籤底）
          50: "#FFF8EC",   // --bg
          100: "#F7F5F0",  // --surface-muted
          200: "#ECE6DC",  // --border
          300: "#DCD3C6",  // --border-strong
          400: "#948778",  // --border-control
          500: "#6F6B66",  // --text-muted
          600: "#5C5C5C",  // --text-secondary
          700: "#45403B",
          800: "#2B2B2B",  // --text
          900: "#1F1A15",
          950: "#15110D",
        },
        red: {
          50: "#FCF1EE",
          100: "#F8E3DE",  // --danger-soft
          200: "#F0C4BA",
          300: "#E59A89",
          400: "#D0604A",  // --danger
          500: "#C24E36",  // --danger-strong，白字 4.73:1
          600: "#AF432E",  // --danger-text
          700: "#943726",
          800: "#772C1F",
          900: "#5C2218",
          950: "#3D160F",
        },
        green: {
          50: "#F1F8F3",
          100: "#E6F2E9",  // --success-soft
          200: "#C8E3CF",
          300: "#9DCBAA",
          400: "#5A9E6F",  // --success
          500: "#467D57",  // 白字 4.85:1
          600: "#437552",  // --success-text
          700: "#37613F",
          800: "#2C4E35",
          900: "#223D2A",
          950: "#16281B",
        },
        /* 冷色系（藍 / 紫 / 黃）也收斂進設計系統：
           blue → 資訊色（低飽和藍灰）、yellow → 警示色、purple → 品牌棕 */
        blue: {
          50: "#F1F5F9",
          100: "#E6EEF5",  // --info-soft
          200: "#CCDBE8",
          300: "#A5C0DC",
          400: "#6B8FB3",  // --info
          500: "#4A6D8F",  // --info-text，白字 5.42:1
          600: "#3E5E7D",  // 白字 6.77:1
          700: "#3E5E7D",
          800: "#2F4860",
          900: "#223447",
          950: "#16222F",
        },
        yellow: {
          50: "#FBF1DC",   // --warning-soft
          100: "#F8E6C4",
          200: "#F1D39C",
          300: "#E8BD6A",
          400: "#E0A030",
          500: "#E0A030",  // --warning（進度條等裝飾）
          600: "#8F6315",  // --warning-text
          700: "#7A4D0F",
          800: "#7A4D0F",  // on yellow-100 5.91:1
          900: "#4F310C",
          950: "#352008",
        },
        purple: {
          50: "#F8EFEA",
          100: "#F1E0D6",
          200: "#E3C2AF",
          300: "#D09F84",
          400: "#B87A5A",  // --brand-brown
          500: "#8F5A3F",  // --brand-brown-dark
          600: "#8F5A3F",
          700: "#744630",  // on purple-50 6.96:1
          800: "#5C3726",
          900: "#44281C",
          950: "#2D1A12",
        },
        background: withAlpha("--background"),
        foreground: withAlpha("--foreground"),
        card: {
          DEFAULT: withAlpha("--card"),
          foreground: withAlpha("--card-foreground"),
        },
        popover: {
          DEFAULT: withAlpha("--popover"),
          foreground: withAlpha("--popover-foreground"),
        },
        primary: {
          DEFAULT: withAlpha("--primary"),
          foreground: withAlpha("--primary-foreground"),
          hover: withAlpha("--primary-hover"),
        },
        secondary: {
          DEFAULT: withAlpha("--secondary"),
          foreground: withAlpha("--secondary-foreground"),
        },
        muted: {
          DEFAULT: withAlpha("--muted"),
          foreground: withAlpha("--muted-foreground"),
        },
        accent: {
          DEFAULT: withAlpha("--accent"),
          foreground: withAlpha("--accent-foreground"),
        },
        destructive: {
          DEFAULT: withAlpha("--destructive"),
          foreground: withAlpha("--destructive-foreground"),
          hover: withAlpha("--destructive-hover"),
        },
        // 語意色（tokens.css，含暗色版本）：bg-success-soft text-success-text、bg-danger-soft text-danger-text…
        // 2026-10-09 起頁面改用這組，不再直接寫 red-600／green-700 等色階
        success: { DEFAULT: withAlpha("--success"), soft: withAlpha("--success-soft"), text: withAlpha("--success-text") },
        warning: { DEFAULT: withAlpha("--warning"), soft: withAlpha("--warning-soft"), text: withAlpha("--warning-text") },
        danger: { DEFAULT: withAlpha("--danger"), soft: withAlpha("--danger-soft"), text: withAlpha("--danger-text") },
        info: { DEFAULT: withAlpha("--info"), soft: withAlpha("--info-soft"), text: withAlpha("--info-text") },
        brand: { DEFAULT: withAlpha("--brand-orange"), soft: withAlpha("--palette-orange-100"), tint: withAlpha("--palette-orange-50") },
        border: withAlpha("--border"),
        input: withAlpha("--input"),
        ring: withAlpha("--ring"),
        chart: {
          "1": withAlpha("--chart-1"),
          "2": withAlpha("--chart-2"),
          "3": withAlpha("--chart-3"),
          "4": withAlpha("--chart-4"),
          "5": withAlpha("--chart-5"),
        },
        sidebar: {
          DEFAULT: withAlpha("--sidebar"),
          foreground: withAlpha("--sidebar-foreground"),
          primary: withAlpha("--sidebar-primary"),
          "primary-foreground": withAlpha("--sidebar-primary-foreground"),
          accent: withAlpha("--sidebar-accent"),
          "accent-foreground": withAlpha("--sidebar-accent-foreground"),
          border: withAlpha("--sidebar-border"),
          ring: withAlpha("--sidebar-ring"),
        },
        "brand-navy": {
          DEFAULT: withAlpha("--brand-navy"),
          hover: withAlpha("--brand-navy-hover"),
        },
        "surface-dark": withAlpha("--surface-dark"),
        // logo「飯」字色帶（tokens.css --brand-rice），用法：bg-rice text-rice-foreground
        rice: {
          DEFAULT: withAlpha("--brand-rice"),
          hover: withAlpha("--brand-rice-hover"),
          foreground: withAlpha("--text-on-rice"),
        },
        // 設計系統描邊線與色帶（tokens.css；cafe 風格下為深可可棕 / 奶油黃）
        ink: withAlpha("--border-ink"),
        inverse: {
          DEFAULT: withAlpha("--surface-inverse"),
          foreground: withAlpha("--text-on-inverse"),
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        serif: ["var(--font-serif)"],
        mono: ["var(--font-mono)"],
        heading: ["var(--font-heading)"],
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: withAlpha("--radix-accordion-content-height") },
        },
        "accordion-up": {
          from: { height: withAlpha("--radix-accordion-content-height") },
          to: { height: "0" },
        },
        marquee: {
          from: { transform: "translateX(0)" },
          to: { transform: "translateX(-50%)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        marquee: "marquee 22s linear infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate"), require("@tailwindcss/typography")],
} satisfies Config;
