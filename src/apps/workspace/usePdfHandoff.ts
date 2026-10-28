import { useCallback, useEffect, useRef, useState } from "react";
import { getWebExtensionApi } from "../../shared/webextension";
import { base64ToPdfBytes, bytesToBase64, isPdfPageUrl, isHandoffId, PDF_HANDOFF_REQUEST, PDF_HANDOFF_STATUSES, readPdfResponse, type PdfHandoffDestination, type PdfHandoffResult, type PdfHandoffTimings } from "../../shared/pdf-handoff";
import type { usePdfWorkspace } from "./usePdfWorkspace";

type Parameters = { requestId: string; sourceTab: number; documentToken: string };
type Phase = "none" | "loading" | "choose" | "opening" | "filling" | "sending" | PdfHandoffResult["status"] | "error";
function handoffParameters(): Parameters | null {
  const values = new URLSearchParams(location.hash.slice(1)), requestId = values.get("handoff"), sourceTab = Number(values.get("sourceTab")), documentToken = values.get("document");
  return isHandoffId(requestId) && values.has("sourceTab") && Number.isSafeInteger(sourceTab) && sourceTab >= 0 && documentToken && /^[a-f0-9-]{8,100}$/iu.test(documentToken) ? { requestId, sourceTab, documentToken } : null;
}

