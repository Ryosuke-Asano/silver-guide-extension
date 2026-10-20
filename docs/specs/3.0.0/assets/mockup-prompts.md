# Silver Guide 3.0.0 — 画面モック生成記録

更新メモ：`form-sidepanel.png` は初期案の履歴。最新のフォーム案は元欄へのフォーカス時補助で、[改訂プロンプト](form-focus-hint-prompt.md) と `form-focus-hint.png` を参照する。以下は当初の三画面を生成した記録として保持する。

- 作成日: 2026-10-20
- 手段: built-in `image_gen__imagegen`
- 用途: 画面構成と操作を検討するための画像モック。実装画面やブラウザ実機での動作検証結果ではない。
- 目視確認: 3枚の日本語見出し・入力例・最小操作構成を確認。解説は読むだけ、フォームは「戻る／次へ」、PDFは原本と1問ずつの入力を並べる。
- 対象画像: `explanation-sidepanel.png`、`form-sidepanel.png`、`pdf-entry.png`
- 注意: 画像上のブラウザ枠は概念表現。実ブラウザのサイドパネル幅・UIは実装時に確認する。

## explanation-sidepanel.png — final prompt

```text
Use case: ui-mockup
Asset type: high fidelity UI concept for Silver Guide 3.0.0 browser extension.
Primary request: Produce ONE complete, polished front-on desktop browser window showing how a Japanese accessibility helper explains a selected term in the browser's native RIGHT SIDE PANEL. Full-width landscape 16:10 composition at approximately 1600 pixels, flat crisp interface, sophisticated airy white and pale mint, exceptionally legible typography, not a photograph, not a collage.
Color palette: white #FFFFFF, primary teal #087F8C, deep navy text #16324F, pale mint #EDF7F5, thin borders #D7E3E7. Japanese Noto Sans JP-like typography, large 18–20px equivalent body text, 48px touch target where applicable.
Browser chrome: understated tab strip, back arrow, URL bar with example.invalid/lesson, and a small book-shaped extension icon at right. A small external caption below the entire browser reads exactly 「Silver Guide 3.0.0 / 画面案」.
Composition: LEFT 70% is a fictional, sparse Japanese original website. RIGHT 30% (approximately 430px) is a native browser side panel touching the browser edge, separated only by a thin left vertical border. It must look like the browser's attached side panel, never a floating card, modal or independent window. The entire page and the panel are simultaneously visible.
LEFT original website: small top wordmark 「体験講座」, clear h1 「参加申込について」. Under it exactly 「お申し込みには、氏名とフリガナをご記入ください。」, wrap in a few short lines. The word 「フリガナ」 in that sentence is selected with a pale mint highlight and thin teal underline. Beneath it a few widely spaced short lines such as 「開催日：11月10日」「会場：市民センター」. No buttons needed on the original page. Plenty of white breathing room.
RIGHT panel: attached header with tiny outline book icon then 「Silver Guide」, one small close X at the far top right in the browser frame. Inside padded content show a small quiet eyebrow 「ことばの解説」, then large navy heading 「フリガナ」. A pale mint inset short quote is exactly 「氏名とフリガナをご記入ください。」. Below in large legible dark text, exactly 「名前の読み方を、カタカナで書く欄です。」. After generous spacing, small label 「記入例」 and the example 「山田 花子 → ヤマダ ハナコ」. Lower down, subtle muted text 「別の言葉を選ぶと、ここに説明が表示されます。」. Keep the panel open with whitespace below; avoid long paragraph clutter.
Constraints: exact Japanese labels, visually calm, remarkably simple. Explanation is read-only: NO teal primary action button, NO search input, NO function tabs, NO menu, NO history, NO reader, NO speech button, NO save button, NO settings, NO locks, NO popup, NO floating button, no arrows or annotations over the interface, no 3D effects, no laptop/monitor frame, no English marketing. The screenshot is a proposed mockup, never claim it is an actual working screenshot.
```

## form-sidepanel.png — final prompt

