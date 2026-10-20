import {afterEach,beforeAll,beforeEach,describe,expect,it,vi} from "vitest";
import {readFile} from "node:fs/promises";
import {webcrypto} from "node:crypto";
import {createRequire} from "node:module";
import {createWorker,type Worker as TesseractWorker} from "tesseract.js";
import {LocalOcr} from "../../src/workers/pdf/ocr";
import type {PdfAssetPaths} from "../../src/domain/pdf";

vi.mock("tesseract.js",()=>({createWorker:vi.fn(),OEM:{LSTM_ONLY:1},PSM:{SPARSE_TEXT:11}}));

const assets:PdfAssetPaths={worker:"moz-extension://qa/assets/pdf.worker.mjs",cMaps:"moz-extension://qa/assets/cmaps/",standardFonts:"moz-extension://qa/assets/fonts/",wasm:"moz-extension://qa/assets/wasm/",ocrWorker:"moz-extension://qa/assets/ocr/worker.min.js",ocrCore:"moz-extension://qa/assets/ocr/",ocrLanguages:"moz-extension://qa/assets/tessdata",japaneseFont:"moz-extension://qa/assets/japanese.ttf"};
const matrix:[number,number,number,number,number,number]=[1,0,0,-1,0,100];
const models=new Map<string,Uint8Array>();
const natives:NativeWorker[]=[];
const pinnedSend=createRequire(import.meta.url)("../../node_modules/tesseract.js/src/worker/browser/send.js") as (native:Worker,message:unknown)=>Promise<void>;
class NativeWorker extends EventTarget{
  terminate=vi.fn();
  send=vi.fn();postMessage=this.send;
  constructor(readonly url:string|URL){super();natives.push(this);}
}
const image={toBlob:(callback:(blob:Blob|null)=>void)=>callback(new Blob([new Uint8Array([1,2,3])],{type:"image/png"}))} as HTMLCanvasElement;
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(cause:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
function result(text="氏名") {return {data:{blocks:[{paragraphs:[{lines:[{text,bbox:{x0:2,y0:10,x1:8,y1:20},confidence:91}]}]}]}};}
function worker(){return{setParameters:vi.fn(async()=>({})),recognize:vi.fn(async()=>result()),terminate:vi.fn(async()=>({}))} as unknown as TesseractWorker;}
function start(mockWorker:TesseractWorker=worker()){
  vi.mocked(createWorker).mockImplementation(async(languages,_oem,options)=>{const native=new globalThis.Worker(options!.workerPath!);native.postMessage({action:"loadLanguage",payload:{langs:languages}});native.postMessage({action:"initialize",payload:{langs:languages}});return mockWorker;});
  return mockWorker;
}
async function booted(){await vi.waitFor(()=>expect(createWorker).toHaveBeenCalledOnce());}

beforeAll(async()=>{for(const name of ["jpn","eng","jpn_vert"])models.set(`${name}.traineddata.gz`,new Uint8Array(await readFile(new URL(`../../public/assets/tessdata/${name}.traineddata.gz`,import.meta.url))));});
beforeEach(()=>{
  vi.clearAllMocks();natives.length=0;vi.stubGlobal("crypto",webcrypto);vi.stubGlobal("Worker",NativeWorker);vi.stubGlobal("OffscreenCanvas",undefined);
  vi.stubGlobal("fetch",vi.fn(async(input:string|URL)=>{const bytes=models.get(new URL(input).pathname.split("/").at(-1)!);return bytes?new Response(bytes.slice()):new Response(null,{status:404});}));
});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});

