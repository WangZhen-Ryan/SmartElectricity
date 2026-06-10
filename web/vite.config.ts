import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const base = env.VITE_BASE || (command === "build" ? "/" : "/");
  return {
    plugins: [react()],
    base,
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes("node_modules/react") || id.includes("node_modules/react-dom")) {
              return "react-vendor";
            }
            if (
              id.includes("/src/gui/charts") ||
              id.includes("/src/gui/RLPanel") ||
              id.includes("/src/gui/DailyDecisionReview") ||
              id.includes("/src/gui/ActualUsageReview")
            ) {
              return "charts-and-rl";
            }
            if (
              id.includes("/src/gui/CommunityPanels") ||
              id.includes("/src/gui/PublicActivityShell") ||
              id.includes("/src/core/community")
            ) {
              return "community";
            }
            if (
              id.includes("/src/gui/ConfigAccountPanel") ||
              id.includes("/src/gui/AuthRecoveryView") ||
              id.includes("/src/gui/AdminOpsPanels") ||
              id.includes("/src/core/routeState")
            ) {
              return "auth-admin";
            }
            return undefined;
          },
        },
      },
    },
    server: {
      proxy: {
        "/api": "http://localhost:5174",
      },
    },
  };
});
