import type { PageCapabilities } from "./capabilities";

/** Only public form metadata and bundled guide text cross extension contexts. */
export type AssistanceSnapshot = {
  revision: number;
  inputCount: number;
  visibleCount: number;
  errorCount: number;
  stepText: string;
  hasTerms: boolean;
  field?: {
    label: string;
    accessibleLabel?: string;
    groupLabel?: string;
    facts: string[];
    descriptions: string[];
    purpose: string;
    position: number;
    total: number;
    hasError: boolean;
    utility: boolean;
    canPrevious: boolean;
    canNext: boolean;
  };
  guide?: {
    id: string;
    summary: string;
    preparation: readonly string[];
    routes: readonly { label: string; officialUrl: string }[];
  };
};

export type AssistanceState = {
  active: boolean;
  tabId?: number;
  sessionId?: string;
  capabilities?: PageCapabilities;
  snapshot?: AssistanceSnapshot;
};

export type AssistanceResult = AssistanceState & { success: boolean; message: string };
export type AssistanceCommand = "first-field" | "previous-field" | "next-field" | "overview" | "first-error" | "first-term";

export type PanelTarget = {
  windowId: number;
  tabId: number;
  sessionId: string;
};
