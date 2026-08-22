import { useEffect, useState, type ReactElement } from "react";
import { Button, Radio, RadioGroup, Switch } from "react-aria-components";
import { BookIcon, LockIcon } from "../shared/icons";
import { BASIC_READING_CAPABILITIES, type PageCapabilities } from "../shared/capabilities";
import {
  DEFAULT_SETTINGS,
  type FontSize,
  type SilverGuideSettings,
  loadSettings,
  saveSettings
} from "../shared/settings";
import { getWebExtensionApi } from "../shared/webextension";
import "./popup.css";

type AssistantResult = {
  active: boolean;
  capabilities?: PageCapabilities;
  success: boolean;
  message: string;
};

type AssistantState = Pick<AssistantResult, "active" | "capabilities">;

const FONT_SIZE_OPTIONS: readonly FontSize[] = ["small", "medium", "large"];

const FONT_SIZE_LABELS: Readonly<Record<FontSize, string>> = {
  small: "小",
  medium: "中",
  large: "大"
};

const SUPPORT_OPTIONS = [
  { key: "canRead", label: "読む", description: "下線の言葉を選ぶと、やさしい説明が開きます。" },
  { key: "canInput", label: "入力する", description: "入力欄を選ぶと、確認することを表示します。" },
  { key: "canProceed", label: "進む", description: "確認済みの公式案内への道順を表示します。" }
] as const satisfies readonly {
  key: keyof Pick<PageCapabilities, "canRead" | "canInput" | "canProceed">;
  label: string;
  description: string;
}[];

async function sendRuntimeMessage<T>(message: unknown, fallback: T): Promise<T> {
  const extensionApi = getWebExtensionApi();
  return extensionApi === undefined ? fallback : ((await extensionApi.runtime.sendMessage(message)) as T);
}

export function PopupApp(): ReactElement {
  const [settings, setSettings] = useState<SilverGuideSettings>(DEFAULT_SETTINGS);
  const [isActive, setIsActive] = useState(false);
  const [capabilities, setCapabilities] = useState<PageCapabilities | undefined>();
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState("入力内容は送信しません。ページを支援するだけです。");
  const [isError, setIsError] = useState(false);
  const availableSupportOptions = SUPPORT_OPTIONS.filter(
    (option) => (capabilities ?? BASIC_READING_CAPABILITIES)[option.key]
  );

  useEffect(() => {
    void Promise.all([
      loadSettings(),
      sendRuntimeMessage<AssistantState>({ type: "silver-guide-state" }, { active: false })
    ])
      .then(([storedSettings, state]) => {
        setSettings(storedSettings);
        setIsActive(state.active);
        setCapabilities(state.capabilities);
      })
      .catch(() => setMessage("設定の読み込みができませんでした。"));
  }, []);

  async function persist(nextSettings: SilverGuideSettings): Promise<void> {
    setSettings(nextSettings);
    try {
      await saveSettings(nextSettings);
      await sendRuntimeMessage({ type: "silver-guide-update-settings", settings: nextSettings }, undefined);
    } catch {
      setIsError(true);
      setMessage("設定を保存できませんでした。");
    }
  }

  async function toggleAssistant(): Promise<void> {
    setIsLoading(true);
    setIsError(false);
    try {
      const nextActive = !isActive;
      const result = await sendRuntimeMessage<AssistantResult>(
        { type: isActive ? "silver-guide-disable" : "silver-guide-enable" },
        {
          active: nextActive,
          capabilities: nextActive ? BASIC_READING_CAPABILITIES : undefined,
          success: true,
          message: nextActive ? "このページの支援を開始しました。" : "このページの支援を停止しました。"
        }
      );
      setIsActive(result.active);
      setCapabilities(result.capabilities);
      setMessage(result.message);
      setIsError(!result.success);
    } catch {
      setIsError(true);
      setMessage("支援を切り替えられませんでした。元のページは変更していません。");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="popup-shell">
      <header className="popup-header">
        <BookIcon className="brand-icon" />
        <h1>Silver Guide</h1>
      </header>

      {!isActive ? (
        <p className="start-hint">わからない言葉や入力欄を、その場で確認しやすくします。</p>
      ) : (
        <section className="support-options" aria-labelledby="support-options-title">
          <h2 id="support-options-title">このページでできること</h2>
          {availableSupportOptions.length > 0 ? (
            <ul>
              {availableSupportOptions.map((option) => (
                <li key={option.key}>
                  <strong>{option.label}</strong>
                  <span>{option.description}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="support-options-empty">このページでは、文字の大きさと表示設定を変更できます。</p>
          )}
        </section>
      )}

      <Button className="primary-action" isDisabled={isLoading} onPress={toggleAssistant}>
        <BookIcon className="action-icon" />
        {isLoading ? "切り替えています…" : isActive ? "支援を停止する" : "このページを支援する"}
      </Button>

      <section aria-labelledby="font-size-label" className="control-section">
        <h2 id="font-size-label">文字の大きさ</h2>
        <RadioGroup
          aria-label="文字の大きさ"
          className="font-size-choice"
          value={settings.fontSize}
          onChange={(fontSize) => void persist({ ...settings, fontSize: fontSize as FontSize })}
        >
          {FONT_SIZE_OPTIONS.map((fontSize) => (
            <Radio key={fontSize} value={fontSize} className="font-size-radio">
              {FONT_SIZE_LABELS[fontSize]}
            </Radio>
          ))}
        </RadioGroup>
      </section>

      <Switch
        className="original-switch"
        isSelected={settings.showOriginal}
        onChange={(showOriginal) => void persist({ ...settings, showOriginal })}
      >
        <span>元の言葉も表示</span>
        <span aria-hidden="true" className="switch-track">
          <span className="switch-thumb" />
        </span>
      </Switch>

      <p className={`status-message ${isError ? "error" : ""}`} aria-live="polite">
        {message}
      </p>

      <p className="privacy-note">
        <LockIcon className="privacy-icon" />
        入力内容は送信しません
      </p>
    </main>
  );
}
