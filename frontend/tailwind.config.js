/** @type {import('tailwindcss').Config} */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: v("canvas"), surface: v("surface"), "surface-2": v("surface-2"), line: v("line"),
        ink: v("ink"), muted: v("muted"), accent: v("accent"), "accent-soft": v("accent-soft"),
        nav: v("nav"),
      },
      fontFamily: {
        sans: ['"DM Sans"', "Inter", "ui-sans-serif", "system-ui", '"Noto Sans Devanagari"', "sans-serif"],
        display: ['"Plus Jakarta Sans"', '"DM Sans"', "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "SFMono-Regular", "monospace"],
      },
      boxShadow: { card: "0 1px 2px rgb(15 23 42 / 0.04), 0 1px 3px rgb(15 23 42 / 0.06)" },
    },
  },
  plugins: [],
};
