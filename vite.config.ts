import { fileURLToPath, URL } from "node:url"

import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./check-in/src", import.meta.url)),
      "@shared": fileURLToPath(new URL("./src", import.meta.url)),
    },
    dedupe: ["react", "react-dom"],
  },
  server: { proxy: { "/api": "http://localhost:8787", "/manage/api": "http://localhost:8787" } },
  build: {
    rollupOptions: {
      input: {
        home: fileURLToPath(new URL("./index.html", import.meta.url)),
        manage: fileURLToPath(new URL("./manage/index.html", import.meta.url)),
        checkin: fileURLToPath(new URL("./check-in/index.html", import.meta.url)),
      },
    },
  },
})
