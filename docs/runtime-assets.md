# 同梱資材、ライセンス、再生成

## 固定された入力

`pnpm-lock.yaml`を依存関係の入力とします。PDF.js 6.4.299、pdf-lib 1.17.1、@pdf-lib/fontkit 1.1.1、Tesseract.js 7.0.0を固定しています。`scripts/resources.lock.json`はフォント・OCR資材のcommit、取得元、サイズ、SHA-256、導出方法を保持します。

`pnpm run assets:prepare`はライブラリーのWorker、CMap、標準フォント、WASM、OCR worker/core、モデル、フォント、ライセンスを`public/assets/`へ用意し、hashを検証します。`public/assets/runtime-manifest.json`には準備した各ファイルのサイズ・SHA-256と採用版を記録します。ビルド先では再生成用の可変フォントと比較用CFFを除き、実行に使う資材とライセンスを同梱します。配布物の`assets/runtime-manifest.json`のfilesは実際の同梱ファイルと一致させます。実行時にCDNからコード、モデル、フォントを取得しません。

`assets/third-party-notices.json`と`assets/notices/`にはproduction依存関係の各版のメタデータと、パッケージに存在するライセンス本文をコピーします。`@pdf-lib/fontkit@1.1.1`、`client-only@0.0.1`、`tr46@0.0.3`のnpm配布物はlicense宣言を持つ一方、独立した本文が含まれず、`not-provided-by-package`として記録します。本文を推測で補いません。正式配布前に上流の権利表記・同梱依存を照合する公開条件です。

| 資材 | 用途 | 同梱ライセンス |
| --- | --- | --- |
| PDF.jsとCMap・標準フォント・WASM | 描画、native欄、文字・座標、出力再読込 | 対応する`assets/pdfjs/`内のライセンス資材 |
| Tesseract.jsとcore・日本語／英語／縦書きモデル | ローカルOCR | `assets/tesseract/`、`assets/tesseract-core/`、`assets/tessdata/`のライセンス資材 |
| Noto Sans Japanese/CJK | 日本語と異体字のPDF出力 | `assets/fonts/LICENSE`（SIL OFL 1.1） |
| pdf-lib・fontkitほか | PDF作成とフォント埋込 | 固定依存のlicense。公開パッケージのthird-party一覧で照合 |

## 日本語フォント

出力の標準フォントは、固定されたNoto Sans JPのTrueType可変フォントからweight400へ静的化した`NotoSansJP-Regular.ttf`です。約5.8MBの資材を必要なglyphだけPDFへ埋め込みます。元の可変フォントとCFFは再生成・比較用のビルド入力として保持し、約26MBの不要な実行資材を配布物から除きます。

導出は`scripts/derive-japanese-font.py`、fontTools **4.63.0**、`recalcTimestamp=False`、固定weightとglyf paddingを使用し、生成結果のSHA-256を照合します。Python 3.11と当該fontTools版で固定hashの再生成を確認しました。改変したフォントもOFLを同梱し、単体販売用の資材にしません。上流ソースと派生方法はlockへ記録しています。

資材を再取得する場合だけPython/fontToolsを準備します。通常のビルドにPythonは不要です。

ツールバー・manifestのPNGアイコンは、既存のBookIconの座標から`scripts/create-icons.py`で16/32/48/64/128pxへ生成しています。PNGは同梱済みで、再生成時だけPillowを使用します。新しいブランド図柄へ変更していません。

```powershell
python -m pip install fonttools==4.63.0
# 必要なら実行するPythonを指定する。
$env:SILVERGUIDE_PYTHON = 'C:\path\to\python.exe'
corepack pnpm@10.13.1 run assets:download
corepack pnpm@10.13.1 run assets:prepare
```

取得時はlockにある上流commitとhashを使用します。新しい資材へ更新するときは、lock・ライセンス・字形・出力再検証の記録も更新します。上流変更を勝手に最新化しません。

## 署名案内

同梱データは`src/features/guides-update/builtin-package.json`と公開鍵で検証します。署名は`scripts/sign-guide-package.mjs`で生成します。秘密鍵パスがリポジトリ内の場合は拒否し、ログへ鍵内容を出しません。公開情報には開発用鍵IDを使用し、本番鍵管理は未定です。

```powershell
node scripts/sign-guide-package.mjs --key C:\external\private-key.json --key-id KEY_ID --input C:\reviewed\payload.json --output C:\reviewed\signed-package.json --public-output C:\reviewed\public-key.json
```

公開前に署名・payload schema・出典・期限・対象app版を別担当が確認します。秘密鍵は配布物、source archive、テストfixtureへ含めません。
