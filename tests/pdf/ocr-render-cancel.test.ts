import {afterAll,beforeAll,describe,expect,it} from "vitest";
import {createServer,type ViteDevServer} from "vite";
import {chromium,type Browser} from "playwright";
import {existsSync} from "node:fs";

describe("actual OCR owner cancellation during the next page render",()=>{
  let server:ViteDevServer,browser:Browser,origin:string;
  beforeAll(async()=>{server=await createServer({server:{host:"127.0.0.1",port:0}});await server.listen();const address=server.httpServer!.address();if(!address||typeof address==="string")throw new Error("No test server");origin=`http://127.0.0.1:${address.port}`;browser=await chromium.launch({headless:true,...(!existsSync(chromium.executablePath())?{channel:"msedge"}:{})});},30000);
  afterAll(async()=>{await browser?.close();await server?.close();});
  it("stops the idle native OCR worker on render abort, keeps the completed page and creates a fresh owner for retry",async()=>{
    const page=await browser.newPage(),started:string[]=[],errors:string[]=[];let ocrWorkersActive=0,maxActive=0;const destroyed:number[]=[];
    page.on("pageerror",error=>errors.push(error.message));page.on("worker",worker=>{if(worker.url().includes("tesseract/worker")){started.push(worker.url());ocrWorkersActive++;maxActive=Math.max(maxActive,ocrWorkersActive);worker.on("close",()=>{ocrWorkersActive--;destroyed.push(Date.now());});}});
    try{await page.goto(`${origin}/tests/pdf/ocr-render-cancel-harness.html`);await page.waitForFunction(()=>Boolean((window as unknown as {ocrRenderCancelTest:unknown}).ocrRenderCancelTest));const result=await page.evaluate(()=> (window as unknown as {ocrRenderCancelTest:()=>Promise<{insidePendingRender:boolean;cancelMs:number;cancellation:string;firstPageRetained:boolean;partial:number;retryComplete:boolean;retryEvidence:string[]}>}).ocrRenderCancelTest());
      expect(result).toMatchObject({insidePendingRender:true,cancellation:"AbortError",firstPageRetained:true,retryComplete:true});expect(result.partial).toBeGreaterThan(0);expect(result.retryEvidence.join(" ")).toContain("SECOND PAGE");expect(result.cancelMs).toBeLessThan(1000);expect(started).toHaveLength(2);expect(maxActive).toBe(1);expect(destroyed).toHaveLength(2);expect(page.workers().filter(worker=>worker.url().includes("tesseract/worker"))).toEqual([]);expect(errors).toEqual([]);
    }finally{await page.close();}
  },120000);
  it.each([undefined,180_000]as const)("observes one shrinking page budget across direction trials and real tiles for timeout %s without shortening timer callbacks",async timeout=>{
    const page=await browser.newPage();try{await page.goto(`${origin}/tests/pdf/ocr-render-cancel-harness.html`);await page.waitForFunction(()=>Boolean((window as unknown as {ocrBudgetTest:unknown}).ocrBudgetTest));const result=await page.evaluate(timeout=> (window as unknown as {ocrBudgetTest:{observe:(timeout?:90_000|180_000)=>Promise<{complete:boolean;timers:Array<{delay:number;scheduledAt:number}>;pageStarted:number}>}}).ocrBudgetTest.observe(timeout),timeout),budget=timeout??90_000,pageTimers=result.timers.filter(timer=>timer.delay>=85_000),initialization=result.timers.filter(timer=>timer.delay===30_000);
      // This fixed A4 source has two page-direction trials and two final tiles.
      // None may acquire a new full budget after the preceding work completes.
      expect(result.complete).toBe(true);expect(pageTimers).toHaveLength(4);expect(initialization).toHaveLength(1);expect(pageTimers[0].delay).toBeLessThan(budget);expect(pageTimers.at(-1)!.delay).toBeLessThan(pageTimers[0].delay-100);
      for(let index=0;index<pageTimers.length;index++){const timer=pageTimers[index];if(index)expect(timer.delay).toBeLessThan(pageTimers[index-1].delay);expect(Math.abs(timer.scheduledAt+timer.delay-result.pageStarted-budget)).toBeLessThan(20);expect(Math.abs(pageTimers[0].scheduledAt+pageTimers[0].delay-timer.scheduledAt-timer.delay)).toBeLessThan(5);}
    }finally{await page.close();}
  },60000);
  it("rejects invalid budget values before starting a page or native OCR worker",async()=>{
    const page=await browser.newPage(),started:string[]=[];page.on("worker",worker=>{if(worker.url().includes("tesseract/worker"))started.push(worker.url());});try{await page.goto(`${origin}/tests/pdf/ocr-render-cancel-harness.html`);await page.waitForFunction(()=>Boolean((window as unknown as {ocrBudgetTest:unknown}).ocrBudgetTest));const result=await page.evaluate(()=> (window as unknown as {ocrBudgetTest:{invalid:()=>Promise<{codes:string[];progress:string[]}>}}).ocrBudgetTest.invalid());expect(result.codes).toEqual(["INVALID_OCR_TIMEOUT","INVALID_OCR_TIMEOUT"]);expect(result.progress).toEqual([]);expect(started).toEqual([]);}finally{await page.close();}
  },30000);
  it("marks a logically elapsed page unresolved, terminates its native owner and permits an explicit180second retry of the same original",async()=>{
    const page=await browser.newPage(),started:string[]=[],closed:string[]=[];let active=0,maxActive=0;page.on("worker",worker=>{if(worker.url().includes("tesseract/worker")){started.push(worker.url());active++;maxActive=Math.max(maxActive,active);worker.on("close",()=>{active--;closed.push(worker.url());});}});try{await page.goto(`${origin}/tests/pdf/ocr-render-cancel-harness.html`);await page.waitForFunction(()=>Boolean((window as unknown as {ocrBudgetTest:unknown}).ocrBudgetTest));const result=await page.evaluate(()=> (window as unknown as {ocrBudgetTest:{deadline:()=>Promise<{advanced:boolean;unresolved:boolean;codes:string[];extraction:string;retryComplete:boolean;retryIssues:unknown[];originalHashUnchanged:boolean;originalBytesUnchanged:boolean}>}}).ocrBudgetTest.deadline());expect(result).toMatchObject({advanced:true,unresolved:true,extraction:"unusable",retryComplete:true,originalHashUnchanged:true,originalBytesUnchanged:true});expect(result.codes).toContain("OCR_TIMEOUT");expect(result.retryIssues).toEqual([]);expect(started).toHaveLength(2);expect(closed).toHaveLength(2);expect(maxActive).toBe(1);expect(page.workers().filter(worker=>worker.url().includes("tesseract/worker"))).toEqual([]);}finally{await page.close();}
  },60000);
});
