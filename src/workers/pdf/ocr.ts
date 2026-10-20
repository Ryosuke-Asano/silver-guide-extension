import type { Lang, Worker as OcrWorker } from "tesseract.js";
import resourceLock from "../../../scripts/resources.lock.json";
import { PdfEngineError, rectToQuad, type PdfAffine, type PdfAssetPaths, type PdfEvidence, type PdfProgress } from "../../domain/pdf";
import { abortIfNeeded, transformQuad } from "../../adapters/pdf/geometry";

const LANGUAGE_CODES = ["jpn", "eng", "jpn_vert"] as const;
const INIT_TIMEOUT_MS = 30_000;
const ENCODED_IMAGE_LIMIT = 64 * 1024 * 1024;

/** Owns the native worker even while the pinned Tesseract initializer is pending. */
export class LocalOcr {
  private worker: OcrWorker | null = null;
  private nativeWorker: Worker | null = null;
  private initializing: Promise<OcrWorker> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private pending = new Set<(cause: unknown) => void>();
  private lifetime = new AbortController();
  private generation = 0;
  private closed = false;
  private progress: ((progress: PdfProgress) => void) | undefined;
  private pageIndex = 0;
  constructor(private readonly assets: PdfAssetPaths) {}

  private owned<T>(promise: Promise<T>, signal?: AbortSignal, terminateOnAbort = true): Promise<T> {
    if (this.closed) { void promise.catch(() => undefined); return Promise.reject(new PdfEngineError("OCR_DISPOSED", "文字認識は終了しました。")); }
    if (signal?.aborted) { void promise.catch(() => undefined); if (terminateOnAbort) void this.dispose(); return Promise.reject(new DOMException("処理を中止しました。", "AbortError")); }
    return new Promise<T>((resolve, reject) => {
      const cancel = () => { const cause = new DOMException("処理を中止しました。", "AbortError"); if (terminateOnAbort) this.stop(cause); else fail(cause); };
      const cleanup = () => { this.pending.delete(fail); signal?.removeEventListener("abort", cancel); };
      const fail = (cause: unknown) => { cleanup(); reject(cause); };
      this.pending.add(fail); signal?.addEventListener("abort", cancel, { once: true });
      promise.then(value => { cleanup(); resolve(value); }, fail);
    });
  }

  private stop(cause: unknown): void {
    this.closed = true; this.generation++; this.lifetime.abort();
    const native = this.nativeWorker; this.nativeWorker = null;
    native?.terminate(); this.worker = null; this.progress = undefined;
    for (const reject of [...this.pending]) reject(cause);
  }

