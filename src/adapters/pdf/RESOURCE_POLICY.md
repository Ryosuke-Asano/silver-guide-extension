# PDF resource and execution policy

The original and generated PDF are parsed from `Uint8Array` data. `getDocument` receives no PDF URL, HTTP credentials, or document base URL. Both parsing paths use the same policy in `local-resources.ts`.

All configured worker, font, OCR and decoder URLs must exactly equal `defaultPdfAssets()` URLs, which use `runtime.getURL` in the extension. Comparing only `URL.origin` is insufficient for extension schemes. CMap, standard font and WASM filenames must match the compiled `resource-catalog.json`. A regression test requires this catalog to match the corresponding bundled entries in `assets/runtime-manifest.json` exactly. The factory rejects redirects, omits credentials, bounds streamed bytes to the recorded file size and verifies SHA-256. This policy also fixes the WASM base directory because PDF.js has fixed decoder fallback JavaScript imports that bypass `BinaryDataFactory`.

`enableXfa`, `useWorkerFetch` and `useSystemFonts` are false. XFA dictionaries are still detected by original-object inspection and remain read-only. Dynamic XFA HTML is not rendered; only an existing static PDF page can be previewed. Disabling system font substitution confines standard-font loading to the factory, but PDFs that omit CJK fonts can have limited rendering fidelity. `disableFontFace` is left at PDF.js's supported default so embedded font bytes can be rendered.

Silver Guide renders PDF pages on a canvas. It does not instantiate an annotation scripting viewer, `PDFScriptingManager`, a PDF JavaScript sandbox, or XFA DOM. JavaScript actions remain inert data and are removed from written copies by the original-object sanitizer. Numerical PDF PostScript functions used to draw shading can still be interpreted; they are separate from document JavaScript actions.

PDF.js 6.4.299 has no `isEvalSupported` or `enableScripting` `getDocument` option. Setting them would not enforce a policy. Its main/worker parsing paths have no PDF-derived `eval`/`new Function` compilation path. The legacy bundle does contain a core-js global detection `Function('return this')()` fallback, normally bypassed by `globalThis`; this is not document scripting.

Primary source references for the pinned version:

- [Document API](https://raw.githubusercontent.com/mozilla/pdf.js/v6.4.299/src/display/api.js)
- [Binary data factory](https://raw.githubusercontent.com/mozilla/pdf.js/v6.4.299/src/display/binary_data_factory.js)
- [XFA document handling](https://raw.githubusercontent.com/mozilla/pdf.js/v6.4.299/src/core/document.js)
- [System font substitution](https://raw.githubusercontent.com/mozilla/pdf.js/v6.4.299/src/core/font_substitutions.js)
- [WASM decoder and fallback imports](https://raw.githubusercontent.com/mozilla/pdf.js/v6.4.299/src/core/wasm_image.js)
- [Viewer script management](https://raw.githubusercontent.com/mozilla/pdf.js/v6.4.299/web/pdf_scripting_manager.js)
- [Numerical PDF functions](https://raw.githubusercontent.com/mozilla/pdf.js/v6.4.299/src/core/function.js)
