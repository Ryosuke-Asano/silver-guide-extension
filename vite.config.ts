import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";

const extensionEntries = new Set(["background", "content"]);

export default defineConfig({
  plugins: [react()],
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
