import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev server proxies /api to the FastAPI backend (default :8000; override with MUNEEM_API=http://127.0.0.1:8050)
declare const process: { env: Record<string, string | undefined> }; // no @types/node in this project
const API = process.env.MUNEEM_API ?? "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": { target: API, changeOrigin: true } },
  },
});
