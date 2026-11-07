/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        jm: {
          navy: "#071B3A",
          navy2: "#0E2A55",
          orange: "#FF7900",
          blue: "#1677E8",
          sky: "#F4F8FF",
          line: "#DCE6F5",
          ink: "#14243A",
          muted: "#5B6B82",
          green: "#16A34A",
          red: "#DC2626",
          amber: "#B45309",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      boxShadow: {
        jm: "0 1px 2px rgba(7,27,58,.06), 0 8px 24px rgba(7,27,58,.08)",
      },
    },
  },
  plugins: [],
};
