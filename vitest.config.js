import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    restoreMocks: true,
    // Playwright owns tests/e2e; keep the two runners apart. Agent worktrees
    // live under .claude/ and carry their own copy of the suite.
    exclude: ["**/node_modules/**", "tests/e2e/**", ".claude/**"]
  }
});
