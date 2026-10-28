import type { PdfHandoffResult } from "../../shared/pdf-handoff";

export type SiteFormContext = { document: Document; form: HTMLFormElement; button: HTMLButtonElement | HTMLInputElement };
export interface PdfSiteSubmissionAdapter {
  id: string;
  defaultSubmit: boolean;
  matches(context: SiteFormContext): boolean;
  afterInitialSubmit(context: SiteFormContext, live: () => boolean): Promise<PdfHandoffResult>;
}
