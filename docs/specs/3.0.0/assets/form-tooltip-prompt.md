# 入力欄のツールチップ — 修正版モック生成プロンプト

生成方法: 組み込み image_gen の画像編集。
編集元: `form-focus-hint.png`（事前に画像を表示して確認）。
出力: `form-tooltip.png`

```text
Use case: precise-object-edit
Asset type: Japanese browser extension concept UI mockup.
Input images: Image 1 is the edit target and style reference, the Silver Guide focus-hint concept mockup. Edit this exact image.
Primary request: Turn its large inline mint help banner into ONE very small floating tooltip connected to the focused フリガナ input. The user wants a tooltip, not an inline banner. Completely remove the existing full-width mint banner, including its book logo, Silver Guide title, vertical divider, heading and all text. Replace it with a small rounded floating tooltip only.
Keep unchanged: fictional browser chrome, tab title 体験講座, address example.invalid/lesson/apply, toolbar book icon, original fictional website identity 体験講座 and main heading 体験講座 申込フォーム, white page, teal #087F8C, navy #16324F, Noto Sans JP-like large clear Japanese typography, only three original website inputs, entered 氏名 value 山田 花子, focused フリガナ value ヤマダ ハナコ with caret at end, empty 連絡先, and the single original website button 確認画面へ. No side panel.

Tooltip layout: Keep a normal centered website form. You may slightly narrow the form inputs to make clear white page margin on their right. Put the floating tooltip to the RIGHT of the focused フリガナ input in that open white space, aligned around its middle. Make tooltip width less than half of input width, roughly 300 pixels maximum in the whole 1600px-wide image. Give the tooltip a tiny triangular pointer pointing left to the focused input, a thin teal border, white or extremely light mint fill, small corner radius, and subtle small shadow. It must visually float above page, not look embedded or form part of the site's flow. Leave a small gap between tooltip and input. It must not obscure any input, typed value, label, or the website button. Tooltip should contain only exactly these TWO readable Japanese lines:
"カタカナで入力します。"
"例：ヤマダ ハナコ"
No logo, no title, no heading, no button, no close X inside tooltip.
Do not push form fields down to make space for help. Remove the old banner's extra inline vertical block and let 連絡先 follow with normal website form spacing. Keep all three fields and main confirmation button visible. Avoid repeated input controls. Do not add any extension-owned buttons, navigation, step counts, panels, docks, tabs, modal, overlay, or explanations elsewhere.
Footer outside browser exact caption: "Silver Guide 3.0.0 / 入力欄のツールチップ". Remove prior focus-hint captions.
Composition: High-resolution landscape 16:10, flat straight-on browser mockup, no device exterior, crisp readable Japanese. This is a design mockup, not a claim of a functioning screenshot.
```
