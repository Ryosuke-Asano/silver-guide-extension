import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { measurementStore } from "./measurement-store.mjs";
import { resultsCsv } from "./measurement-model.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const routes = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/guide.html", ["guide.html", "text/html; charset=utf-8"]],
  ["/mock.css", ["mock.css", "text/css; charset=utf-8"]],
  ["/mock.js", ["mock.js", "text/javascript; charset=utf-8"]],
  ["/measurement.js", ["measurement.js", "text/javascript; charset=utf-8"]],
  ["/measurement-model.js", ["measurement-model.js", "text/javascript; charset=utf-8"]],
  ["/bundled.js", ["bundled.js", "text/javascript; charset=utf-8"]],
  ["/local-measurement.js", ["local-measurement.js", "text/javascript; charset=utf-8"]],
  ["/results.html", ["results.html", "text/html; charset=utf-8"]],
  ["/results.js", ["results.js", "text/javascript; charset=utf-8"]],
  ["/assets/library-application-original.pdf", ["assets/library-application-original.pdf", "application/pdf"]],
  ["/assets/library-application-fillable.pdf", ["assets/library-application-fillable.pdf", "application/pdf"]],
  ["/assets/library-application-preview.png", ["assets/library-application-preview.png", "image/png"]],
  ["/assets/library-application-source.json", ["assets/library-application-source.json", "application/json; charset=utf-8"]]
]);

const securityHeaders = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store"
};

export function createDemoServer({ measurement } = {}) {
  const store = measurement ? measurementStore(measurement) : null;
  const pending = new Set();
  const handle = async (request, response) => {
    const json = (status, body) => { response.writeHead(status, { ...securityHeaders, "Content-Type": "application/json; charset=utf-8" }); response.end(JSON.stringify(body)); };
    let url;
    try { url = new URL(request.url ?? "/", "http://127.0.0.1"); }
    catch { response.writeHead(400, securityHeaders); response.end(); return; }
    if (url.pathname.startsWith("/api/measurement")) {
      const origin = `http://127.0.0.1:${request.socket.localPort}`;
      if (request.headers.host !== new URL(origin).host || request.headers.origin && request.headers.origin !== origin || request.headers["sec-fetch-site"] === "cross-site") { json(403, { error: "同じローカルデモから操作してください。" }); return; }
      try {
        if (request.method === "GET" && url.pathname === "/api/measurement/config") { json(200, store?.config ?? { enabled: false }); return; }
        if (!store) { json(404, { error: "計測はdev:demoから起動してください。" }); return; }
        if (request.method === "GET" && url.pathname === "/api/measurement/results") { json(200, { runs: await store.all() }); return; }
        if (request.method === "GET" && url.pathname === "/api/measurement/results.csv") {
          const csv = resultsCsv(await store.all());
          response.writeHead(200, { ...securityHeaders, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="silver-guide-results.csv"' }); response.end(csv); return;
        }
        if (request.method === "POST" && url.pathname === "/api/measurement") {
          if (request.headers.origin !== origin || request.headers["content-type"] !== "application/json") { json(403, { error: "同じローカルデモからJSONで操作してください。" }); return; }
          const chunks = []; let size = 0;
          for await (const chunk of request) { size += chunk.length; if (size > 2048) { json(413, { error: "計測データが長すぎます。" }); return; } chunks.push(chunk); }
          let body; try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { json(400, { error: "JSONを確認してください。" }); return; }
          json(200, { run: await store.apply(body) }); return;
        }
        json(405, { error: "この計測操作は利用できません。" }); return;
      } catch (error) { json(error.status ?? 500, { error: error.status ? error.message : "計測結果を保存できません。保存先の空き容量・アクセス権を確認してください。" }); return; }
    }
    if (!["GET", "HEAD"].includes(request.method ?? "")) {
      response.writeHead(405, { ...securityHeaders, Allow: "GET, HEAD" });
      response.end();
      return;
    }
    if (url.pathname === "/pdf.html") { response.writeHead(302, { ...securityHeaders, Location: "/#pdf-fields" }); response.end(); return; }
    if (url.pathname === "/favicon.ico") { response.writeHead(204, securityHeaders); response.end(); return; }
    const entry = routes.get(url.pathname);
    if (!entry) { response.writeHead(404, securityHeaders); response.end("Demo file not found"); return; }
    try {
      const filename = path.join(root, entry[0]);
      const info = await stat(filename);
      const headers = { ...securityHeaders, "Content-Type": entry[1], "Content-Length": info.size };
      if (entry[1] === "application/pdf" && url.searchParams.get("download") === "1") {
        headers["Content-Disposition"] = `attachment; filename="${path.basename(entry[0])}"`;
      }
      const body = request.method === "HEAD" ? undefined : await readFile(filename);
      response.writeHead(200, headers);
      response.end(body);
    } catch {
      response.writeHead(404, securityHeaders);
      response.end("Demo file is not ready");
    }
  };
  const server = createServer((request, response) => {
    const work = handle(request, response); pending.add(work);
    void work.catch(() => response.destroy()).finally(() => pending.delete(work));
  });
  server.flushMeasurements = async () => { await Promise.allSettled([...pending]); await store?.flush(); };
  return server;
}

export async function listenDemoServer(port, options) {
  const server = createDemoServer(options);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => { server.off("error", reject); resolve(); });
  });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.SILVERGUIDE_DEMO_PORT || 4187);
  try {
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid local demo port");
    const server = await listenDemoServer(port);
    console.log(`Yokohama Library local mock: http://127.0.0.1:${port}/`);
    console.log("Local test only. No application data is sent or stored. Ctrl+C stops this server.");
    for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { server.close(() => process.exit(0)); server.closeAllConnections(); });
  } catch (error) {
    console.error(error.code === "EADDRINUSE" ? `Port ${port} is already in use. Close the previous local demo server first.` : error.message);
    process.exitCode = 1;
  }
}
