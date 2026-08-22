import { copyFile, rm } from "node:fs/promises";
import { resolve } from "node:path";

const chromiumOutput = resolve("dist-chromium");
const chromiumManifest = resolve(chromiumOutput, "manifest.chromium.json");
const manifest = resolve(chromiumOutput, "manifest.json");

await copyFile(chromiumManifest, manifest);
await rm(chromiumManifest);
