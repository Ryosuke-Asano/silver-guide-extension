import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Button, Radio, RadioGroup, Switch } from "react-aria-components";
import type { AssistanceCommand, AssistanceResult, AssistanceState, PanelTarget } from "../shared/assistant";
import { BookIcon, LockIcon } from "../shared/icons";
import { DEFAULT_SETTINGS, FONT_SIZES, loadSettings, saveSettings, type FontSize, type SilverGuideSettings } from "../shared/settings";
import { getWebExtensionApi } from "../shared/webextension";
import "./sidepanel.css";

const FONT_LABELS: Readonly<Record<FontSize, string>> = { small: "小", medium: "中", large: "大" };
const IDLE_MESSAGE = "支援を始めると、このタブの案内を表示します。";

function isState(value: unknown): value is AssistanceState {
  return value !== null && typeof value === "object" && "active" in value && typeof value.active === "boolean";
}

function isResult(value: unknown): value is AssistanceResult {
  return isState(value) && "success" in value && typeof value.success === "boolean" &&
    "message" in value && typeof value.message === "string";
}

function isOfficialLink(url: string): boolean {
  try { return new URL(url).protocol === "https:"; } catch { return false; }
}

export function SidePanelApp(): ReactElement {
  const api = useMemo(getWebExtensionApi, []);
  const [assistance, setAssistance] = useState<AssistanceState>({ active: false });
  const [settings, setSettings] = useState<SilverGuideSettings>(DEFAULT_SETTINGS);
  const [settingsReady, setSettingsReady] = useState(false);
  const [resolving, setResolving] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("表示中のタブを確認しています。");
  const [isError, setIsError] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const fieldHeadingRef = useRef<HTMLHeadingElement>(null);
  const lastField = useRef("");
  const focusedAction = useRef<string | undefined>(undefined);
  const stateRef = useRef<AssistanceState>({ active: false });
  const windowIdRef = useRef<number | undefined>(undefined);
  const tabIdRef = useRef<number | undefined>(undefined);
  const mounted = useRef(false);
  const loading = useRef(false);
  const targetGeneration = useRef(0);
  const readGeneration = useRef(0);
  const operationGeneration = useRef(0);
  const busyOperation = useRef<number | undefined>(undefined);
  const settingsGeneration = useRef(0);
  const settingsQueue = useRef<Promise<void>>(Promise.resolve());

  const applyState = useCallback((next: AssistanceState): void => {
    if (next.tabId !== tabIdRef.current) return;
    const previous = stateRef.current;
    if (next.active && previous.active && next.sessionId === previous.sessionId &&
      next.snapshot !== undefined && previous.snapshot !== undefined &&
      next.snapshot.revision < previous.snapshot.revision) return;
    stateRef.current = next;
    setAssistance(next);
  }, []);

  const clearTarget = useCallback((tabId?: number, pageLoading = false): void => {
    targetGeneration.current += 1;
    readGeneration.current += 1;
    tabIdRef.current = tabId;
    loading.current = pageLoading;
    const empty = { active: false, tabId };
    stateRef.current = empty;
    setAssistance(empty);
    busyOperation.current = undefined;
    setBusy(false);
    setResolving(true);
    setIsError(false);
    setMessage(pageLoading ? "ページを読み込んでいます。" : "表示中のタブを確認しています。");
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    const windowId = windowIdRef.current;
    if (api === undefined || windowId === undefined || !mounted.current) return;
    const generation = ++readGeneration.current;
    const target = targetGeneration.current;
    try {
      const [tab] = await api.tabs.query({ active: true, windowId });
      if (!mounted.current || generation !== readGeneration.current || target !== targetGeneration.current) return;
      if (tab?.id === undefined) {
        clearTarget();
        setResolving(false);
        setMessage("支援するタブが見つかりません。Webページを開いてください。");
        return;
      }
      if (tabIdRef.current !== tab.id) {
        clearTarget(tab.id, tab.status === "loading");
        void refresh();
        return;
      }
      loading.current = tab.status === "loading";
      const response: unknown = await api.runtime.sendMessage({ type: "silver-guide-state", windowId });
      if (!mounted.current || generation !== readGeneration.current || target !== targetGeneration.current) return;
      if (!isState(response) || response.tabId !== tab.id) {
        throw new Error("Current tab state unavailable");
      }
      // Navigation clears the previous document immediately. Wait for complete
      // before restoring any active snapshot, even if an old read was delayed.
      if (loading.current) return;
      applyState(response);
      setResolving(false);
      setMessage((current) => current === "表示中のタブを確認しています。" || current === "ページを読み込んでいます。"
        ? response.active ? "このページを支援しています。" : IDLE_MESSAGE
        : current);
    } catch {
      if (!mounted.current || generation !== readGeneration.current || target !== targetGeneration.current) return;
      // An unavailable authoritative read cannot certify this document's
      // previous snapshot. Also invalidate pending replies that could restore it.
      clearTarget(tabIdRef.current);
      setResolving(false);
      setIsError(true);
      setMessage("このタブの状態を確認できませんでした。「案内を更新する」で再確認できます。");
    }
  }, [api, applyState, clearTarget]);

  useEffect(() => {
    mounted.current = true;
    void loadSettings().then((stored) => {
      if (mounted.current) { setSettings(stored); setSettingsReady(true); }
    }).catch(() => {
      if (mounted.current) {
        setSettingsReady(true);
        setIsError(true);
        setMessage("表示設定を読み込めませんでした。設定を選び直せます。");
      }
    });
    if (api === undefined) {
      setResolving(false);
      setIsError(true);
      setMessage("拡張機能のサイドパネルから開いてください。");
      return () => { mounted.current = false; };
    }
    const onActivated = (info: { tabId: number; windowId: number }): void => {
      if (info.windowId !== windowIdRef.current) return;
      clearTarget(info.tabId);
      void refresh();
    };
    const onUpdated = (tabId: number, change: { status?: string }, tab: browser.tabs.Tab): void => {
      if (tabId !== tabIdRef.current || tab.windowId !== windowIdRef.current ||
        (change.status !== "loading" && change.status !== "complete")) return;
      clearTarget(tabId, change.status === "loading");
      void refresh();
    };
    const onRemoved = (tabId: number, info: { windowId: number }): void => {
      if (tabId !== tabIdRef.current || info.windowId !== windowIdRef.current) return;
      clearTarget();
      void refresh();
    };
    const onMessage = (value: unknown): undefined => {
      if (value !== null && typeof value === "object" && "type" in value && value.type === "silver-guide-panel-update" &&
        "windowId" in value && value.windowId === windowIdRef.current &&
        "tabId" in value && value.tabId === tabIdRef.current) void refresh();
      return undefined;
    };
    api.tabs.onActivated.addListener(onActivated);
    api.tabs.onUpdated.addListener(onUpdated);
    api.tabs.onRemoved.addListener(onRemoved);
    api.runtime.onMessage.addListener(onMessage);
    void api.windows.getCurrent().then((window) => {
      if (!mounted.current) return;
      if (window.id === undefined) throw new Error("Panel window unavailable");
      windowIdRef.current = window.id;
      void refresh();
    }).catch(() => {
      if (mounted.current) {
        setResolving(false);
        setIsError(true);
        setMessage("このウィンドウを確認できませんでした。サイドパネルを開き直してください。");
      }
    });
    return () => {
      mounted.current = false;
      targetGeneration.current += 1;
      readGeneration.current += 1;
      api.tabs.onActivated.removeListener(onActivated);
      api.tabs.onUpdated.removeListener(onUpdated);
      api.tabs.onRemoved.removeListener(onRemoved);
      api.runtime.onMessage.removeListener(onMessage);
    };
  }, [api, clearTarget, refresh]);

  useLayoutEffect(() => {
    if (!document.hasFocus() || document.activeElement !== document.body || focusedAction.current === undefined) return;
    const replacement = mainRef.current?.querySelector<HTMLElement>(`[data-panel-action="${CSS.escape(focusedAction.current)}"]`);
    const target = replacement?.matches(":disabled") ? undefined : replacement;
    (target ?? mainRef.current?.querySelector<HTMLElement>("#panel-page-heading"))?.focus({ preventScroll: true });
  }, [assistance, resolving, busy]);

  useLayoutEffect(() => {
    const field = assistance.snapshot?.field;
    const identity = field === undefined ? "" : `${assistance.sessionId}:${field.position}:${field.total}:${field.label}`;
    const changed = identity !== lastField.current;
    lastField.current = identity;
    // The user selected a page field. Reveal its heading in this document only;
    // leave panel controls, settings focus and the page's scroll untouched.
    if (changed && field !== undefined && !document.hasFocus()) {
      fieldHeadingRef.current?.scrollIntoView({ block: "nearest", behavior: "instant" });
    }
  }, [assistance]);

  function panelTarget(): PanelTarget | undefined {
    const current = stateRef.current;
    const windowId = windowIdRef.current;
    const tabId = tabIdRef.current;
    return current.active && current.sessionId !== undefined && windowId !== undefined && tabId !== undefined
      ? { windowId, tabId, sessionId: current.sessionId } : undefined;
  }

  async function operate(command?: AssistanceCommand): Promise<void> {
    if (api === undefined || resolving || busyOperation.current !== undefined) return;
    const windowId = windowIdRef.current;
    const tabId = tabIdRef.current;
    if (windowId === undefined || tabId === undefined) return;
    const current = stateRef.current;
    const target = panelTarget();
    if ((current.active || command !== undefined) && target === undefined) return;
    if (command !== undefined && current.snapshot === undefined) return;
    const generation = targetGeneration.current;
    const operation = ++operationGeneration.current;
    busyOperation.current = operation;
    setBusy(true);
    setIsError(false);
    try {
      if (!current.active) await settingsQueue.current;
      if (!mounted.current || generation !== targetGeneration.current || tabId !== tabIdRef.current) return;
      const request = command !== undefined
        ? { type: "silver-guide-command", ...target, command, revision: current.snapshot?.revision }
        : current.active
          ? { type: "silver-guide-disable", ...target }
          : { type: "silver-guide-enable", windowId, tabId };
      const result: unknown = await api.runtime.sendMessage(request);
      if (!mounted.current || generation !== targetGeneration.current || tabId !== tabIdRef.current) return;
      if (!isResult(result) || result.tabId !== tabId) throw new Error("Operation result unavailable");
      const latest = stateRef.current;
      if (latest.active && latest.sessionId !== current.sessionId && latest.sessionId !== result.sessionId) {
        void refresh();
        return;
      }
      applyState(result);
      setMessage(result.message);
      setIsError(!result.success);
      // A wake-up and an operation reply can arrive in either order.
      // Finish with a fresh authoritative read, rather than trusting arrival order.
      void refresh();
    } catch {
      if (mounted.current && generation === targetGeneration.current) {
        setIsError(true);
        setMessage("操作を確認できませんでした。「案内を更新する」で再確認してください。");
        void refresh();
      }
    } finally {
      if (busyOperation.current === operation) { busyOperation.current = undefined; setBusy(false); }
    }
  }

  function persist(next: SilverGuideSettings): void {
    setSettings(next);
    const change = ++settingsGeneration.current;
    const generation = targetGeneration.current;
    const target = panelTarget();
    settingsQueue.current = settingsQueue.current.catch(() => undefined).then(async () => {
      await saveSettings(next);
      if (api !== undefined && target !== undefined && generation === targetGeneration.current) {
        const result: unknown = await api.runtime.sendMessage({ type: "silver-guide-update-settings", ...target, settings: next });
        if (isResult(result) && !result.success) throw new Error("Settings update rejected");
      }
      if (mounted.current && change === settingsGeneration.current && generation === targetGeneration.current) {
        setIsError(false);
        setMessage("表示設定を保存しました。");
      }
    }).catch(() => {
      if (mounted.current && change === settingsGeneration.current && generation === targetGeneration.current) {
        setIsError(true);
        setMessage("表示設定を反映できませんでした。もう一度選んでください。");
      }
    });
  }

  const snapshot = assistance.snapshot;
  const field = snapshot?.field;
  const canCommand = assistance.active && snapshot !== undefined && assistance.sessionId !== undefined && !resolving && !busy;
  const routes = snapshot?.guide?.routes.filter((route) => isOfficialLink(route.officialUrl)) ?? [];

  return (
    <main className="sidepanel-shell" data-font-size={settings.fontSize} ref={mainRef}
      onFocusCapture={(event) => {
        const element = event.target as HTMLElement;
        focusedAction.current = element.closest<HTMLElement>("[data-panel-action]")?.getAttribute("data-panel-action") ?? undefined;
      }}>
      <header className="panel-header"><BookIcon className="panel-brand-icon" /><h1>Silver Guide</h1></header>
      <p className="panel-introduction">元のページを見ながら、言葉や入力項目を確認できます。</p>
      <Button className="panel-button panel-primary" data-panel-action="toggle" isDisabled={api === undefined || resolving || busy || !settingsReady || assistance.tabId === undefined} onPress={() => void operate()}>
        {busy ? "操作を確認しています…" : assistance.active ? "支援を停止する" : "このページを支援する"}
      </Button>
      <p role="status" aria-live="polite" aria-atomic="true" className={`panel-status${isError ? " is-error" : ""}`}>{message}</p>
      <Button className="panel-button panel-refresh" data-panel-action="refresh" isDisabled={api === undefined || busy} onPress={() => { clearTarget(tabIdRef.current); void refresh(); }}>案内を更新する</Button>

      <section className="panel-content" aria-labelledby="panel-page-heading" aria-busy={resolving}>
        <h2 id="panel-page-heading" tabIndex={-1}>このページの案内</h2>
        {!assistance.active ? <>
          <p>このページを支援するには、上の開始ボタンを選んでください。</p>
          <p className="panel-note">Chromeの設定ページなど、ブラウザーが保護するページでは開始できません。通常のWebページを開いてください。</p>
        </> : snapshot === undefined ? <p>ページの項目を確認しています。</p> : <>
          {snapshot.stepText && <p className="panel-step">ページが示す現在の手順：{snapshot.stepText}</p>}
          <div className="panel-overview">
            {snapshot.inputCount > 0 ? <p>この画面の入力項目：{snapshot.inputCount} 項目。入力済みかどうかは判定しません。</p>
              : <p>{snapshot.visibleCount > 0 ? "この画面には本文の入力欄がありません。検索などページ共通の入力欄は、欄を選ぶと案内します。" : "この画面には支援できる入力欄がありません。"}</p>}
            <Button className="panel-button" data-panel-action="first-field" isDisabled={!canCommand || snapshot.inputCount === 0} onPress={() => void operate("first-field")}>最初の入力項目へ</Button>
            {snapshot.errorCount > 0 && <>
              <p className="panel-error">確認が必要な項目：{snapshot.errorCount} 件。ページで入力エラーが示されています。</p>
              <Button className="panel-button" data-panel-action="first-error" isDisabled={!canCommand} onPress={() => void operate("first-error")}>最初のエラー項目へ</Button>
            </>}
          </div>
          {field !== undefined && <section className="panel-field" aria-labelledby="panel-field-heading">
            {field.utility && <p className="panel-position">ページ共通の入力欄（検索など）</p>}
            <p className="panel-position">現在の項目：{field.position} / {field.total}</p>
            {field.groupLabel && field.groupLabel !== field.label && <p>項目のまとまり：{field.groupLabel}</p>}
            <h3 id="panel-field-heading" ref={fieldHeadingRef}>「{field.label}」について</h3>
            {field.hasError && <p className="panel-error">ページから入力エラーが通知されています。元のページのエラー説明を確認して、ご自身で修正してください。</p>}
            {field.purpose && <p>{field.purpose}</p>}
            {field.facts.length > 0 && <ul className="panel-facts">{field.facts.map((fact, index) => <li key={`${index}:${fact}`}>{fact}</li>)}</ul>}
            {(field.accessibleLabel !== undefined || field.descriptions.length > 0) && <section aria-label="ページの説明・入力例">
              <h4>ページの説明・入力例</h4>
              {field.accessibleLabel !== undefined && <p>ページが設定した読み上げ名：{field.accessibleLabel}</p>}
              {field.descriptions.map((description, index) => <p key={`${index}:${description}`}>{description}</p>)}
            </section>}
            <div className="panel-navigation">
              <Button className="panel-button" data-panel-action="previous-field" isDisabled={!canCommand || !field.canPrevious} onPress={() => void operate("previous-field")}>前の項目へ</Button>
              <Button className="panel-button" data-panel-action="next-field" isDisabled={!canCommand || !field.canNext} onPress={() => void operate("next-field")}>次の項目へ</Button>
              {!field.canNext && <p className="panel-note">{field.utility ? "このフォームの入力欄はここまでです。検索などの操作は、ページのボタンをご自身で確認してください。" : "この画面の入力項目はここまでです。次の画面への移動や送信は、ページのボタンをご自身で確認してください。"}</p>}
              <Button className="panel-button" data-panel-action="overview" isDisabled={!canCommand} onPress={() => void operate("overview")}>項目の案内に戻る</Button>
            </div>
          </section>}
          {snapshot.guide !== undefined && <section className="panel-guide" aria-labelledby="panel-guide-heading">
            <h3 id="panel-guide-heading">確認済みの公式案内</h3><p>{snapshot.guide.summary}</p>
            {snapshot.guide.preparation.length > 0 && <><h4>申請前に確認すること</h4><ul>{snapshot.guide.preparation.map((item, index) => <li key={`${index}:${item}`}>{item}</li>)}</ul></>}
            {routes.length > 0 && <><h4>公式リンク</h4><ul className="panel-routes">{routes.map((route) => <li key={route.officialUrl}><a href={route.officialUrl} target="_blank" rel="noopener noreferrer">{route.label}<span className="panel-link-note">新しいタブで開きます</span></a></li>)}</ul></>}
          </section>}
          {snapshot.hasTerms && <section className="panel-terms" aria-labelledby="panel-terms-heading"><h3 id="panel-terms-heading">言葉の説明</h3><p>ページの下線付きの言葉を選ぶと、やさしい説明が開きます。</p><Button className="panel-button" data-panel-action="first-term" isDisabled={!canCommand} onPress={() => void operate("first-term")}>最初の説明を読む</Button></section>}
        </>}
      </section>

      <section className="panel-settings" aria-labelledby="panel-settings-heading">
        <h2 id="panel-settings-heading">表示の設定</h2>
        <RadioGroup aria-label="文字の大きさ" className="panel-font-choice" value={settings.fontSize} isDisabled={!settingsReady}
          onChange={(fontSize) => { if (FONT_SIZES.includes(fontSize as FontSize)) persist({ ...settings, fontSize: fontSize as FontSize }); }}>
          <h3>文字の大きさ</h3><div className="panel-font-options">{FONT_SIZES.map((fontSize) => <Radio key={fontSize} value={fontSize} className="panel-font-radio">{FONT_LABELS[fontSize]}</Radio>)}</div>
        </RadioGroup>
        <Switch className="panel-original-switch" isSelected={settings.showOriginal} isDisabled={!settingsReady} onChange={(showOriginal) => persist({ ...settings, showOriginal })}>
          <span>元の言葉も表示</span><span aria-hidden="true" className="panel-switch-track"><span className="panel-switch-thumb" /></span>
        </Switch>
      </section>
      <p className="panel-privacy"><LockIcon className="panel-privacy-icon" />入力内容は送信しません</p>
      <p className="panel-note">入力・選択・画面の移動・送信は、元のページでご自身で確認して進めてください。</p>
    </main>
  );
}
