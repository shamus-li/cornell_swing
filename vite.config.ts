import { fileURLToPath, URL } from "node:url"

import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

import { mockServer } from "./dev/mock-server"

export default defineConfig({
  plugins: [react(), tailwindcss(), mockServer()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./check-in/src", import.meta.url)),
      "@shared": fileURLToPath(new URL("./src", import.meta.url)),
    },
    dedupe: ["react", "react-dom"],
  },
  // The mock server renders pages using code that imports this package, which Node cannot load unbundled.
  ssr: { noExternal: ["validator"] },
  build: {
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: {
        home: fileURLToPath(new URL("./index.html", import.meta.url)),
        manage: fileURLToPath(new URL("./manage/index.html", import.meta.url)),
        checkin: fileURLToPath(new URL("./check-in/index.html", import.meta.url)),
        door: fileURLToPath(new URL("./check-in/door/index.html", import.meta.url)),
        redirects: fileURLToPath(new URL("./redirects/index.html", import.meta.url)),
        dances: fileURLToPath(new URL("./events/index.html", import.meta.url)),
        event: fileURLToPath(new URL("./events/event/index.html", import.meta.url)),
      },
    },
  },
})
