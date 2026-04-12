/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: ["selector", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        app: {
          bg: "var(--color-app-bg)",
          surface: "var(--color-app-surface)",
          card: "var(--color-app-card)",
          border: "var(--color-app-border)",
          "border-hover": "var(--color-app-border-hover)",
          hover: "var(--color-app-hover)",
        },
        "app-text": {
          DEFAULT: "var(--color-app-text)",
          secondary: "var(--color-app-text-secondary)",
          muted: "var(--color-app-text-muted)",
          faint: "var(--color-app-text-faint)",
        },
        accent: {
          DEFAULT: "var(--color-accent)",
          hover: "var(--color-accent-hover)",
          subtle: "var(--color-accent-subtle)",
        },
        sidebar: {
          bg: "var(--color-sidebar-bg)",
          active: "var(--color-sidebar-active)",
        },
        danger: "var(--color-danger)",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "sans-serif"],
        mono: ["'JetBrains Mono'", "'SF Mono'", "'Fira Code'", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
