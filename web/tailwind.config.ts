import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx,mdx}"],
  darkMode: "media",
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: "rgb(var(--ink) / <alpha-value>)",
          soft: "rgb(var(--ink-soft) / <alpha-value>)",
          muted: "rgb(var(--ink-muted) / <alpha-value>)",
        },
        cream: {
          DEFAULT: "rgb(var(--cream) / <alpha-value>)",
          deep: "rgb(var(--cream-deep) / <alpha-value>)",
        },
        rose: {
          DEFAULT: "rgb(var(--rose) / <alpha-value>)",
          soft: "rgb(var(--rose-soft) / <alpha-value>)",
          deep: "rgb(var(--rose-deep) / <alpha-value>)",
        },
        peach: {
          DEFAULT: "rgb(var(--peach) / <alpha-value>)",
          deep: "rgb(var(--peach-deep) / <alpha-value>)",
        },
        sage: {
          DEFAULT: "rgb(var(--sage) / <alpha-value>)",
        },
        surface: {
          DEFAULT: "rgb(var(--surface) / <alpha-value>)",
          raised: "rgb(var(--surface-raised) / <alpha-value>)",
          glass: "rgb(var(--surface-glass) / <alpha-value>)",
        },
        line: "rgb(var(--line) / <alpha-value>)",
      },
      fontFamily: {
        display: ["var(--font-fraunces)", "var(--font-noto-sc)", "serif"],
        body: ["var(--font-inter)", "var(--font-noto-sc)", "sans-serif"],
        sc: ["var(--font-noto-sc)", "sans-serif"],
      },
      borderRadius: {
        xl: "1rem",
        "2xl": "1.5rem",
        "3xl": "2rem",
      },
      boxShadow: {
        soft: "0 1px 2px rgba(58, 42, 38, 0.04), 0 8px 28px -12px rgba(183, 110, 121, 0.18)",
        glow: "0 24px 60px -28px rgba(183, 110, 121, 0.45), 0 2px 6px -2px rgba(58, 42, 38, 0.08)",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(100%)" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.4s ease-out both",
        shimmer: "shimmer 1.6s linear infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
