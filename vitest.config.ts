import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["dotenv/config"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
