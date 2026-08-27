import { cloudflareTest } from "@cloudflare/vitest-plugin"
import { defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./check-in/worker/index.ts",
      wrangler: { configPath: "./wrangler.cron.jsonc" },
      miniflare: {
        compatibilityDate: "2026-08-26",
        compatibilityFlags: ["nodejs_compat"],
        kvNamespaces: ["MEMBER_CACHE"],
        bindings: {
          NOTION_MEMBERS_DATA_SOURCE_ID: "6963065b-1352-4663-bf1a-fb3ed656e018",
          NOTION_EVENTS_DATA_SOURCE_ID: "687e0df9-8bc6-4383-99b0-9a7ffcbaf5a5",
          GOOGLE_SPREADSHEET_ID: "1LolWpgKRUjYE45S3UrxWLPqtek0FfEmlcbKNr4Mm2AQ",
          GOOGLE_SHEET_NAME: "Check-ins",
          TIME_ZONE: "America/New_York",
          NOTION_TOKEN: "test-token",
          GOOGLE_SERVICE_ACCOUNT_EMAIL: "test@example.iam.gserviceaccount.com",
          GOOGLE_PRIVATE_KEY: "test-key",
        },
        serviceBindings: {
          ASSETS: () => new Response("asset"),
        },
      },
    }),
  ],
  test: {
    setupFiles: ["./check-in/test/setup.ts"],
  },
})
