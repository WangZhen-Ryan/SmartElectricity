import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === "build" ? "/SmartElectricity/" : "/",
  server: {
    proxy: {
      "/api": "http://localhost:5174",
    },
  },
}));
