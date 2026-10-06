# Silver Guide ブラウザ検証

ブラウザの流れは、架空のローカルページを開く → 利用者が支援を開始する → 項目や用語の説明を確認する → 利用者が選んだ項目へフォーカスを移す、です。実在するサイトの申請・同意・購入・本人確認を実行しません。

## 実行

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm run test:e2e
```

ブラウザを `/tmp` に置く場合は、取得時と実行時の両方に同じ環境変数を指定します。

```sh
PLAYWRIGHT_BROWSERS_PATH=/tmp/silver-guide-playwright-browsers pnpm exec playwright install chromium
PLAYWRIGHT_BROWSERS_PATH=/tmp/silver-guide-playwright-browsers pnpm run test:e2e
```

`test:e2e` は Chromium 向けビルドを作成してから Playwright を実行します。`node node_modules/playwright/cli.js test` で直接実行する場合は、先に `pnpm run build:chromium` が必要です。Playwright の同梱 Chromium を使います。システムの Chrome / Chromium では、バージョンや配布元によって `--load-extension` が利用できない場合があります。対応済みの実行ファイルを指定するには `SILVER_GUIDE_CHROMIUM_PATH` を使えます。

テスト用サーバーは `127.0.0.1:4187` にだけ接続を受け付けます。別ポートを使う場合は `SILVER_GUIDE_TEST_PORT` を指定してください。既存サーバーを再利用しません。

## 検証する内容

| Fixture | 検証する構造・操作 |
| --- | --- |
| `semantic.html` | ラベル、必須、日付・電話・select・checkbox・file・textarea、同一 form / 同名 radio のまとまり、前後移動、別 form 境界、hidden / inert / disabled / readonly / password / submit / reset の除外 |
| `aria-table.html` | 複数の `aria-labelledby`、`aria-describedby`、表の行見出し、定義リスト、入力形式・文字数、ページが示すエラーと native invalid イベント、入力値を含むエラー説明を転載しない回復案内 |
| `dynamic.html` | hidden / disabled の解除、required 属性の変更、現在手順、DOM を置き換える次画面、古い項目からの復帰 |
| `dynamic-information.html` | hidden の旧画面を用語の入口にしない、非同期の画面更新で古い説明を閉じる、編集領域に変化した説明から用語支援を撤去する |
| `privacy.html` | 架空の値・選択・添付ファイルを読まない / 変更しない、編集領域・output・ARIA 選択欄・ライブ領域を読まない、送信や検証を実行しない、通信・コンソール・ストレージ・メッセージに値を残さない |

実際の拡張 service worker / popup / content script を読み込み、開始・設定の保存・停止・再開も検証します。本文の復元、二重注入、キーボード操作、live status、1280×900 / 1280×680 の中央寄せフォームと 390×844 / 大きい文字の配置も確認します。項目移動後にパネル先頭を表示し、操作中の入力欄にパネルが重ならないことも検証します。

値の読取検証では、content script と同じ `ISOLATED` ワールドに DOM getter とメソッドのカウンターを設置します。`value`、`checked`、`selected`、`files`、`validity`、`validationMessage` に加え、保護領域の `Text.data` / `nodeValue` / `textContent` / `innerText` の読取を検知します。テスト側の比較には別のページワールドを使い、入力前後のスナップショットと比較します。

## 隔離と証拠

拡張ビルドとブラウザプロファイルを一時ディレクトリに複製します。複製した manifest にだけ `http://127.0.0.1/*` を追加し、製品 manifest の `activeTab` / `scripting` / `storage` は変更しません。ポップアップをタブとして開く headless テストでは、ブラウザツールバーのユーザー操作による `activeTab` 付与を再現できないためです。外部 HTTP / HTTPS はテストの browser context で遮断します。fixture サーバーも POST を受け付けません。

結果 JSON、失敗時のスクリーンショットと trace、確認用スクリーンショットは、既定で OS の一時ディレクトリの `silver-guide-qa` に保存します。この計算環境では `/tmp/silver-guide-qa` です。別の出力先は `SILVER_GUIDE_QA_DIR` で指定します。HTML レポート、実データ、ブラウザプロファイルをリポジトリに残しません。

Firefox / Floorp、実際のツールバー操作、スクリーンリーダーの発声、実サイトの認証画面、iframe や独自 Shadow DOM のフォームは、この E2E では検証しません。fixture の成功は任意サイトでの完全動作を保証しません。Browser plugin がない環境では、ここに記載した通常の Playwright を使います。
