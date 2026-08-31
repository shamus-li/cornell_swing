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
const { html, socialImage, scheduleData } = await render()
let template = await readFile("dist/index.html", "utf8")

const stylesheet = template.match(/<link rel="stylesheet"[^>]+href="([^"]+)"[^>]*>/)
if (!stylesheet) throw new Error("Homepage template is missing its stylesheet")
const css = await readFile(new URL(`../dist${stylesheet[1]}`, import.meta.url), "utf8")
template = template.replace(stylesheet[0], `<style>${css}</style>`)

if (!["<!--app-html-->", "<!--social-image-->", "<!--schedule-data-->"].every((placeholder) => template.includes(placeholder))) {
  throw new Error("Homepage template is missing its prerender placeholders")
}

await writeFile(
  "dist/index.html",
  template.replace("<!--app-html-->", () => html)
    .replace("<!--social-image-->", () => socialImage)
    .replace("<!--schedule-data-->", () => scheduleData),
)