describe("owned local OCR lifecycle",()=>{
  it("feeds verified bundled model bytes to initialization without worker model fetch/cache, and transforms real line results",async()=>{
    const api=start(),ocr=new LocalOcr(assets),evidence=await ocr.recognize(image,3,matrix);
    expect(evidence).toMatchObject([{pageIndex:3,text:"氏名",rawOcrConfidence:91,quad:[{x:2,y:90},{x:8,y:90},{x:8,y:80},{x:2,y:80}]}]);
    const [languages,,options]=vi.mocked(createWorker).mock.calls[0];
    expect(languages).toBe("jpn+eng+jpn_vert");const sent=natives[0].send.mock.calls[0][0] as {payload:{langs:Array<{code:string;data:Uint8Array}>}};expect(sent.payload.langs.map(value=>value.code)).toEqual(["jpn","eng","jpn_vert"]);expect(sent.payload.langs.map(value=>value.data.length)).toEqual([...models.values()].map(value=>value.length));
    expect(options).toMatchObject({workerPath:assets.ocrWorker,workerBlobURL:false,cacheMethod:"none"});
    expect(natives[0].postMessage).toBe(natives[0].send);expect(natives[0].send.mock.calls[1][0]).toMatchObject({action:"initialize",payload:{langs:"jpn+eng+jpn_vert"}});
    expect(vi.mocked(fetch).mock.calls.map(call=>String(call[0]))).toEqual(["jpn","eng","jpn_vert"].map(code=>`${assets.ocrLanguages}/${code}.traineddata.gz`));
    expect(globalThis.Worker).toBe(NativeWorker);expect(api.recognize).toHaveBeenCalledOnce();await ocr.dispose();expect(natives[0].terminate).toHaveBeenCalledOnce();
  });
  it("rejects a failed pinned language initializer whose outer createWorker promise remains pending, and terminates its native worker",async()=>{
    let fail!:NonNullable<Parameters<typeof createWorker>[2]>["errorHandler"];
    vi.mocked(createWorker).mockImplementation((_languages,_oem,options)=>{new globalThis.Worker(options!.workerPath!);fail=options!.errorHandler;return new Promise(()=>{});});
    const ocr=new LocalOcr(assets),job=ocr.recognize(image,0,matrix),rejected=expect(job).rejects.toMatchObject({code:"OCR_INITIALIZE_FAILED"});await booted();fail!(new Error("loadLanguage failed"));await rejected;
    expect(natives[0].terminate).toHaveBeenCalledOnce();expect(globalThis.Worker).toBe(NativeWorker);
    expect(natives[0].postMessage).toBe(natives[0].send);
  });
  it("aborts pending initialization immediately, rejects queued jobs, and cannot resurrect a late initialized worker",async()=>{
    const initialization=deferred<TesseractWorker>(),api=worker();vi.mocked(createWorker).mockImplementation((_languages,_oem,options)=>{new globalThis.Worker(options!.workerPath!);return initialization.promise;});
    const ocr=new LocalOcr(assets),controller=new AbortController(),first=ocr.recognize(image,0,matrix,{signal:controller.signal}),second=ocr.recognize(image,1,matrix);
    const firstRejected=expect(first).rejects.toMatchObject({name:"AbortError"}),secondRejected=expect(second).rejects.toMatchObject({name:"AbortError"});await booted();controller.abort();await Promise.all([firstRejected,secondRejected]);
    expect(natives[0].terminate).toHaveBeenCalledOnce();initialization.resolve(api);await vi.waitFor(()=>expect(api.terminate).toHaveBeenCalledOnce());expect(api.recognize).not.toHaveBeenCalled();
    await expect(ocr.recognize(image,2,matrix)).rejects.toMatchObject({code:"OCR_DISPOSED"});
  });
  it.each([0,2])("fails closed when upstream synchronously creates %i workers instead of one",async(count)=>{
    const api=worker();vi.mocked(createWorker).mockImplementation(async(_languages,_oem,options)=>{for(let i=0;i<count;i++)new globalThis.Worker(options!.workerPath!);return api;});
    await expect(new LocalOcr(assets).recognize(image,0,matrix)).rejects.toMatchObject({code:"OCR_WORKER_OWNERSHIP"});expect(natives).toHaveLength(count);for(const native of natives)expect(native.terminate).toHaveBeenCalledOnce();expect(api.recognize).not.toHaveBeenCalled();expect(globalThis.Worker).toBe(NativeWorker);
  });
  it("terminates an already captured worker if upstream throws during a later worker spawn",async()=>{
    vi.mocked(createWorker).mockImplementation((_languages,_oem,options)=>{new globalThis.Worker(options!.workerPath!);new globalThis.Worker("https://outside.invalid/worker.js");throw new Error("unreachable");});
    await expect(new LocalOcr(assets).recognize(image,0,matrix)).rejects.toMatchObject({code:"OCR_WORKER_LOCATION"});expect(natives).toHaveLength(1);expect(natives[0].terminate).toHaveBeenCalledOnce();expect(globalThis.Worker).toBe(NativeWorker);
  });
  it("rejects a changed pinned model-load protocol rather than allowing a worker-side fetch fallback",async()=>{
    const api=worker();vi.mocked(createWorker).mockImplementation(async(_languages,_oem,options)=>{const native=new globalThis.Worker(options!.workerPath!);void pinnedSend(native,{action:"loadLanguage",payload:{langs:"outside"}});return api;});
    await expect(new LocalOcr(assets).recognize(image,0,matrix)).rejects.toMatchObject({code:"OCR_MODEL_PROTOCOL"});expect(natives[0].send).not.toHaveBeenCalled();expect(natives[0].terminate).toHaveBeenCalledOnce();
    vi.mocked(createWorker).mockImplementation(async(_languages,_oem,options)=>{new globalThis.Worker(options!.workerPath!);return api;});
    await expect(new LocalOcr(assets).recognize(image,0,matrix)).rejects.toMatchObject({code:"OCR_MODEL_PROTOCOL"});expect(api.recognize).not.toHaveBeenCalled();
  });
  it("rejects a structured-clone failure through the owned result without rejecting pinned send's ignored async promise",async()=>{
    vi.mocked(createWorker).mockImplementation((_languages,_oem,options)=>{const native=new globalThis.Worker(options!.workerPath!);natives[0].send.mockImplementation(()=>{throw new DOMException("Cannot clone","DataCloneError");});void pinnedSend(native,{action:"loadLanguage",payload:{langs:"jpn+eng+jpn_vert"}});return new Promise(()=>{});});
    await expect(new LocalOcr(assets).recognize(image,0,matrix)).rejects.toMatchObject({code:"OCR_INITIALIZE_FAILED"});expect(natives[0].terminate).toHaveBeenCalledOnce();expect(natives[0].postMessage).toBe(natives[0].send);
  });
  it("normalizes an upstream undefined initializer rejection into an associated engine error",async()=>{
    vi.mocked(createWorker).mockImplementation((_languages,_oem,options)=>{new globalThis.Worker(options!.workerPath!);return Promise.reject(undefined);});
    await expect(new LocalOcr(assets).recognize(image,0,matrix)).rejects.toMatchObject({code:"OCR_INITIALIZE_FAILED"});expect(natives[0].terminate).toHaveBeenCalledOnce();
  });
  it("bounds a hung initializer, including native termination, instead of leaving a timed out library promise alive",async()=>{
    vi.mocked(createWorker).mockImplementation((_languages,_oem,options)=>{new globalThis.Worker(options!.workerPath!);return new Promise(()=>{});});
    vi.useFakeTimers();const job=new LocalOcr(assets).recognize(image,0,matrix),rejected=expect(job).rejects.toMatchObject({code:"OCR_INITIALIZE_TIMEOUT"});await booted();await vi.advanceTimersByTimeAsync(30_000);await rejected;expect(natives[0].terminate).toHaveBeenCalledOnce();
  });
  it("includes model prefetch in the initialization deadline and cancels that fetch before any worker exists",async()=>{
    let modelSignal:AbortSignal|undefined;vi.mocked(fetch).mockImplementation((_input,options)=>{modelSignal=options?.signal as AbortSignal;return new Promise((_resolve,reject)=>modelSignal!.addEventListener("abort",()=>reject(new DOMException("Aborted","AbortError")),{once:true}));});
    vi.useFakeTimers();const job=new LocalOcr(assets).recognize(image,0,matrix),rejected=expect(job).rejects.toMatchObject({code:"OCR_INITIALIZE_TIMEOUT"});await vi.waitFor(()=>expect(fetch).toHaveBeenCalledOnce());await vi.advanceTimersByTimeAsync(30_000);await rejected;expect(modelSignal!.aborted).toBe(true);expect(natives).toHaveLength(0);
  });
  it("serializes recognition and cancelling a queued page preserves the active page worker",async()=>{
    const api=start(),active=deferred<Awaited<ReturnType<TesseractWorker["recognize"]>>>();vi.mocked(api.recognize).mockReturnValueOnce(active.promise);const ocr=new LocalOcr(assets),controller=new AbortController();
    const first=ocr.recognize(image,2,matrix),queued=ocr.recognize(image,7,matrix,{signal:controller.signal}),rejected=expect(queued).rejects.toMatchObject({name:"AbortError"});await vi.waitFor(()=>expect(api.recognize).toHaveBeenCalledOnce());controller.abort();await rejected;expect(natives[0].terminate).not.toHaveBeenCalled();
    active.resolve(result("住所") as Awaited<ReturnType<TesseractWorker["recognize"]>>);expect((await first)[0].pageIndex).toBe(2);expect((await ocr.recognize(image,9,matrix))[0].pageIndex).toBe(9);expect(api.recognize).toHaveBeenCalledTimes(2);await ocr.dispose();
  });
  it("rejects every pending recognition on a native message decoding error and stops the actual native target",async()=>{
    const api=start();vi.mocked(api.recognize).mockReturnValue(new Promise(()=>{}));const ocr=new LocalOcr(assets),first=ocr.recognize(image,0,matrix),second=ocr.recognize(image,1,matrix);
    const one=expect(first).rejects.toMatchObject({code:"OCR_INITIALIZE_FAILED"}),two=expect(second).rejects.toMatchObject({code:"OCR_INITIALIZE_FAILED"});await vi.waitFor(()=>expect(api.recognize).toHaveBeenCalledOnce());natives[0].dispatchEvent(new Event("messageerror"));await Promise.all([one,two]);expect(natives[0].terminate).toHaveBeenCalledOnce();
  });
  it("fails PNG conversion returning null without starting recognition or hanging in the library loader",async()=>{
    const api=start(),bad={toBlob:(callback:(blob:Blob|null)=>void)=>callback(null)} as HTMLCanvasElement;
    await expect(new LocalOcr(assets).recognize(bad,0,matrix)).rejects.toMatchObject({code:"OCR_IMAGE_ENCODING_FAILED"});expect(api.recognize).not.toHaveBeenCalled();expect(natives[0].terminate).toHaveBeenCalledOnce();
  });
  it("rejects tampered or oversized bundled model bytes before creating any native OCR worker",async()=>{
    start();const original=models.get("jpn.traineddata.gz")!,tampered=original.slice();tampered[0]^=1;vi.mocked(fetch).mockResolvedValueOnce(new Response(tampered));
    await expect(new LocalOcr(assets).recognize(image,0,matrix)).rejects.toMatchObject({code:"OCR_RESOURCE_INTEGRITY"});vi.mocked(fetch).mockResolvedValueOnce(new Response(new Uint8Array(original.length+1)));
    await expect(new LocalOcr(assets).recognize(image,0,matrix)).rejects.toMatchObject({code:"OCR_RESOURCE_INTEGRITY"});expect(createWorker).not.toHaveBeenCalled();expect(natives).toHaveLength(0);
  });
});
