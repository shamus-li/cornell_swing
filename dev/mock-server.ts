import type { Plugin, ViteDevServer } from "vite"

// Runs dev/mock-api.ts behind `npm run dev`. Vite loads it so that it can use the site's code and hot reload with it.
export function mockServer(): Plugin {
  let server: ViteDevServer
  const api = () => server.ssrLoadModule("/dev/mock-api.ts")
  return {
    name: "mock-server",
    apply: "serve",
    configureServer(dev) {
      server = dev
      dev.middlewares.use((req, res, next) => void api().then(({ handle }) => handle(req, res, next)).catch(next))
    },
    async transformIndexHtml(html) {
      return (await api()).renderPage(html)
    },
  }
}
