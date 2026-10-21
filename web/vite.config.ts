import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The panel is embedded into the Go binary from internal/panel/dist and served at /panel/.
export default defineConfig({
  base: "/panel/",
  plugins: [react(), tailwindcss()],
  build: { outDir: "../internal/panel/dist", emptyOutDir: true },
  server: {
    proxy: { "/v8": process.env.LOWCP_API ?? "http://127.0.0.1:8317", "/v1": process.env.LOWCP_API ?? "http://127.0.0.1:8317" },
  },
});
