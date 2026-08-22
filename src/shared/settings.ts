export const FONT_SIZES = ["small", "medium", "large"] as const;

export type FontSize = (typeof FONT_SIZES)[number];

export type SilverGuideSettings = {
  fontSize: FontSize;
  showOriginal: boolean;
};

export const DEFAULT_SETTINGS: SilverGuideSettings = {
  fontSize: "medium",
  showOriginal: true
};

const SETTINGS_KEY = "silverGuideSettings";

function isFontSize(value: unknown): value is FontSize {
  return typeof value === "string" && FONT_SIZES.includes(value as FontSize);
}

function normalizeSettings(value: unknown): SilverGuideSettings {
  if (value === null || typeof value !== "object") {
    return DEFAULT_SETTINGS;
  }

  const candidate = value as Partial<SilverGuideSettings>;
  return {
    fontSize: isFontSize(candidate.fontSize) ? candidate.fontSize : DEFAULT_SETTINGS.fontSize,
    showOriginal:
      typeof candidate.showOriginal === "boolean"
        ? candidate.showOriginal
        : DEFAULT_SETTINGS.showOriginal
  };
}

export async function loadSettings(): Promise<SilverGuideSettings> {
  const extensionApi = getWebExtensionApi();
  if (extensionApi === undefined) {
    return DEFAULT_SETTINGS;
  }

  const stored = await extensionApi.storage.local.get(SETTINGS_KEY);
  return normalizeSettings(stored[SETTINGS_KEY]);
}

export async function saveSettings(settings: SilverGuideSettings): Promise<void> {
  const extensionApi = getWebExtensionApi();
  if (extensionApi !== undefined) {
    await extensionApi.storage.local.set({ [SETTINGS_KEY]: settings });
  }
}
import { getWebExtensionApi } from "./webextension";
