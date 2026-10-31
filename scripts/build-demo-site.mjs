import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const DEMO_SITE_FILES = ["index.html", "guide.html", "day-of.html", "mock.js", "mock.css",
  "assets/library-application-original.pdf", "assets/library-application-fillable.pdf",
  "assets/library-application-preview.png"];

/** Explicit allowlist: no extension runtime, server, measurements or test data. */
export async function buildDemoSite(directory = join(root, "dist-demo")) {
  await mkdir(directory, { recursive: true });
  for (const name of DEMO_SITE_FILES) {
    const target = join(directory, name);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(root, "demo", name), target);
  }
  await writeFile(join(directory, ".nojekyll"), "");
  return directory;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = join(root, "dist-demo");
  await rm(directory, { recursive: true, force: true });
  await buildDemoSite(directory);
  console.log(`Static demo prepared: ${directory}`);
}
