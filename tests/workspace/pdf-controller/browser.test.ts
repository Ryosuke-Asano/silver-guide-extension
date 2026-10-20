import {afterAll,beforeAll,describe,expect,it} from "vitest";
import {createServer,type ViteDevServer} from "vite";
import {chromium,type Browser,type Page} from "playwright";
import {existsSync} from "node:fs";
import {mkdir,readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {PDFDocument,PDFName,PDFHexString} from "pdf-lib";

// Browser plugin not available in this session; use the repository's Playwright
// browser harness to exercise real PDF workers, rendering and downloaded files.
describe("3.0 PDF controller and dedicated tab",()=>{
  let server:ViteDevServer,browser:Browser,origin:string;
  const artifacts=join(tmpdir(),"silver-guide-3-pdf-qa");
  beforeAll(async()=>{await mkdir(artifacts,{recursive:true});server=await createServer({server:{host:"127.0.0.1",port:0}});await server.listen();const address=server.httpServer!.address();if(!address||typeof address==="string")throw Error("Missing test server");origin=`http://127.0.0.1:${address.port}`;browser=await chromium.launch({headless:true,...(!existsSync(chromium.executablePath())?{channel:"msedge"}:{})});},30000);
  afterAll(async()=>{await browser?.close();await server?.close();},30000);
  async function harness(){const page=await browser.newPage();await page.goto(`${origin}/tests/workspace/pdf-controller/harness.html`);await page.waitForFunction(()=>Boolean((window as unknown as {pdfControllerTest:unknown}).pdfControllerTest));return page;}
  async function call(page:Page,method:string){return page.evaluate(method=>(window as unknown as {pdfControllerTest:Record<string,()=>Promise<Record<string,unknown>>>}).pdfControllerTest[method](),method);}
  async function previewImage(page:Page){return page.locator(".pdf-page canvas").evaluate(canvas=>(canvas as HTMLCanvasElement).toDataURL());}
  async function previewInk(page:Page,box:[number,number,number,number]){
    return page.locator(".pdf-page canvas").evaluate((node,box)=>{
      const canvas=node as HTMLCanvasElement,scaleX=canvas.width/595,scaleY=canvas.height/842;
      const pixels=canvas.getContext("2d")!.getImageData(Math.ceil(box[0]*scaleX),Math.ceil((842-box[3])*scaleY),Math.floor((box[2]-box[0])*scaleX),Math.floor((box[3]-box[1])*scaleY)).data;
      let ink=0;for(let offset=0;offset<pixels.length;offset+=4)if(pixels[offset]<120&&pixels[offset+1]<120&&pixels[offset+2]<120)ink++;
      return ink;
    },box);
  }
  it("renders native text, choice edits and clearing in every rotated widget without changing the original or using the public save action",async()=>{
    const page=await harness();try{
      const result=await call(page,"nativePreviewContract") as {originalText:{ink:number;hash:number};originalLocked:{ink:number;hash:number};originalCheck:{ink:number;hash:number};originalRadioA:{ink:number;hash:number};originalRadioB:{ink:number;hash:number};originalSelect:{ink:number;hash:number};changed:Record<string,{ink:number;hash:number}>;rotatedText:{ink:number};rotatedSize:number[];clearedFirst:{ink:number};clearedSecond:{ink:number};originalUnchanged:boolean;fieldsUnchanged:boolean;answersUnchanged:boolean;readonlyAnswerUnchanged:boolean;exportCalls:number;resultKeys:string[]};
      expect(result.originalText.ink).toBeGreaterThan(50);expect(result.changed.text.hash).not.toBe(result.originalText.hash);expect(result.changed.text.ink).toBeGreaterThan(50);expect(result.changed.locked).toEqual(result.originalLocked);
      expect(result.changed.check.ink).toBeLessThan(result.originalCheck.ink);expect(result.changed.radioA.ink).toBeLessThan(result.originalRadioA.ink);expect(result.changed.radioB.ink).toBeGreaterThan(result.originalRadioB.ink);expect(result.changed.select.hash).not.toBe(result.originalSelect.hash);
      expect(result.rotatedText.ink).toBeGreaterThan(50);expect(result.rotatedSize[0]).toBeGreaterThan(result.rotatedSize[1]);expect(result.clearedFirst.ink).toBe(0);expect(result.clearedSecond.ink).toBe(0);
      expect(result).toMatchObject({originalUnchanged:true,fieldsUnchanged:true,answersUnchanged:true,readonlyAnswerUnchanged:true,exportCalls:0,resultKeys:["height","pdfToViewport","viewportToPdf","width"]});
    }finally{await page.close();}
  },60000);
  it("previews OCR/manual fields on rotated pages while keeping rejected, read-only and inapplicable areas blank",async()=>{
    const page=await harness();try{const result=await call(page,"overlayPreviewContract") as {visible:{ink:number};excluded:number[];otherInk:number;rotatedSize:number[];stateUnchanged:boolean;originalUnchanged:boolean};expect(result.visible.ink).toBeGreaterThan(50);expect(result.excluded).toEqual([0,0,0]);expect(result.otherInk).toBeGreaterThan(50);expect(result.rotatedSize[0]).toBeGreaterThan(result.rotatedSize[1]);expect(result).toMatchObject({stateUnchanged:true,originalUnchanged:true});}finally{await page.close();}
  },60000);
  it("reuses one preview snapshot across page and zoom changes and fetches the bundled Japanese font once",async()=>{
    const page=await harness();try{const result=await call(page,"previewSnapshotCache") as {initialWorkers:number;cachedWorkers:number;changedWorkers:number;fontFetches:number;originalUnchanged:boolean};expect(result.initialWorkers).toBeGreaterThan(0);expect(result.cachedWorkers).toBe(result.initialWorkers);expect(result.changedWorkers).toBeGreaterThan(result.cachedWorkers);expect(result.fontFetches).toBe(1);expect(result.originalUnchanged).toBe(true);}finally{await page.close();}
  },60000);
  it("reports invalid retained types, length and false conditions without modifying answers, then previews a repaired value",async()=>{
    const page=await harness();try{const result=await call(page,"invalidPreviewRetainsAnswers") as {errors:Array<{code:string;issues:string[];unchanged:boolean}>;repairedInk:number;originalUnchanged:boolean};expect(result.errors.map(error=>error.code)).toEqual(["ANSWERS_INVALID","ANSWERS_INVALID","ANSWERS_INVALID"]);expect(result.errors[0].issues).toContain("GRAPHEME_LIMIT");expect(result.errors[1].issues).toContain("ANSWER_TYPE");expect(result.errors[2].issues).toContain("CONDITION_NOT_APPLICABLE");expect(result.errors.every(error=>error.unchanged)).toBe(true);expect(result.repairedInk).toBeGreaterThan(50);expect(result.originalUnchanged).toBe(true);}finally{await page.close();}
  },60000);
  it("invalidates the preview cache when a page is excluded and applies the same page-review boundary as saving",async()=>{
    const page=await harness();try{const result=await call(page,"previewPageReviewContract") as {allowedInk:number;code:string;issues:string[];repairedInk:number;stateUnchanged:boolean;originalUnchanged:boolean};expect(result.allowedInk).toBeGreaterThan(50);expect(result.code).toBe("ANSWERS_INVALID");expect(result.issues).toContain("PAGE_CLASSIFICATION_CONFLICT");expect(result.repairedInk).toBeGreaterThan(50);expect(result).toMatchObject({stateUnchanged:true,originalUnchanged:true});}finally{await page.close();}
  },60000);
  it("previews edits and explicit clearing of native original text before saving, retaining focus and earlier answers",async()=>{
    const doc=await PDFDocument.create(),sheet=doc.addPage([595,842]),form=doc.getForm();
    sheet.drawText("Synthetic live preview",{x:60,y:760,size:18});
    const name=form.createTextField("name");name.setText("ORIGINAL");name.addToPage(sheet,{x:80,y:650,width:300,height:40,borderWidth:0});
    const address=form.createTextField("address");address.addToPage(sheet,{x:80,y:550,width:300,height:40,borderWidth:0});
    const page=await browser.newPage(),errors:string[]=[],downloads:unknown[]=[];page.on("pageerror",error=>errors.push(error.message));page.on("download",download=>downloads.push(download));
    try{
      await page.goto(`${origin}/workspace.html`);await page.getByLabel("開くPDFファイル").setInputFiles({name:"preview-original.pdf",mimeType:"application/pdf",buffer:Buffer.from(await doc.save())});
      const answer=page.locator("[data-pdf-answer]");await answer.waitFor();await expect.poll(()=>page.locator(".pdf-canvas-scroll").getAttribute("aria-busy")).toBe("false");
      expect(await answer.inputValue()).toBe("ORIGINAL");expect(await previewInk(page,[84,654,376,686])).toBeGreaterThan(50);
      const original=await previewImage(page);await answer.fill("Draft answer");await expect.poll(()=>previewImage(page),{timeout:20000}).not.toBe(original);expect(await answer.evaluate(node=>document.activeElement===node)).toBe(true);
      const draft=await previewImage(page);await answer.fill("Latest answer");await expect.poll(()=>previewImage(page),{timeout:20000}).not.toBe(draft);expect(await answer.inputValue()).toBe("Latest answer");
      await answer.fill("");await expect.poll(()=>previewInk(page,[84,654,376,686]),{timeout:20000}).toBe(0);expect(await answer.evaluate(node=>document.activeElement===node)).toBe(true);
      await answer.fill("Retained first answer");await page.getByRole("button",{name:"次へ",exact:true}).click();await answer.fill("Second answer");
      await expect.poll(()=>previewInk(page,[84,554,376,586]),{timeout:20000}).toBeGreaterThan(50);expect(await previewInk(page,[84,654,376,686])).toBeGreaterThan(50);
      await page.getByRole("button",{name:"戻る",exact:true}).click();expect(await answer.inputValue()).toBe("Retained first answer");expect(await previewInk(page,[84,554,376,586])).toBeGreaterThan(50);expect(downloads).toHaveLength(0);
      await page.getByRole("button",{name:"次へ",exact:true}).click();const downloading=page.waitForEvent("download");await page.getByRole("button",{name:"PDFを保存",exact:true}).click();
      const destination=join(artifacts,"live-preview-output.pdf");await(await downloading).saveAs(destination);const actual=await PDFDocument.load(await readFile(destination));
      expect(actual.getForm().getTextField("name").getText()).toBe("Retained first answer");expect(actual.getForm().getTextField("address").getText()).toBe("Second answer");expect(errors).toEqual([]);
    }finally{await page.close();}
  },60000);
  it("retries real parsing without changing current answers or automatically adopting mappings",async()=>{const page=await harness();try{expect(await call(page,"extendedRetryPreservesWork")).toEqual({received:{pages:[0],timeout:180_000},sameFields:true,sameAnswers:true,sameRevision:true,sameOriginal:true,diffPending:true,state:"ready"});}finally{await page.close();}},30000);
  it("keeps the current document through a broken replacement or password cancellation and honors source encryption",async()=>{const page=await harness();try{expect(await call(page,"failedReplacementPreservesWork")).toEqual({failed:false,sameAfterFailure:true,cancelledOutcome:false,sameAfterCancel:true,originalRetained:true,opened:true,exportAllowed:false,sourceReadOnly:true,code:true});}finally{await page.close();}},30000);
  it("cancels before metadata exists and can retry the same bytes",async()=>{const page=await harness();try{expect(await call(page,"cancelBeforeMetadata")).toEqual({outcome:false,state:"cancelled",task:null,original:null,retry:true,title:"再試行する原本.pdf"});}finally{await page.close();}},30000);
  it("cancels a real OCR scan and retains completed page fields with unresolved pages explicit",async()=>{const page=await harness();try{const result=await call(page,"cancelDuringScan");expect(result.cancelMs).toBeLessThan(1000);expect(result.checkpointPages).toBeGreaterThanOrEqual(1);expect(result.checkpointPages).toBeLessThan(4);expect(result.checkpointFields).toBeGreaterThanOrEqual(4);expect(result.complete).toBe(false);expect(result.issues).toContain("ANALYSIS_CANCELLED_PAGE");expect(result.sameOriginal).toBe(true);expect(result.unresolved).toBeGreaterThan(0);expect(result.state).toBe("ready");}finally{await page.close();}},60000);
  it("cancels real export without losing the task or original",async()=>{const page=await harness();try{expect(await call(page,"cancelDuringExport")).toEqual({sameTask:true,sameOriginal:true,output:false,state:"ready"});}finally{await page.close();}},30000);
  it("keeps binary resources out of rendered state and invalidates output when an answer changes",async()=>{const page=await harness();try{expect(await call(page,"exportAndNavigate")).toEqual({validated:true,hasBinary:false,retained:true,invalidated:true,state:"ready"});}finally{await page.close();}},30000);
  it("rejects a stale result after an edit during Worker export",async()=>{const page=await harness();try{const result=await call(page,"editDuringExport");expect(result.output).toBe(false);expect(result.state).toBe("ready");expect(result.revision).toBe(Number(result.before)+1);expect(result.answer).toBe("編集後の架空回答");}finally{await page.close();}},30000);
  it("holds the previous PDF while a replacement opens and refuses stale export completion",async()=>{const page=await harness();try{expect(await call(page,"switchDuringExport")).toEqual({previousRetainedWhileLoading:true,title:"別の架空申請書.pdf",output:false,state:"ready"});}finally{await page.close();}},30000);
  it("detaches downloads and blob resources so late completion cannot mark edited answers as saved",async()=>{const page=await harness();try{const result=await call(page,"staleDownload");expect(result.detached).toBe(true);expect(result.revoked).toBe(1);expect(result.stage).toBe("reviewing");expect(result.state).toBe("ready");expect(result.output).toBe(false);}finally{await page.close();}},30000);
  it("keeps a native chooser and its validated PDF alive beyond five minutes, then monitors actual completion",async()=>{
    const page=await harness();try{
      expect(await call(page,"beginSaveDownload")).toMatchObject({state:"downloading",validated:true,revoked:0,searches:0,listeners:0});
      await page.clock.install();await page.clock.runFor(300_001);
      expect(await call(page,"downloadSnapshot")).toMatchObject({state:"downloading",error:null,answersRetained:true,originalRetained:true,validated:true,revoked:0,searches:0,listeners:0});
      await page.clock.resume();
      expect(await call(page,"resolveSaveDownload")).toMatchObject({state:"downloading",revoked:0,searches:1,listeners:1});
      expect(await call(page,"completeSaveDownload")).toMatchObject({state:"ready",stage:"saved",error:null,answersRetained:true,originalRetained:true,revoked:1,listeners:0});
    }finally{await page.clock.resume();await call(page,"finishSaveDownload");await page.close();}
  },30000);
  it("preserves answers after a chooser rejection and saves on the same direct-save action retry",async()=>{
    const page=await harness();try{
      await call(page,"beginSaveDownload");
      expect(await call(page,"rejectSaveDownload")).toMatchObject({state:"ready",stage:"reviewing",error:null,notice:expect.stringContaining("PDFは保存されていません"),answersRetained:true,originalRetained:true,validated:true,revoked:1,listeners:0});
      expect(await call(page,"retrySaveDownload")).toMatchObject({state:"downloading",requests:2,answersRetained:true,originalRetained:true,validated:true});
      await call(page,"resolveSaveDownload");
      expect(await call(page,"completeSaveDownload")).toMatchObject({state:"ready",stage:"saved",error:null,requests:2,revoked:2,listeners:0});
    }finally{await call(page,"finishSaveDownload");await page.close();}
  },30000);
  it("treats structured user cancellation neutrally while a real file failure remains unsaved with an error",async()=>{
    const page=await harness();try{
      await call(page,"beginSaveDownload");await call(page,"resolveSaveDownload");
      expect(await call(page,"cancelSaveDownload")).toMatchObject({state:"ready",stage:"reviewing",error:null,notice:expect.stringContaining("PDFは保存されていません"),answersRetained:true,originalRetained:true,validated:true,revoked:1,listeners:0});
      await call(page,"retrySaveDownload");await call(page,"resolveSaveDownload");
      expect(await call(page,"failSaveDownload")).toMatchObject({state:"ready",stage:"reviewing",error:expect.stringContaining("保存が中断"),answersRetained:true,originalRetained:true,validated:true,revoked:2,listeners:0});
    }finally{await call(page,"finishSaveDownload");await page.close();}
  },30000);
  it("opens the dedicated tab, corrects/cancels a field, moves back, and saves an actual Japanese PDF",async()=>{
    const page=await harness(),errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
    try{
      const bytes=await page.evaluate(()=>(window as unknown as {pdfTest:{nativeFixture:()=>Promise<number[]>}}).pdfTest.nativeFixture());
      await page.setViewportSize({width:1440,height:1000});await page.goto(`${origin}/workspace.html`);
      expect(await page.title()).toContain("PDFに記入");await page.getByRole("heading",{name:"PDFを開いて、ひとつずつ記入"}).waitFor();
      expect(await page.locator("vite-error-overlay").count()).toBe(0);
      await page.getByLabel("開くPDFファイル").setInputFiles({name:"架空の申請書.pdf",mimeType:"application/pdf",buffer:Buffer.from(bytes)});
      const answer=page.locator("[data-pdf-answer]");await answer.waitFor();await answer.fill("山田 花子");
      await page.getByRole("button",{name:"この項目を直す",exact:true}).click();await page.getByLabel("項目名",{exact:true}).fill("採用しない項目名");await page.getByRole("button",{name:"取消",exact:true}).click();expect(await answer.inputValue()).toBe("山田 花子");expect(await page.locator(".pdf-entry-form h2").textContent()).toContain("氏名");
      await expect.poll(()=>page.locator(".pdf-canvas-scroll").getAttribute("aria-busy")).toBe("false");
      await page.screenshot({path:join(artifacts,"pdf-desktop.png"),fullPage:false});
      await page.getByRole("button",{name:"次へ",exact:true}).click();await answer.fill("ヤマダ ハナコ");await page.getByRole("button",{name:"戻る",exact:true}).click();expect(await answer.inputValue()).toBe("山田 花子");await page.getByRole("button",{name:"次へ",exact:true}).click();expect(await answer.inputValue()).toBe("ヤマダ ハナコ");await page.getByRole("button",{name:"次へ",exact:true}).click();await answer.fill("東京都千代田区一番町1");await page.getByRole("button",{name:"次へ",exact:true}).click();await answer.fill("03-1234-5678");
      const downloading=page.waitForEvent("download");await page.getByRole("button",{name:"PDFを保存",exact:true}).click();const download=await downloading;const destination=join(artifacts,"japanese-output.pdf");await download.saveAs(destination);
      const actual=await PDFDocument.load(await readFile(destination));expect(actual.getPageCount()).toBe(1);expect(actual.getForm().getTextField("applicant_name").getText()).toBe("山田 花子");expect(actual.getForm().getTextField("furigana").getText()).toBe("ヤマダ ハナコ");expect(actual.getForm().getTextField("address").getText()).toBe("東京都千代田区一番町1");
      await page.setViewportSize({width:420,height:920});await page.screenshot({path:join(artifacts,"pdf-narrow.png"),fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
      expect(await page.getByText(/下書き|保管庫|詳細編集/).count()).toBe(0);expect(errors).toEqual([]);
    }finally{await page.close();}
  },60000);
  it("preserves actual dropdown and checkbox values through the simple UI save path",async()=>{
    const doc=await PDFDocument.create(),sheet=doc.addPage([595,842]),form=doc.getForm();sheet.drawText("Synthetic choices",{x:60,y:760,size:18});
    const area=form.createDropdown("area");area.addOptions(["North","South"]);area.acroField.dict.set(PDFName.of("TU"),PDFHexString.fromText("地域"));area.addToPage(sheet,{x:80,y:650,width:300,height:40});const check=form.createCheckBox("consent");check.acroField.dict.set(PDFName.of("TU"),PDFHexString.fromText("同意"));check.addToPage(sheet,{x:80,y:570,width:30,height:30});
    const page=await browser.newPage();try{await page.goto(`${origin}/workspace.html`);await page.getByLabel("開くPDFファイル").setInputFiles({name:"choices.pdf",mimeType:"application/pdf",buffer:Buffer.from(await doc.save())});await page.locator("select[data-pdf-answer]").selectOption("South");await page.getByRole("button",{name:"次へ",exact:true}).click();await page.locator("input[data-pdf-answer]").check();const downloading=page.waitForEvent("download");await page.getByRole("button",{name:"PDFを保存",exact:true}).click();const download=await downloading,destination=join(artifacts,"selection-output.pdf");await download.saveAs(destination);const actual=await PDFDocument.load(await readFile(destination));expect(actual.getForm().getDropdown("area").getSelected()).toEqual(["South"]);expect(actual.getForm().getCheckBox("consent").isChecked()).toBe(true);expect(actual.getPageCount()).toBe(1);}finally{await page.close();}
  },30000);
});
