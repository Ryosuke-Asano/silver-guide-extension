# フォーカス時の入力補助 — 修正版モック生成プロンプト

生成方法: 組み込み image_gen の画像編集。
編集元: `form-sidepanel.png`（事前に画像を表示して確認）。
出力: `form-focus-hint.png`

```text
Use case: precise-object-edit
Asset type: Japanese extension UI mockup, Silver Guide 3.0.0 form input assistance.
Input images: Image 1 is the edit target and style reference, a form-sidepanel mockup. Edit this existing image. Preserve its crisp browser chrome, white background, teal #087F8C, dark navy #16324F, clear large Noto Sans JP-style Japanese typography, book toolbar icon, fictional example.invalid/lesson/apply address, and fictional application form identity.
Primary request: Replace the sidebar-based duplicated form flow with focus-triggered contextual help attached directly to the original website field. Remove the entire right Silver Guide side panel, its vertical divider, its header, close icon, step count, separate input, explanatory footer, and Back / Next buttons. Let the original website fill the normal browser content width and use a calm centered application form. It must be visually obvious that the user types directly into the original website's inputs.

Composition: high-resolution landscape 16:10 flat front-on browser mockup, no physical device. Browser toolbar at top. Original website below, centered wide form within generous whitespace. Preserve original website masthead "体験講座" and heading "体験講座 申込フォーム". The normal website form has three original fields only, vertically laid out: "氏名", "フリガナ", "連絡先". Original 氏名 input contains "山田 花子". Original フリガナ input is the currently focused input, with teal outline and visible text cursor at the end of the existing value "ヤマダ ハナコ". Beneath this focused input put exactly one small nonmodal mint-tinted contextual hint attached near the field with enough reserved space so it never overlaps the focused input, field labels, or the following contact field. Hint should be compact, subtle, visibly much smaller than a sidebar or dialog. A tiny book icon or small "Silver Guide" identifier may appear in the hint.
Hint exact Japanese text:
"フリガナの書き方"
"名前の読み方をカタカナで入力します。"
"例：ヤマダ ハナコ"
Underneath the hint leave normal spacing then the original website "連絡先" label and its normal empty input, both fully visible. At the bottom may be exactly one original website main action button "確認画面へ". No extension-owned action buttons at all. Add outside the browser in a small quiet bottom margin caption "Silver Guide 3.0.0 / フォーカス時の入力補助", and optionally the separate caption "入力する場所は、元のフォームのまま。"

Strict constraints: No sidebar; no dock; no split screen; no modal; no dark overlay; no duplicate input controls. No Silver Guide heading floating as a large section anywhere. No extension Back / Next / Reflect to form / Explain / Close X / Settings / navigation / step count. No tabs for the three features. Keep content readable in Japanese, ample legible size. Do not make hint enormous or centered on screen. Hint stays close under the original focused field and does not obscure anything. Retain the original site brand and the toolbar book icon; a small Silver Guide identifier in the compact hint is sufficient branding. This is a concept mockup, not a claim of a working browser screenshot.
```
