# 入力欄の上にツールチップ — 修正版モック生成プロンプト

生成方法: 組み込み image_gen の画像編集。
編集元: `form-tooltip.png`（事前に画像を表示して確認）。
出力: `form-tooltip-above.png`

## 初回の位置変更

```text
Use case: precise-object-edit
Asset type: Japanese browser extension concept UI mockup.
Input images: Image 1 is the exact edit target and style reference, form-tooltip.png.
Primary request: Move ONLY the existing floating tooltip from the right of the focused field to directly ABOVE the focused フリガナ input. Remove the entire old right-side tooltip and its left-pointing pointer so the right page margin becomes empty again. Keep the original browser, form, typography, colors, all field positions and button positions unchanged.

Precise placement: The original 氏名 input ends near y452 and the original focused フリガナ input begins near y519 in this roughly 1586x992 image. Put a compact tooltip in the existing white gap between those inputs, on the RIGHT part of the form, to the right of the フリガナ label. The tooltip body must stay horizontally inside the focused input width, aligned near the input's right edge, roughly x820..1130. Its body must fit entirely in the existing whitespace above that input, roughly y457..505, with a tiny downward triangular pointer pointing at the focused フリガナ input top edge. Maintain a small visual gap of about 8–12px from the input top. Use a shorter tooltip body and slightly smaller but clear Japanese text to fit the two lines naturally in the existing gap. Do not overlap the 氏名 input above, the フリガナ label at left, or the focused input itself. It must clearly read as ABOVE the field, never to the side. Do not increase field spacing, push any form element down, expand the page, or alter the overall form layout to accommodate this tooltip.
Tooltip: about 300px wide maximum and less than half the focused input width, very light mint fill, thin teal #087F8C border, small rounded corners, discreet shadow. EXACTLY TWO lines, no heading or branding:
"カタカナで入力します。"
"例：ヤマダ ハナコ"
Keep crisp Noto Sans JP-like legibility. The small DOWNWARD pointer must be clearly visible, centered or right-aligned beneath the tooltip, connecting visually to the input below.

Invariants: same fictional browser chrome; 体験講座 tab; example.invalid/lesson/apply URL; book toolbar icon; original fictional 体験講座 website masthead and 体験講座 申込フォーム heading. Same 氏名 field with 山田 花子, same focused teal-outlined フリガナ field with ヤマダ ハナコ and caret at end, same empty 連絡先 field, same single original website teal 確認画面へ button. No sidebar, duplicated fields, new buttons, X, tooltip logo, heading, large banner, inline help block, modal, settings, navigation, or extra control.
Change bottom outside-browser caption to exactly "Silver Guide 3.0.0 / 入力欄の上にツールチップ".
High-resolution landscape 16:10, flat front-on screen concept mockup, retain image framing and all other composition.
```

## 確認後の余白修正

初回出力で氏名欄の右下端と吹き出し上端が少し重なったため、生成結果を表示してから次のプロンプトで吹き出しの高さ・位置だけを修正。

```text
Use case: precise-object-edit.
Input image 1 is the edit target, already showing the desired above-field tooltip. Keep the whole image exactly the same EXCEPT fix the tooltip's size and placement. Current error: its top overlaps the bottom edge of the 氏名 input. It MUST NOT cover any input edge. The original upper 氏名 input's bottom is y451, and the focused フリガナ input top is y519.
Change only the tooltip: decrease its height to about 46px by reducing text font to clear 18px with 20px line spacing, reduce vertical padding to 3px, and position the tooltip body from about y456 to y503, entirely in the existing white gap. Keep its right edge INSIDE the field's right edge (x1137), e.g. body x842..1128. Use a small 7px downward triangle from its lower edge down to y510, leaving a visible gap before the focused input at y519. Body width 286px. Do not move any form field or label. The tooltip must be visibly below the bottom of the 氏名 input with at least 4px of white separation, to the right of the フリガナ label, and above the focused フリガナ input with a visible gap. No overlap anywhere.
Keep the same two lines EXACTLY: "カタカナで入力します。" and "例：ヤマダ ハナコ". Keep mint fill, thin teal border, discreet shadow, small downward pointer. No logo or buttons. Keep everything else including footer, browser, site title, input contents, positions, and button identical.
```

