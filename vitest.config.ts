import { fileURLToPath, URL } from "node:url"
import { cloudflareTest } from "@cloudflare/vitest-plugin"
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias: { "@": fileURLToPath(new URL("./check-in/src", import.meta.url)), "@shared": fileURLToPath(new URL("./src", import.meta.url)) } },
        plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" }, miniflare: { bindings: { ACCESS_TEAM_DOMAIN: "test.cloudflareaccess.com", ACCESS_AUD: "test-aud" } } })],
        test: { name: "events", include: ["src/events/worker.test.ts"] },
      },
      {
        resolve: { alias: { "@": fileURLToPath(new URL("./check-in/src", import.meta.url)), "@shared": fileURLToPath(new URL("./src", import.meta.url)) } },
        test: {
          name: "site",
          include: ["src/**/*.test.{ts,tsx}"],
          exclude: ["src/events/worker.test.ts"],
        },
      },
      {
        resolve: { alias: { "@": fileURLToPath(new URL("./check-in/src", import.meta.url)), "@shared": fileURLToPath(new URL("./src", import.meta.url)) } },
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
