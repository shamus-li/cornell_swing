import { cloudflareTest } from "@cloudflare/vitest-plugin"
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "site",
          include: ["src/**/*.test.{ts,tsx}"],
        },
      },
      {
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
          name: "worker",
          include: ["check-in/test/**/*.test.ts"],
          setupFiles: ["./check-in/test/setup.ts"],
        },
      },
    ],
  },
})
