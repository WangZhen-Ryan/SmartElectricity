import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/SmartElectricity/",
  server: {
    proxy: {
      "/api": "http://localhost:5174",
    },
  },
});
