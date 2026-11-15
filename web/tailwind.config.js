/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        ivory: "var(--board-page)",
        paper: "var(--board-surface)",
        burgundy: "var(--board-white)",
        copy: "var(--board-copy)",
        muted: "var(--board-muted)",
        coral: "var(--board-coral)",
        "coral-soft": "var(--board-coral-soft)",
        blue: "var(--board-blue)",
        "blue-soft": "var(--board-blue-soft)",
        green: "var(--board-green)",
        "green-soft": "var(--board-green-soft)",
        amber: "var(--board-amber)",
        "amber-soft": "var(--board-amber-soft)",
        danger: "var(--board-red)",
        "danger-soft": "var(--board-red-soft)",
      },
      fontFamily: {
        arabic: [
          "Noto Sans Arabic",
          "IBM Plex Sans Arabic",
          "Segoe UI",
          "Tahoma",
          "Arial",
          "sans-serif",
        ],
        display: [
          "Noto Sans Arabic",
          "IBM Plex Sans Arabic",
          "Segoe UI",
          "Tahoma",
          "Arial",
          "sans-serif",
        ],
      },
      boxShadow: {
        board: "var(--board-shadow)",
      },
      borderRadius: {
        board: "var(--board-radius)",
        "board-sm": "var(--board-radius-sm)",
      },
    },
  },
  plugins: [],
};