```text
Use case: ui-mockup
Asset type: high fidelity UI concept for Silver Guide 3.0.0 browser extension.
Primary request: Produce ONE complete, polished front-on desktop browser window showing Japanese web-form guided input inside the browser's native RIGHT SIDE PANEL. Landscape 16:10 composition, approximately 1600px wide, flat crisp modern UI, airy generous white space, legible large Noto Sans JP-like Japanese typography. No photograph, 3D or collage.
Color palette: white #FFFFFF, primary teal #087F8C, deep navy text #16324F, pale mint #EDF7F5, thin border #D7E3E7. Body type equivalent 18–20px, action targets at least 48px high. Use minimal book outline icon with navy Silver Guide wordmark.
Browser chrome: understated pale blue gray tab strip, browser nav arrows and URL bar example.invalid/lesson/apply, outline book extension icon on right, no contrived controls. A small centered external caption below the browser reads exactly 「Silver Guide 3.0.0 / 画面案」.
Composition: LEFT 70% is a fictional original website, RIGHT 30% (roughly 430px) is the native browser side panel, flush to browser right edge, single thin vertical left border. It is a browser panel, not a floating card or modal.
LEFT original website: small wordmark 「体験講座」, large heading 「体験講座 申込フォーム」. Below show three large, vertically spaced, simple native form labels and EMPTY inputs: 「氏名」, 「フリガナ」, 「連絡先」. The 氏名 input has an understated teal focus border linking visually to the panel. All three original site fields MUST remain empty, no filled text or placeholder names. No source-site submit button shown, plenty white space.
RIGHT panel: header with outline book icon and 「Silver Guide」, ONE close X in the far upper right browser frame. Below padded context in muted small type 「体験講座 申込フォーム」. Modest step count 「1 / 3」. Clear large navy question heading 「お名前」. Short guidance exactly 「参加する方のお名前を入力してください。」. Label 「氏名」 and large full-width outlined input, filled exactly 「山田 花子」. No explanation link (explanation is already beside the question). Rest of middle is generous white space.
Fixed bottom panel footer: quiet two-line note exactly 「次へでは、元のフォームは変更されません。」. Then two big buttons aligned horizontally, left outlined disabled 「戻る」 and right saturated teal filled 「次へ」. These are the only two task actions in the panel, no icons in the buttons. The right action is dominant; disabled Back appears very light gray. Footer separated by fine hairline. Enough padding on all sides and below buttons.
Constraints: Correct Japanese labels and clear simple task. The only entered name is in the panel; left original website inputs empty. Absolutely NO top tabs for 3 functions, no menu list, no stepper dots, no skip, no submit, no password, no lock, no profile, no save, no history, no Reader, no help link, no extra footer actions. No popup. No arrows or explanatory annotations over UI. No monitor or laptop chassis. This is a proposed screen mockup, not proof of a working UI.
```

## pdf-entry.png — final prompt

```text
Use case: ui-mockup
Asset type: high fidelity UI concept for Silver Guide 3.0.0 browser extension.
Primary request: Produce ONE complete, polished front-on desktop browser window showing an exceptionally simple Japanese PDF guided-entry workspace. Full wide landscape 16:10 composition approximately 1600px wide, flat crisp UI, large readable typography and generous white space. White and pale mint, primary teal #087F8C, dark navy #16324F, thin gray mint borders #D7E3E7. Noto Sans JP-like body text equivalent 18–20px, control targets at least 48px. This is the full-tab dedicated PDF workspace, NOT a native browser side panel.
Browser chrome: simple pale blue gray tab strip, one Silver Guide tab, nav arrows, address bar with example.invalid/pdf-workspace, tiny book extension icon. No photo, no device frame or 3D. A small external centered caption beneath entire browser says exactly 「Silver Guide 3.0.0 / 画面案」.
App header: tiny outline book icon followed by 「Silver Guide」 left. Right at header far end only quiet text 「PDFに記入」. Under header a subtle filename line 「体験講座申込書.pdf」.
Workspace composition: approximately LEFT 32% white question pane with thin right border; RIGHT 68% very light neutral preview area, with a portrait white A4 PDF page that fits fully within available height. Left pane is big enough for large type, right preview has roomy margins.
LEFT question pane: modest step indicator 「1 / 3」, big heading 「お名前」, short instruction 「参加する方のお名前を入力してください。」, label 「氏名」, one large outlined input containing exactly 「山田 花子」. Beneath input a single quiet underlined optional correction link exactly 「この項目を直す」. Middle is open whitespace. Fixed bottom area contains two big horizontally aligned buttons: very light disabled outlined 「戻る」 and dominant filled teal 「次へ」. Buttons have no icons. Beneath them a small muted note exactly 「最後の項目で『PDFを保存』に変わります。」. No additional actions.
RIGHT preview: compact unobtrusive text-only preview header 「原本のPDF」 left, 「1 / 1」 in middle, 「100%」 right, no toolbar or extra buttons. Below a clearly recognizable white A4 page with thin gray outline, not a dense document. Fictional Japanese PDF title 「体験講座 申込書」 centered. One brief line 「必要な項目をご記入ください。」. Then only three neat labeled ruled fields stacked: 「氏名」 with name 「山田 花子」 inside and a pale mint + teal focus border; 「フリガナ」 empty, 「連絡先」 empty. Plenty white paper beneath. Page text larger enough to be readable, elegant original document preview, no signatures or sensitive data.
Constraints: correct Japanese, few visible actions, coherent visual hierarchy. No native side panel on this PDF screen, no function tabs, no mode choices, no menu, no row of tool buttons, no checklists, no mandatory confirmation boxes, no reader, no speech button, no history, no password, no vault, no lock/profile/settings icons. The only primary action is 次へ, it later becomes PDFを保存. No arrows or annotations over the app. No desktop wallpaper, laptop chassis, photo or perspective. Do not claim this mockup is a working screenshot.
```

