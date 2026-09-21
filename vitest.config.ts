import { cloudflareTest } from "@cloudflare/vitest-plugin"
import { defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          NOTION_TOKEN: "test-token",
          GOOGLE_SERVICE_ACCOUNT_EMAIL: "test@example.iam.gserviceaccount.com",
          GOOGLE_PRIVATE_KEY: "test-key",
        },
      },
    }),
  ],
  test: {
    setupFiles: ["./check-in/test/setup.ts"],
  },
})
