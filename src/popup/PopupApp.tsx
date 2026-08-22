import { useEffect, useState, type ReactElement } from "react";
import { Button, Radio, RadioGroup, Switch } from "react-aria-components";
import { BookIcon, LockIcon } from "../shared/icons";
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
  success: boolean;
  message: string;
};

const FONT_SIZE_OPTIONS: readonly FontSize[] = ["small", "medium", "large"];

const FONT_SIZE_LABELS: Readonly<Record<FontSize, string>> = {
  small: "小",
  medium: "中",
  large: "大"
};

async function sendRuntimeMessage<T>(message: unknown, fallback: T): Promise<T> {
  const extensionApi = getWebExtensionApi();
  return extensionApi === undefined ? fallback : ((await extensionApi.runtime.sendMessage(message)) as T);
}

export function PopupApp(): ReactElement {
  const [settings, setSettings] = useState<SilverGuideSettings>(DEFAULT_SETTINGS);
  const [isActive, setIsActive] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState("入力内容は送信しません。ページを支援するだけです。");
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    void Promise.all([
      loadSettings(),
      sendRuntimeMessage({ type: "silver-guide-state" }, { active: false })
    ])
      .then(([storedSettings, state]) => {
        setSettings(storedSettings);
        setIsActive(Boolean((state as { active?: boolean }).active));
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
          success: true,
          message: nextActive ? "このページの支援を開始しました。" : "このページの支援を停止しました。"
        }
      );
      setIsActive(result.active);
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
