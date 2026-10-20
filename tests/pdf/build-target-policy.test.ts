import {afterEach,describe,expect,it,vi} from "vitest";
import {mkdtemp,mkdir,readFile,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {basename,dirname,join,resolve} from "node:path";
import {localPdfDocumentParameters} from "../../src/adapters/pdf/local-resources";
import {defaultPdfAssets} from "../../src/adapters/pdf";
import {verifyPackage} from "../../scripts/verify-package.mjs";

const fixtures:string[]=[];
afterEach(async()=>{vi.unstubAllGlobals();for(const directory of fixtures.splice(0)){if(dirname(resolve(directory))!==resolve(tmpdir())||!basename(directory).startsWith("silverguide-target-"))throw new Error("Refusing unexpected cleanup path");await rm(directory,{recursive:true,force:true});}});

describe("verified browser build image policy",()=>{
  it.each([undefined,"unknown","chromium"])("uses conservative CPU image decoding for %s without trusting a Firefox user agent",target=>{
    vi.stubGlobal("__SILVER_GUIDE_BROWSER_TARGET__",target);vi.stubGlobal("navigator",{userAgent:"Mozilla/5.0 Firefox/999"});const parameters=localPdfDocumentParameters(defaultPdfAssets());
    expect(parameters.isImageDecoderSupported).toBe(false);expect(parameters.isOffscreenCanvasSupported).toBe(false);expect(parameters).toMatchObject({maxImageSize:64_000_000,canvasMaxAreaInBytes:64_000_000,useWorkerFetch:false,useSystemFonts:false,enableXfa:false});
  });
  it("lets the pinned Gecko runtime evaluate native features while keeping the same local data and image bounds",async()=>{
    vi.stubGlobal("__SILVER_GUIDE_BROWSER_TARGET__","gecko");vi.stubGlobal("navigator",{userAgent:"Mozilla/5.0 Chrome/999"});const parameters=localPdfDocumentParameters(defaultPdfAssets());
    expect("isImageDecoderSupported"in parameters).toBe(false);expect("isOffscreenCanvasSupported"in parameters).toBe(false);expect(parameters).toMatchObject({maxImageSize:64_000_000,canvasMaxAreaInBytes:64_000_000,useWorkerFetch:false,useSystemFonts:false,enableXfa:false});
    const Factory=parameters.BinaryDataFactory as new(parameters:unknown)=>{fetch:(request:{kind:string;filename:string})=>Promise<Uint8Array>};const assets=defaultPdfAssets(),factory=new Factory({cMapUrl:assets.cMaps,standardFontDataUrl:assets.standardFonts,wasmUrl:assets.wasm});const fetch=vi.fn();vi.stubGlobal("fetch",fetch);await expect(factory.fetch({kind:"cMapUrl",filename:"https://outside.invalid/model.bcmap"})).rejects.toMatchObject({code:"PDF_RESOURCE_NAME"});expect(fetch).not.toHaveBeenCalled();
  });
});

async function packageFixture(target:"gecko"|"chromium",recorded:unknown){
  const directory=await mkdtemp(join(tmpdir(),"silverguide-target-"));fixtures.push(directory);const manifest=JSON.parse(await readFile(new URL(`../../public/manifest${target==="chromium"?".chromium":""}.json`,import.meta.url),"utf8"));
  // Minimal executable fixture exercises the real verifier's file reads and
  // exact production manifest type, independently of the image helper.
  delete manifest.icons;delete manifest.action.default_icon;
  await mkdir(join(directory,"assets"));await writeFile(join(directory,"manifest.json"),JSON.stringify(manifest));await writeFile(join(directory,"build-info.json"),JSON.stringify({browserTarget:recorded}));
  for(const name of ["workspace.html","sidebar.html"])await writeFile(join(directory,name),'<script type="module" src="local.js"></script>');
  for(const name of ["local.js","content.js",manifest.background.service_worker??manifest.background.scripts[0]])await writeFile(join(directory,name),'console.log("synthetic package verification");');
  await writeFile(join(directory,"assets/runtime-manifest.json"),JSON.stringify({files:[]}));return directory;
}

describe("package target and manifest consistency",()=>{
  it.each(["gecko","chromium"]as const)("accepts a recorded %s target only with the corresponding production manifest",async target=>{await expect(verifyPackage(await packageFixture(target,target))).resolves.toBeUndefined();});
  it.each([["gecko","chromium"],["chromium","gecko"],["gecko",undefined],["chromium","unknown"]]as const)("rejects %s manifest with target %s before accepting local executable files",async(target,recorded)=>{await expect(verifyPackage(await packageFixture(target,recorded))).rejects.toThrow("Build browser target does not match the packaged manifest");});
  it("rejects a mixed Gecko/Chromium background even if its metadata claims Chromium",async()=>{const directory=await packageFixture("chromium","chromium"),manifest=JSON.parse(await readFile(join(directory,"manifest.json"),"utf8"));manifest.background.scripts=["background.js"];await writeFile(join(directory,"manifest.json"),JSON.stringify(manifest));await expect(verifyPackage(directory)).rejects.toThrow("Build browser target does not match the packaged manifest");});
  it("rejects a legacy popup even when its executable entry is local and present",async()=>{const directory=await packageFixture("gecko","gecko"),manifest=JSON.parse(await readFile(join(directory,"manifest.json"),"utf8"));manifest.action.default_popup="popup.html";await writeFile(join(directory,"popup.html"),'<script type="module" src="local.js"></script>');await writeFile(join(directory,"manifest.json"),JSON.stringify(manifest));await expect(verifyPackage(directory)).rejects.toThrow("3.0.0 must open its native side panel directly");});
  it("requires the native sidebar entry rather than an unrelated local page",async()=>{const directory=await packageFixture("chromium","chromium"),manifest=JSON.parse(await readFile(join(directory,"manifest.json"),"utf8"));manifest.side_panel.default_path="workspace.html";await writeFile(join(directory,"manifest.json"),JSON.stringify(manifest));await expect(verifyPackage(directory)).rejects.toThrow("Native explanation panel is missing");});
  it("rejects remote executable scripts in the native sidebar",async()=>{const directory=await packageFixture("chromium","chromium");await writeFile(join(directory,"sidebar.html"),'<script src="https://outside.invalid/executable.js"></script>');await expect(verifyPackage(directory)).rejects.toThrow("Remote executable HTML script");});
});
