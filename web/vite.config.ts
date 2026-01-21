import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const base = env.VITE_BASE || (command === "build" ? "/" : "/");
  return {
    plugins: [react()],
    base,
    server: {
      proxy: {
        "/api": "http://localhost:5174",
      },
    },
  };
});
