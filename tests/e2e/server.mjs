import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures");
const port = Number(process.env.SILVER_GUIDE_TEST_PORT ?? 4187);
const mimeTypes = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8" };
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  if (pathname === "/health") {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("Silver Guide local fixtures");
    return;
  }
  if (request.method !== "GET") {
    response.writeHead(405);
    response.end("These fictional fixtures never accept submissions.");
    return;
  }
  // Serve only the fixture directory, including when an encoded traversal is requested.
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    response.writeHead(400);
    response.end();
    return;
  }
  const requestedPath = path.resolve(fixtures, `.${decodedPath}`);
  if (!requestedPath.startsWith(`${fixtures}${path.sep}`)) {
    response.writeHead(404);
    response.end();
    return;
  }
  try {
    const data = await readFile(requestedPath);
    response.writeHead(200, { "content-type": mimeTypes[path.extname(requestedPath)] ?? "application/octet-stream" });
    response.end(data);
  } catch {
    response.writeHead(404);
    response.end();
  }
});
server.listen(port, "127.0.0.1");
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
