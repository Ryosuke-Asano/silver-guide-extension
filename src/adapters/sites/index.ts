import { libraryDemoAdapter } from "./library-demo";
import type { PdfSiteSubmissionAdapter, SiteFormContext } from "./types";

const adapters: readonly PdfSiteSubmissionAdapter[] = [libraryDemoAdapter];
export const findPdfSiteAdapter = (context: SiteFormContext) => adapters.find(adapter => adapter.matches(context)) ?? null;
