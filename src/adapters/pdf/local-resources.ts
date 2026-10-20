import catalogue from "./resource-catalog.json";
import type {DocumentInitParameters} from "pdfjs-dist/types/src/display/api";
import {PdfEngineError,type PdfAssetPaths} from "../../domain/pdf";
declare const __SILVER_GUIDE_BROWSER_TARGET__: "gecko"|"chromium"|undefined;

type ResourceKind="cMapUrl"|"standardFontDataUrl"|"wasmUrl";
const directories:Record<ResourceKind,string>={cMapUrl:"pdfjs/cmaps/",standardFontDataUrl:"pdfjs/standard_fonts/",wasmUrl:"pdfjs/wasm/"};
const allowed=new Map<string,{bytes:number;sha256:string}>();
for(const file of catalogue)for(const [kind,directory]of Object.entries(directories))if(file.path.startsWith(directory)&&!file.path.slice(directory.length).includes("/")&&/\.(?:bcmap|pfb|ttf|wasm)$/.test(file.path))allowed.set(`${kind}:${file.path.slice(directory.length)}`,file);

/** Exact runtime.getURL/default URL equality also works for extension schemes with null origin. */
export function lockPdfAssets(assets:PdfAssetPaths,expected:PdfAssetPaths):PdfAssetPaths{
  const locked={...expected};for(const key of Object.keys(expected)as Array<keyof PdfAssetPaths>){let url:URL;try{url=new URL(assets[key],expected[key]);}catch{throw new PdfEngineError("PDF_RESOURCE_LOCATION","PDFの実行資源は同梱したファイルだけを利用できます。");}
    if(url.username||url.password||url.search||url.hash||url.href!==new URL(expected[key]).href)throw new PdfEngineError("PDF_RESOURCE_LOCATION","PDFの実行資源は同梱したファイルだけを利用できます。");locked[key]=url.href;
  }return locked;
}

/** The pinned PDF.js 6 API has no isEvalSupported option. No scripting viewer is instantiated. */
export function localPdfDocumentParameters(assets:PdfAssetPaths):DocumentInitParameters{
  const bases:Record<ResourceKind,string>={cMapUrl:assets.cMaps,standardFontDataUrl:assets.standardFonts,wasmUrl:assets.wasm};
  class LocalBinaryDataFactory{
    constructor(parameters:Record<ResourceKind,string>){for(const kind of Object.keys(bases)as ResourceKind[])if(parameters[kind]!==bases[kind])throw new PdfEngineError("PDF_RESOURCE_LOCATION","PDF資源の場所を確認できません。");}
    async fetch(request:{kind:string;filename:string}):Promise<Uint8Array>{
      const resource=allowed.get(`${request.kind}:${request.filename}`),base=bases[request.kind as ResourceKind];if(!resource||!base)throw new PdfEngineError("PDF_RESOURCE_NAME","PDFが指定した資源は同梱の許可一覧にありません。");
      const url=new URL(request.filename,base).href;if(url!==`${base}${request.filename}`)throw new PdfEngineError("PDF_RESOURCE_NAME","PDF資源の名前が不正です。");
      const response=await fetch(url,{credentials:"omit",redirect:"error"});if(!response.ok||response.redirected||response.url&&new URL(response.url).href!==url)throw new PdfEngineError("PDF_RESOURCE_UNAVAILABLE","同梱したPDF資源を読み込めません。");
      const length=response.headers.get("Content-Length"),encoding=response.headers.get("Content-Encoding");if(length!==null&&(!encoding||encoding==="identity")&&Number(length)!==resource.bytes)throw new PdfEngineError("PDF_RESOURCE_INTEGRITY","PDF資源の大きさが同梱の記録と一致しません。");let bytes:Uint8Array;
      if(response.body){bytes=new Uint8Array(resource.bytes);const reader=response.body.getReader();let offset=0;try{for(;;){const chunk=await reader.read();if(chunk.done)break;if(offset+chunk.value.length>resource.bytes){await reader.cancel();throw new PdfEngineError("PDF_RESOURCE_INTEGRITY","PDF資源が同梱の記録より大きいため読み込みを中止しました。");}bytes.set(chunk.value,offset);offset+=chunk.value.length;}if(offset!==resource.bytes)throw new PdfEngineError("PDF_RESOURCE_INTEGRITY","PDF資源の大きさが同梱の記録と一致しません。");}finally{reader.releaseLock();}}
      else bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length!==resource.bytes)throw new PdfEngineError("PDF_RESOURCE_INTEGRITY","PDF資源の大きさが同梱の記録と一致しません。");
      const digest=await crypto.subtle.digest("SHA-256",bytes.buffer as ArrayBuffer),hex=Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,"0")).join("");if(hex!==resource.sha256)throw new PdfEngineError("PDF_RESOURCE_INTEGRITY","PDF資源の検証に失敗しました。");return bytes;
    }
  }
  // The build target is fixed by the package builder and checked against its
  // manifest. Chromium's measured native allocations survive cleanup; Gecko's
  // CPU fallback exceeds the standard memory budget. Unknown/dev builds use
  // conservative CPU arrays. Gecko feature support remains PDF.js-owned.
  const nativeGecko = typeof __SILVER_GUIDE_BROWSER_TARGET__ !== "undefined" && __SILVER_GUIDE_BROWSER_TARGET__ === "gecko";
  return {cMapUrl:assets.cMaps,cMapPacked:true,standardFontDataUrl:assets.standardFonts,wasmUrl:assets.wasm,BinaryDataFactory:LocalBinaryDataFactory,useWorkerFetch:false,useSystemFonts:false,enableXfa:false,withCredentials:false,disableAutoFetch:true,disableRange:true,disableStream:true,stopAtErrors:true,...(nativeGecko?{}:{isImageDecoderSupported:false,isOffscreenCanvasSupported:false}),maxImageSize:64_000_000,canvasMaxAreaInBytes:64_000_000};
}

