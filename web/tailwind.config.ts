import type { Config } from "tailwindcss";

// Colors are stored as CSS variables holding full color values (#hex), so Tailwind can't add opacity directly;
// wrapping them in color-mix makes modifiers like bg-primary/10 and hover:bg-primary/90 work
const withAlpha = (cssVar: string) =>
  `color-mix(in srgb, var(${cssVar}) calc(<alpha-value> * 100%), transparent)`;

export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      // Radii follow the design system: sm 6 (tags) / md 8 (buttons, inputs) / lg 12 (small cards) / xl 16 (large cards, dialogs)
      // lg / xl / 2xl read tokens; the cafe look scales them up
      borderRadius: {
        sm: "6px",
        md: "8px",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
        "2xl": "calc(var(--radius-xl) + 4px)",
        // Unified 2026-10-09: large cards (meal cards, panels) and inner tiles
        card: "1.75rem",
        tile: "1rem",
      },
      // Warm-brown shadows, not pure black (match --shadow-sm / md / lg)
      // Read from tokens; in the cafe look --shadow-sm is none (static cards use a border instead)
      boxShadow: {
        sm: "var(--shadow-sm)",
        DEFAULT: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
        xl: "var(--shadow-lg)",
      },
      // Font sizes follow the design system (tokens.css --font-*-size); Tailwind defaults like text-xs/sm/base still work
      fontSize: {
        display: ["32px", { lineHeight: "1.3", fontWeight: "700" }],
        h1: ["24px", { lineHeight: "1.35", fontWeight: "700" }],
        h2: ["20px", { lineHeight: "1.4", fontWeight: "600" }],
        h3: ["17px", { lineHeight: "1.4", fontWeight: "600" }],
        body: ["15px", { lineHeight: "1.6" }],
        "body-sm": ["13px", { lineHeight: "1.5" }],
        caption: ["12px", { lineHeight: "1.5" }],
        // Only for number badges and tiny badges (matches Badge sm at 11px)
        micro: ["11px", { lineHeight: "1.2" }],
      },
      transitionTimingFunction: {
        DEFAULT: "cubic-bezier(0.2, 0.8, 0.2, 1)",
      },
      colors: {
        /* ── Design-system color scales: pages hard-code lots of orange-* / amber-* / gray-* / red-* / green-*,
           so the whole set is swapped for the brand palette here, re-skinning the site without touching page files.
           Every shade from 500 up keeps white-text contrast ≥ 4.5:1 (see the contrast check at #/design-system). */
        orange: {
          // 50–200, 500, 600 read tokens.css --palette-orange-* (overridden by the cafe look)
          50: withAlpha("--palette-orange-50"),   // --brand-orange-tint
          100: withAlpha("--palette-orange-100"), // --brand-orange-soft
          200: withAlpha("--palette-orange-200"),
          300: "#F7C27A",
          400: "#F29E0C",  // --brand-orange (logo, icons, decoration, focus ring)
          500: withAlpha("--palette-orange-500"), // --brand-orange-strong: primary button background, white text 4.80:1
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
          // Pages use amber-500 / 600 as primary button backgrounds (login page, vendor portal); unified to the brand primary action color
          500: withAlpha("--palette-orange-500"), // = orange-500, white text 4.80:1
          600: withAlpha("--palette-orange-600"), // = orange-600
          700: "#7A4D0F",
          800: "#653F0E",
          900: "#4F310C",
          950: "#352008",
        },
        gray: {
          // Pages use bg-gray-50 as the page background → cream; gray-100 is the light grey block (skeletons, tag backgrounds)
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
          500: "#C24E36",  // --danger-strong, white text 4.73:1
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
          500: "#467D57",  // White text 4.85:1
          600: "#437552",  // --success-text
          700: "#37613F",
          800: "#2C4E35",
          900: "#223D2A",
          950: "#16281B",
        },
        /* Cool colors (blue / purple / yellow) are folded into the design system too:
           blue → info (muted blue-grey), yellow → warning, purple → brand brown */
        blue: {
          50: "#F1F5F9",
          100: "#E6EEF5",  // --info-soft
          200: "#CCDBE8",
          300: "#A5C0DC",
          400: "#6B8FB3",  // --info
          500: "#4A6D8F",  // --info-text, white text 5.42:1
          600: "#3E5E7D",  // White text 6.77:1
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
          500: "#E0A030",  // --warning (decoration such as progress bars)
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
        // Semantic colors (tokens.css, with dark variants): bg-success-soft text-success-text, bg-danger-soft text-danger-text…
        // Since 2026-10-09 pages use these instead of hard-coded scales like red-600 / green-700
        success: { DEFAULT: withAlpha("--success"), soft: withAlpha("--success-soft"), text: withAlpha("--success-text"), strong: withAlpha("--success-strong") },
        warning: { DEFAULT: withAlpha("--warning"), soft: withAlpha("--warning-soft"), text: withAlpha("--warning-text") },
        danger: { DEFAULT: withAlpha("--danger"), soft: withAlpha("--danger-soft"), text: withAlpha("--danger-text") },
        info: { DEFAULT: withAlpha("--info"), soft: withAlpha("--info-soft"), text: withAlpha("--info-text") },
        brand: { DEFAULT: withAlpha("--brand-orange"), soft: withAlpha("--palette-orange-100"), tint: withAlpha("--palette-orange-50"), foreground: withAlpha("--text-on-brand") },
        highlight: withAlpha("--highlight"),
        plum: { DEFAULT: withAlpha("--plum"), soft: withAlpha("--plum-soft"), text: withAlpha("--plum-text"), foreground: withAlpha("--text-on-plum") },
        // Charity meal / gift (index.css --status-*, with dark variants)
        charity: { DEFAULT: withAlpha("--status-charity"), soft: withAlpha("--status-charity-bg") },
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
        // Color band of the rice glyph in the logo (tokens.css --brand-rice); usage: bg-rice text-rice-foreground
        rice: {
          DEFAULT: withAlpha("--brand-rice"),
          hover: withAlpha("--brand-rice-hover"),
          foreground: withAlpha("--text-on-rice"),
        },
        // Design-system border lines and color bands (tokens.css; dark cocoa brown / cream yellow in the cafe look)
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