export function usePdfHandoff(pdf: ReturnType<typeof usePdfWorkspace>) {
  const [parameters] = useState(handoffParameters);
  const [clientId] = useState(() => crypto.randomUUID());
  const [phase, setPhase] = useState<Phase>(parameters ? "loading" : "none");
  const [destination, setDestination] = useState<PdfHandoffDestination | null>(null);
  const [destinations, setDestinations] = useState<PdfHandoffDestination[]>([]);
  const [submitAfterAttach, setSubmitAfterAttach] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const input = useRef<Uint8Array | null>(null), mounted = useRef(true), submitting = useRef(false), opening = useRef(false);
  const fileName = useRef("申込書.pdf");
  const timings = useRef<PdfHandoffTimings>({ sourceMs: 0, prepareMs: 0, outputMs: 0 });
  const [delivered, setDelivered] = useState<{ taskId: string; revision: number } | null>(null);
  const request = useCallback(async (action: string, body: Record<string, unknown> = {}) => {
    const api = getWebExtensionApi();
    if (!api || !parameters) throw new Error("提出先との接続を確認できません。元のフォームでPDFを選び直してください。");
    const reply = await api.tabs.sendMessage(parameters.sourceTab, { type: PDF_HANDOFF_REQUEST, ...parameters, clientId, action, ...body }, { frameId: 0 });
    if (!reply?.ok) throw new Error(reply?.message ?? "提出先との接続を確認できません。入力内容はこのタブに残っています。");
    return reply;
  }, [parameters, clientId]);
  const openDestination = useCallback(async (selected: PdfHandoffDestination | null) => {
    if (!input.current || opening.current) return;
    opening.current = true;
    setPhase("opening"); setMessage(null);
    try {
      if (selected) await request("accept", { destinationId: selected.id });
      if (!mounted.current || !input.current) return;
      const started = performance.now();
      let opened;
      try { opened = await pdf.open(input.current, fileName.current); }
      finally { timings.current.prepareMs += Math.round(performance.now() - started); }
      if (!mounted.current) return;
      if (!opened) {
        if (pdf.taskRef.current) { input.current.fill(0); input.current = null; setPhase("filling"); }
        else setPhase("choose");
        return;
      }
      input.current.fill(0); input.current = null; setPhase("filling");
    } catch (error) { if (mounted.current) { setPhase("choose"); setMessage(error instanceof Error ? error.message : "提出先を選べませんでした。"); } }
    finally { opening.current = false; }
  }, [pdf.open, pdf.taskRef, request]);
  useEffect(() => {
    mounted.current = true; let cancelled = false;
    const sourceStarted = performance.now();
    if (parameters) void request("get").then(async reply => {
      if (cancelled) return;
      if (typeof reply.fileName !== "string" || !Array.isArray(reply.destinations) || reply.destinations.some((target: PdfHandoffDestination) => !isHandoffId(target.id) || !isPdfPageUrl(target.url))) throw new Error("添付先を確認できませんでした。");
      fileName.current = reply.fileName;
      if (typeof reply.pdf === "string") input.current = base64ToPdfBytes(reply.pdf);
      else {
        if (!isPdfPageUrl(reply.sourceUrl)) throw new Error("PDFの取得元を確認できませんでした。");
        const url = new URL(reply.sourceUrl), api = getWebExtensionApi();
        if (!await api?.permissions.contains({ origins: [`${url.protocol}//${url.hostname}/*`] })) throw new Error("PDF配布元へのアクセス権限がありません。ブラウザーの拡張設定でサイトへのアクセスを許可してください。");
        const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 20_000);
        try { input.current = await readPdfResponse(await fetch(url.href, { credentials: url.origin === reply.sourceOrigin ? "include" : "omit", redirect: "error", signal: controller.signal })); }
        finally { clearTimeout(timeout); }
        if (cancelled) { input.current?.fill(0); input.current = null; return; }
      }
      const selected = reply.destinations.find((target: PdfHandoffDestination) => target.id === reply.destination?.id) ?? null;
      timings.current.sourceMs = Math.round(performance.now() - sourceStarted);
      setDestinations(reply.destinations); setDestination(selected); setSubmitAfterAttach(selected?.defaultSubmit ?? false);
      if (reply.directEntry === true) await openDestination(selected);
      else setPhase("choose");
    }).catch(error => { if (!cancelled) { setPhase("error"); setMessage(error instanceof Error ? error.message : "PDFを開けませんでした。"); } });
    return () => { cancelled = true; mounted.current = false; input.current?.fill(0); input.current = null; };
  }, [parameters, request, openDestination]);
  const chooseDestination = useCallback(async () => {
    if (destination && phase === "choose") await openDestination(destination);
  }, [destination, phase, openDestination]);
  const selectDestination = useCallback((id: string) => {
    const selected = destinations.find(target => target.id === id) ?? null;
    setDestination(selected); setSubmitAfterAttach(selected?.defaultSubmit ?? false);
  }, [destinations]);
  const returnToForm = useCallback(() => {
    const api = getWebExtensionApi();
    if (api && parameters) void api.tabs.update(parameters.sourceTab, { active: true }).catch(() => {});
  }, [parameters]);
  const complete = useCallback(async () => {
    if (submitting.current || !parameters || !["filling", "error"].includes(phase)) return;
    submitting.current = true; setPhase("sending"); setMessage(null);
    let output: Awaited<ReturnType<typeof pdf.preparePdfForHandoff>> = null;
    try {
      const started = performance.now();
      try { output = await pdf.preparePdfForHandoff(); }
      finally { timings.current.outputMs += Math.round(performance.now() - started); }
      if (!mounted.current) return;
      if (!output) { setPhase("filling"); return; }
      const reply = await request("deliver", { fileName: output.fileName, pdf: bytesToBase64(output.bytes), submit: submitAfterAttach, timings: { ...timings.current } });
      if (!mounted.current) return;
      if (pdf.taskRef.current?.id !== output.taskId || pdf.taskRef.current.revision !== output.revision) throw new Error("入力内容が変わりました。もう一度入力を完了してください。");
      const result = reply.result as PdfHandoffResult;
      if (!result || !PDF_HANDOFF_STATUSES.includes(result.status)) throw new Error("添付結果を確認できませんでした。");
      setDelivered({ taskId: output.taskId, revision: output.revision }); setPhase(result.status); setMessage(result.message); returnToForm();
    } catch (error) { if (mounted.current) { setPhase("error"); setMessage(error instanceof Error ? error.message : "PDFを渡せませんでした。入力内容は残っています。"); } }
    finally { output?.bytes.fill(0); submitting.current = false; }
  }, [parameters, phase, pdf.preparePdfForHandoff, pdf.taskRef, request, returnToForm, submitAfterAttach]);
  const completionHint = submitAfterAttach ? `入力を完了すると、PDFを添付し、元のフォームの「${destination?.submitLabel ?? "提出"}」を実行します。` : "入力を完了すると、選んだ添付欄に記入済みPDFを戻します。";
  return { active: !!parameters, canDeliver: !!destination, phase, destination, destinations, message, chooseDestination, selectDestination, submitAfterAttach, setSubmitAfterAttach, completionHint, complete, returnToForm,
    busy: ["loading", "opening", "sending"].includes(phase),
    delivered: !!delivered && pdf.task?.id === delivered.taskId && pdf.task.revision === delivered.revision };
}
