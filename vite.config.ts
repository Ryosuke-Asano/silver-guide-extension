import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";

const extensionEntries = new Set(["background", "content"]);

export default defineConfig({
  plugins: [
    react(),
    {
      name: "isolate-content-script",
      generateBundle(_options, bundle) {
        const content = bundle["content.js"];
        if (content?.type !== "chunk") return;
        if (content.imports.length > 0 || content.dynamicImports.length > 0) {
          this.error("Injected content.js must be self-contained; it cannot import shared chunks.");
        }
        // executeScript injects a classic script. Isolate lexical declarations
        // so stopping and starting on the same page never redeclares globals.
        content.code = `(() => {\n${content.code}\n})();\n`;
      }
    }
  ],
  build: {
    emptyOutDir: true,
    outDir: "dist",
    rollupOptions: {
      input: {
        popup: "popup.html",
        background: "src/background.ts",
        content: "src/content.ts"
      },
      output: {
        entryFileNames: (chunk) =>
          extensionEntries.has(chunk.name) ? "[name].js" : "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]"
      }
    }
  }
});
