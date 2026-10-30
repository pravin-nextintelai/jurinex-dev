import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
      // `server-only` throws outside a React Server Components bundler; stub it in tests.
      "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    env: {
      BARE_ACTS_API_URL: "http://backend.test",
      BARE_ACTS_API_KEY: "test-key",
      REVALIDATE_SECRET: "test-secret",
      SITE_URL: "https://example.com",
    },
  },
});
