import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const routes = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/guide.html", ["guide.html", "text/html; charset=utf-8"]],
  ["/mock.css", ["mock.css", "text/css; charset=utf-8"]],
  ["/mock.js", ["mock.js", "text/javascript; charset=utf-8"]],
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

export function createDemoServer() {
  const handle = async (request, response) => {
    let url;
    try { url = new URL(request.url ?? "/", "http://127.0.0.1"); }
    catch { response.writeHead(400, securityHeaders); response.end(); return; }
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
  return createServer((request, response) => {
    void handle(request, response).catch(() => response.destroy());
  });
}

export async function listenDemoServer(port) {
  const server = createDemoServer();
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
