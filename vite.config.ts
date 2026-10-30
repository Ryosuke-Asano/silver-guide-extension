import react from "@vitejs/plugin-react-swc";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { defineConfig, type Plugin, type ViteDevServer } from "vite";

const extensionEntries = new Set(["background"]);

// The packaged extension serves these files as opaque gzip bytes. Vite's
// default .gz response sets Content-Encoding, which makes fetch decompress
// them before the integrity check. Preserve the packaged contract in dev.
function bundledOcrModels(): Plugin {
  const attach = (server: Pick<ViteDevServer, "middlewares">) => {
    server.middlewares.use((request, response, next) => {
      const path = request.url?.split("?", 1)[0];
      const match = path?.match(/^\/assets\/tessdata\/(jpn|eng|jpn_vert)\.traineddata\.gz$/);
      if (!match || !["GET", "HEAD"].includes(request.method ?? "")) { next(); return; }
      const source = new URL(`./public/assets/tessdata/${match[1]}.traineddata.gz`, import.meta.url);
      void stat(source).then(info => {
        if (response.destroyed) return;
        response.setHeader("Content-Type", "application/octet-stream");
        response.setHeader("Content-Length", info.size);
        response.setHeader("Cache-Control", "no-cache");
        if (request.method === "HEAD") { response.end(); return; }
        const stream = createReadStream(source);
        response.once("close", () => stream.destroy());
        stream.once("error", () => response.destroy());
        stream.pipe(response);
      }, () => { if (!response.destroyed) { response.statusCode = 500; response.end(); } });
    });
  };
  return { name: "bundled-ocr-models", configureServer: attach, configurePreviewServer: attach };
}

export default defineConfig({
  plugins: [bundledOcrModels(), react()],
  build: {
    emptyOutDir: true,
    outDir: "dist",
    rollupOptions: {
      input: {
        sidebar: "sidebar.html",
        workspace: "workspace.html",
        background: "src/background.ts",
        demo: "demo/index.html",
        demoSetup: "demo/setup.html",
        demoGuide: "demo/guide.html",
        demoDayOf: "demo/day-of.html"
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