  private async languages(): Promise<Lang[]> {
    const languages: Lang[] = [];
    try {
      for (const code of LANGUAGE_CODES) {
        abortIfNeeded(this.lifetime.signal);
        const filename = `${code}.traineddata.gz`, record = resourceLock.resources.find(item => item.path === `tessdata/${filename}`);
        if (!record) throw new PdfEngineError("OCR_RESOURCE_INTEGRITY", "同梱した文字認識モデルの記録がありません。");
        const url = new URL(filename, `${this.assets.ocrLanguages.replace(/\/$/, "")}/`).href;
        const response = await fetch(url, { credentials: "omit", redirect: "error", signal: this.lifetime.signal });
        if (!response.ok || response.redirected || response.url && new URL(response.url).href !== url) throw new PdfEngineError("OCR_RESOURCE_UNAVAILABLE", "同梱した文字認識モデルを読み込めません。");
        const data = new Uint8Array(record.bytes);
        if (response.body) {
          const reader = response.body.getReader(); let offset = 0;
          try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; if (offset + chunk.value.length > data.length) { await reader.cancel(); throw new PdfEngineError("OCR_RESOURCE_INTEGRITY", "文字認識モデルの大きさが同梱の記録と一致しません。"); } data.set(chunk.value, offset); offset += chunk.value.length; } if (offset !== data.length) throw new PdfEngineError("OCR_RESOURCE_INTEGRITY", "文字認識モデルを最後まで読み込めませんでした。"); }
          finally { reader.releaseLock(); }
        } else { const fetched = new Uint8Array(await response.arrayBuffer()); if (fetched.length !== data.length) throw new PdfEngineError("OCR_RESOURCE_INTEGRITY", "文字認識モデルの大きさが同梱の記録と一致しません。"); data.set(fetched); }
        const digest = await crypto.subtle.digest("SHA-256", data.buffer), hash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
        if (hash !== record.sha256) throw new PdfEngineError("OCR_RESOURCE_INTEGRITY", "文字認識モデルの検証に失敗しました。");
        languages.push({ code, data });
      }
      return languages;
    } catch (cause) { languages.forEach(language => (language.data as Uint8Array).fill(0)); throw cause; }
  }

  private async initialize(): Promise<OcrWorker> {
    const token = this.generation;
    let languages: Lang[] = [];
    const restoreMessages: Array<() => void> = [];
    const timer = setTimeout(() => this.stop(new PdfEngineError("OCR_INITIALIZE_TIMEOUT", "文字認識の準備が時間内に完了しませんでした。再試行できます。")), INIT_TIMEOUT_MS);
    try {
      const { createWorker, OEM, PSM } = await import("tesseract.js");
      languages = await this.languages();
      abortIfNeeded(this.lifetime.signal);
      const NativeWorker = globalThis.Worker, captured: Worker[] = [];
      let attempts = 0, modelsSent = false, rejectStartup!: (cause: unknown) => void;
      const startupFailure = new Promise<never>((_resolve, reject) => { rejectStartup = reject; });
      void startupFailure.catch(() => undefined);
      const fail = (cause: unknown) => { if (token !== this.generation) return; const error = cause instanceof PdfEngineError ? cause : new PdfEngineError("OCR_INITIALIZE_FAILED", "文字認識を開始できませんでした。同梱モデルと処理の状態を確認し、再試行してください。"); rejectStartup(error); this.stop(error); };
      const expected = new URL(this.assets.ocrWorker).href;
      const OwnedConstructor = new Proxy(NativeWorker, { construct(Target, args) {
        if (new URL(String(args[0]), expected).href !== expected) throw new PdfEngineError("OCR_WORKER_LOCATION", "文字認識は固定した同梱Workerだけを利用します。");
        attempts++; const native = Reflect.construct(Target, args) as Worker; captured.push(native);
        const send = native.postMessage;
        // Pinned7 initializes Lang[] using l.data as a language name. Keep
        // names for initialize, injecting bytes only into its language load.
        const intercept = ((message: unknown, ...options: unknown[]) => {
          const request = message as { action?: string; payload?: { langs?: unknown } };
          if (request?.action === "loadLanguage") {
            try {
              if (modelsSent || request.payload?.langs !== LANGUAGE_CODES.join("+")) throw new PdfEngineError("OCR_MODEL_PROTOCOL", "文字認識モデルの読み込み要求を確認できません。");
              modelsSent = true; native.postMessage = send;
              Reflect.apply(send, native, [{ ...request, payload: { ...request.payload, langs: languages } }, ...options]);
            // Pinned browser/send is async and its caller does not await it.
            // Reject our owned operation instead of producing an unhandled
            // rejection from that ignored promise.
            } catch (cause) { fail(cause); }
          } else Reflect.apply(send, native, [message, ...options]);
        }) as Worker["postMessage"];
        native.postMessage = intercept; restoreMessages.push(() => { if (native.postMessage === intercept) native.postMessage = send; });
        return native;
      } });
      let creating!: Promise<OcrWorker>;
      // Tesseract7 spawns synchronously before returning its initialization
      // promise. Capture only this synchronous call, then restore immediately.
      globalThis.Worker = OwnedConstructor;
      try { creating = createWorker(LANGUAGE_CODES.join("+"), OEM.LSTM_ONLY, { workerPath: expected, corePath: this.assets.ocrCore, langPath: this.assets.ocrLanguages, workerBlobURL: false, cacheMethod: "none", gzip: true, errorHandler: fail, logger: message => { if (token === this.generation) this.progress?.({ stage: "ocr", pageIndex: this.pageIndex, completed: message.progress, total: 1, detail: "文字を読み取っています" }); } }); }
      catch (cause) { captured.forEach(native => native.terminate()); throw cause; }
      finally { globalThis.Worker = NativeWorker; }
      if (attempts !== 1 || captured.length !== 1) {
        captured.forEach(native => native.terminate());
        void creating.then(late => late.terminate(), () => undefined);
        throw new PdfEngineError("OCR_WORKER_OWNERSHIP", "文字認識Workerの所有を確認できません。処理を開始しませんでした。");
      }
      if (this.closed || token !== this.generation) { captured.forEach(native => native.terminate()); void creating.then(late => late.terminate(), () => undefined); throw new PdfEngineError("OCR_DISPOSED", "文字認識は終了しました。"); }
      this.nativeWorker = captured[0];
      this.nativeWorker.addEventListener("error", event => { event.preventDefault(); fail(event); });
      this.nativeWorker.addEventListener("messageerror", fail);
      void creating.then(late => { if (this.closed || token !== this.generation) void late.terminate(); }, () => undefined);
      const worker = await this.owned(Promise.race([creating, startupFailure]));
      if (!modelsSent) throw new PdfEngineError("OCR_MODEL_PROTOCOL", "文字認識Workerへの同梱モデルの受け渡しを確認できません。");
      await this.owned(Promise.race([worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, preserve_interword_spaces: "1", user_defined_dpi: "300" }), startupFailure]));
      if (this.closed || token !== this.generation) { await worker.terminate(); throw new PdfEngineError("OCR_DISPOSED", "文字認識は終了しました。"); }
      this.worker = worker; return worker;
    } catch (cause) { const error = cause instanceof Error ? cause : new PdfEngineError("OCR_INITIALIZE_FAILED", "文字認識を開始できませんでした。処理をやり直してください。"); this.stop(error); throw error; }
    finally { clearTimeout(timer); restoreMessages.forEach(restore => restore()); languages.forEach(language => (language.data as Uint8Array).fill(0)); }
  }

  private getWorker(signal?: AbortSignal): Promise<OcrWorker> {
    if (this.closed) return Promise.reject(new PdfEngineError("OCR_DISPOSED", "文字認識は終了しました。"));
    if (this.worker) return Promise.resolve(this.worker);
    if (!this.initializing) this.initializing = this.initialize();
    return this.owned(this.initializing, signal);
  }

  private async imageBytes(image: HTMLCanvasElement | OffscreenCanvas, signal?: AbortSignal): Promise<Uint8Array> {
    const blob = typeof OffscreenCanvas !== "undefined" && image instanceof OffscreenCanvas
      ? await this.owned(image.convertToBlob({ type: "image/png" }), signal)
      : await this.owned(new Promise<Blob>((resolve, reject) => (image as HTMLCanvasElement).toBlob(value => value ? resolve(value) : reject(new PdfEngineError("OCR_IMAGE_ENCODING_FAILED", "文字認識用の画像を作成できません。")), "image/png")), signal);
    if (blob.size > ENCODED_IMAGE_LIMIT) throw new PdfEngineError("OCR_IMAGE_LIMIT", "文字認識用の画像が処理上限を超えています。");
    return new Uint8Array(await this.owned(blob.arrayBuffer(), signal));
  }

  recognize(image: HTMLCanvasElement | OffscreenCanvas, pageIndex: number, imageToPdf: PdfAffine, options: { signal?: AbortSignal; onProgress?: (progress: PdfProgress) => void } = {}): Promise<PdfEvidence[]> {
    const run = async () => {
      abortIfNeeded(options.signal); this.progress = options.onProgress; this.pageIndex = pageIndex;
      let bytes: Uint8Array | undefined;
      try {
        const worker = await this.getWorker(options.signal); bytes = await this.imageBytes(image, options.signal);
        // The pinned browser loader accepts Uint8Array directly; its upstream
        // ImageLike declaration omits this supported binary input.
        const result = await this.owned(worker.recognize(bytes as unknown as Parameters<OcrWorker["recognize"]>[0], { rotateAuto: false }, { text: true, blocks: true }, crypto.randomUUID()), options.signal);
        abortIfNeeded(options.signal);
        const evidence: PdfEvidence[] = [];
        for (const block of result.data.blocks ?? []) for (const paragraph of block.paragraphs ?? []) for (const line of paragraph.lines ?? []) {
          if (!line.text.trim()) continue; const b = line.bbox;
          evidence.push({ id: crypto.randomUUID(), pageIndex, text: line.text.trim(), quad: transformQuad(imageToPdf, rectToQuad([b.x0, b.y0, b.x1, b.y1])), method: "ocr", rawOcrConfidence: Number.isFinite(line.confidence) ? line.confidence : null });
        }
        return evidence;
      } catch (cause) { const error = cause instanceof Error ? cause : new PdfEngineError("OCR_RECOGNITION_FAILED", "文字認識を完了できませんでした。処理をやり直してください。"); this.stop(error); throw error; }
      finally { bytes?.fill(0); }
    };
    const job = this.queue.then(run, run); this.queue = job.catch(() => undefined);
    return this.owned(job, options.signal, false);
  }

  async dispose(): Promise<void> { this.stop(new DOMException("文字認識を中止しました。", "AbortError")); }
}
