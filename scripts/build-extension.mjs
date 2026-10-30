import { build } from "vite";
import { readFile, writeFile, copyFile, cp, rm, readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { verifyPackage } from "./verify-package.mjs";
const chromium = process.argv.includes("--chromium");
const browserTarget = chromium ? "chromium" : "gecko";
const define = { __SILVER_GUIDE_BROWSER_TARGET__: JSON.stringify(browserTarget) };
const outDir = chromium ? "dist-chromium" : "dist";
const sourceFiles = ["package.json", "pnpm-lock.yaml", "vite.config.ts", "workspace.html", "sidebar.html", "public/manifest.json", "public/manifest.chromium.json", "public/assets/runtime-manifest.json"];
const collectSources = async directory => { for (const name of (await readdir(directory)).sort()) { const path = `${directory}/${name}`; if ((await stat(path)).isDirectory()) await collectSources(path); else sourceFiles.push(path); } };
for (const directory of ["src", "scripts", "public/icons", "demo"]) await collectSources(directory);
const sourceDigest = createHash("sha256");
for (const file of sourceFiles.sort()) { const bytes = await readFile(file); sourceDigest.update(file).update("\0").update(String(bytes.byteLength)).update("\0").update(bytes).update("\0"); }
const sourceHash = sourceDigest.digest("hex");
await build({ define, build: { outDir } });
// executeScript(files) requires a self-contained classic script, not an ESM entry.
await build({ configFile:false, define, build:{outDir,emptyOutDir:false,copyPublicDir:false,lib:{entry:"src/content.ts",name:"SilverGuideContent",formats:["iife"],fileName:()=>"content.js"},rollupOptions:{output:{inlineDynamicImports:true}}} });
if(chromium) await copyFile(`${outDir}/manifest.chromium.json`,`${outDir}/manifest.json`);
await cp("demo/assets", `${outDir}/demo/assets`, { recursive: true });
// Font sources and the CFF comparison fixture remain build inputs; runtime uses the static TTF.
const developmentFontInputs = new Set(["fonts/NotoSansCJKjp-Regular.otf", "fonts/NotoSansJP-VF.ttf"]);
const runtimeManifestPath = `${outDir}/assets/runtime-manifest.json`;
const runtimeManifest = JSON.parse(await readFile(runtimeManifestPath, "utf8"));
for (const file of developmentFontInputs) await rm(`${outDir}/assets/${file}`);
runtimeManifest.files = runtimeManifest.files.filter(file => !developmentFontInputs.has(file.path));
await writeFile(runtimeManifestPath, JSON.stringify(runtimeManifest, null, 2) + "\n");
const manifest=JSON.parse(await readFile(`${outDir}/manifest.json`,"utf8"));
if(manifest.version!==JSON.parse(await readFile("package.json","utf8")).version) throw new Error("Package/manifest version mismatch");
await writeFile(`${outDir}/build-info.json`,JSON.stringify({version:manifest.version,browserTarget,contentScriptFormat:"iife",sourceHash,builtAt:new Date().toISOString()},null,2));
await verifyPackage(outDir);
