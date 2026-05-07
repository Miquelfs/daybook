import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Single accent: amber — warm, readable on dark backgrounds
        accent: {
          DEFAULT: "#F59E0B", // amber-400
          dim: "#B45309",     // amber-700
          muted: "#292524",   // stone-900 — subtle accent bg
        },
        surface: {
          0: "#09090B",  // zinc-950  — page bg
          1: "#18181B",  // zinc-900  — card bg
          2: "#27272A",  // zinc-800  — elevated card
          3: "#3F3F46",  // zinc-700  — borders, dividers
        },
        text: {
          primary:   "#FAFAFA",  // zinc-50
          secondary: "#A1A1AA",  // zinc-400
          muted:     "#52525B",  // zinc-600
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      fontSize: {
        "date-hero": ["clamp(2rem,6vw,4rem)", { lineHeight: "1", letterSpacing: "-0.03em" }],
      },
    },
  },
  plugins: [],
};

export default config;
