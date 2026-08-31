import { readFile, writeFile } from "node:fs/promises"
import { build } from "vite"

// Both outputs use the same React components and Vite asset processing. Only
// dist/ is deployed; the server bundle runs once here, never on Cloudflare.
await build()
await build({
  build: {
    ssr: "src/site/entry-server.tsx",
    outDir: "dist-ssr",
  },
})

const { render } = await import("../dist-ssr/entry-server.js")
const { html, socialImage } = render()
const template = await readFile("dist/index.html", "utf8")

if (!template.includes("<!--app-html-->") || !template.includes("<!--social-image-->")) {
  throw new Error("Homepage template is missing its prerender placeholders")
}

await writeFile(
  "dist/index.html",
  template.replace("<!--app-html-->", () => html)
    .replace("<!--social-image-->", () => socialImage),
)
