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

この計算環境では Playwright 1.58.2 に同梱された Chrome for Testing 145.0.7632.6 を使用します。テストの拡張プロファイルとサーバーは実行ごとに閉じます。

テスト用サーバーは `127.0.0.1:4187` にだけ接続を受け付けます。別ポートを使う場合は `SILVER_GUIDE_TEST_PORT` を指定してください。既存サーバーを再利用しません。

## 検証する内容

| Fixture | 検証する構造・操作 |
| --- | --- |
| `semantic.html` | ラベル、必須、日付・電話・select・checkbox・file・textarea、同一 form / 同名 radio のまとまり、前後移動、別 form 境界、hidden / inert / disabled / readonly / password / submit / reset の除外 |
| `aria-table.html` | 複数の `aria-labelledby`、`aria-describedby`、表の行見出し、定義リスト、入力形式・文字数、ページが示すエラーと native invalid イベント、エラー通知中の未標識 `aria-describedby` 値 echo を読まず省略する、段落・見出し・現在手順内のエラーを用語や手順の根拠にしない、修正後の通常説明の復帰 |
| `dynamic.html` | hidden / disabled の解除、required 属性の変更、現在手順、DOM を置き換える次画面、古い項目からの復帰 |
| `dynamic-information.html` | hidden の旧画面を用語の入口にしない、非同期の画面更新で古い説明を閉じる、編集領域に変化した説明から用語支援を撤去する |
| `privacy.html` | 架空の値・選択・添付ファイルを読まない / 変更しない、編集領域・output・ARIA 選択欄・ライブ領域を読まない、送信や検証を実行しない、通信・コンソール・ストレージ・メッセージに値を残さない |
| `public-contact.html` | ヘッダー・ナビゲーション・本文の検索欄を初期案内から除外する、可視の項目名と ARIA 入力例の区別、公開の必須バッジ・画像 alt、対象外の入力欄やカスタム部品への焦点移動、共通欄だけを残したページ |

実際の拡張 service worker と content script を読み込み、2つの表示方式を分けて検証します。

- `forms.e2e.mjs` の16件は、直接 content script に `presentation: "page"` を指定します。Firefox のページ内パネルと共通解析の回帰を Chromium で確認するためです。本文の復元、二重注入、キーボード操作、live status、1280×900 / 1280×680 の中央寄せフォームと 390×844 / 大きい文字の配置、通常の Tab と対象外欄の非被覆を確認します。Firefox 本体の実行結果とは区別してください。
- `sidepanel.e2e.mjs` は、Chrome の**実際のネイティブサイドパネル**を使用します。実 API の `getPanelBehavior` / `getOptions`、ユーザー操作による開始、項目の前後移動、設定の保存、停止・再開、動的・複数段階フォーム、入力エラー、古い revision / session の拒否、タブ切替・再読み込み、2つのウィンドウの隔離を確認します。Chrome 側ではページ内パネルがないことも確認します。

ネイティブパネルは Playwright の `context.pages()` には現れないため、`native-panel.mjs` が Chrome DevTools Protocol の実ターゲットに接続します。開始には一時拡張にだけ追加する `qa-open-panel.html` のボタンを実クリックし、Chrome の `sidePanel.open()` をユーザー操作から呼びます。パネルの操作も CDP のマウス入力です。`sidepanel.html` を独立したタブとして開く方式は使用しません。スクリーンショットは実パネルのターゲットから取得します。

実パネルの通常幅は360pxです。320px / 大きい文字の確認では、その実ターゲットの viewport のみをエミュレーションし、横方向のはみ出し、項目の説明、設定中の焦点維持を検証します。headless Chrome はページへのクリック後もサイドパネルの `document.hasFocus()` を保持する場合があります。`page.bringToFront`、`Target.activateTarget`、`Page.bringToFront` の結果を記録し、元ページへの焦点移動を確認できない場合はパネル内を明示的にスクロールします。この場合、元ページのクリックに応じた自動スクロールの実証には数えません。製品の焦点判定をテスト用に変更しません。

値の読取検証では、content script と同じ `ISOLATED` ワールドに DOM getter とメソッドのカウンターを設置します。`value`、`checked`、`selected`、`files`、`validity`、`validationMessage` に加え、保護領域の `Text.data` / `nodeValue` / `textContent` / `innerText` の読取を検知します。テスト側の比較には別のページワールドを使い、入力前後のスナップショットと比較します。

未標識のエラー echo のテストでは、fixture の `data-fixture-private-echo` を読取カウンターの対象を示すためにだけ使います。製品はこの属性を使用せず、`aria-invalid` または native invalid 通知を根拠に説明を省略します。エラーがないときの通常の `aria-describedby` は保持します。

## 隔離と証拠

拡張ビルドとブラウザプロファイルを一時ディレクトリに複製します。複製した manifest にだけ `http://127.0.0.1/*` を追加し、製品 manifest の権限は変更しません。テスト用にパネルを開くボタンは、fixture に `activeTab` を付与しません。Chrome ツールバーを実クリックしたときの `activeTab` 付与は、この自動テストでは未確認です。製品の `openPanelOnActionClick` の設定と実パネルを開く操作は確認します。

`qa-open-panel.html` / `qa-open-panel.js` と localhost 権限は使い捨てのテスト用ディレクトリにだけ追加し、配布用ビルドには含めません。外部 HTTP / HTTPS は Playwright の browser context で遮断し、Playwright に属さない実パネルのターゲットも CDP の `Fetch` で遮断・記録します。fixture サーバーも POST を受け付けません。Chrome の保護設定は変更しません。

結果 JSON、失敗時のスクリーンショットと trace、確認用スクリーンショットは、既定で OS の一時ディレクトリの `silver-guide-qa` に保存します。この計算環境では `/tmp/silver-guide-qa` です。別の出力先は `SILVER_GUIDE_QA_DIR` で指定します。HTML レポート、実データ、ブラウザプロファイルをリポジトリに残しません。

Firefox / Floorp 本体、Chrome の実際のツールバー操作、スクリーンリーダーの発声、実サイトの認証画面、iframe や独自 Shadow DOM のフォーム、最低対応版 Chrome 114 のランタイムは、この E2E では検証しません。fixture の成功は任意サイトでの完全動作を保証しません。Browser plugin がない環境では、ここに記載した通常の Playwright を使います。

## Firefox / Floorp の手動確認

Firefox 向けの実拡張と `activeTab` の付与は、ブラウザの通常のツールバー操作で確認します。以下は架空フォームだけの確認です。認証・実申請は不要で、追加のホスト権限も不要です。

1. `pnpm run build` を実行し、別端末で `node tests/e2e/server.mjs` を起動します。
2. Firefox / Floorp の `about:debugging#/runtime/this-firefox` で「一時的なアドオンを読み込む」から `dist/manifest.json` を選びます。
3. `http://127.0.0.1:4187/semantic.html` を開き、ツールバーの拡張機能メニューから Silver Guide を選び、「このページを支援する」を押します。パネルが一つ表示され、「最初の入力項目へ」「次の項目へ」で氏名・生年月日などに移れること、通常の Tab でも入力欄がパネルに隠れないことを確認します。
4. パネルの「閉じる」（支援の停止）で本文が戻ることを確認し、再びツールバーから開始します。パネルが重複しないことを確認します。
5. `aria-table.html` を開いて支援を開始し、ページの「入力エラーを表示する (ローカルテスト)」を押します。「最初のエラー項目へ」で電子メール欄へ戻れることを確認します。表示される復帰案内に架空の入力値やエラー原文が転載されないことも確認します。
6. `dynamic.html` を開いて支援を開始し、ページの「次の画面を表示する (ローカルテスト)」を押します。届出内容と日付の欄へ案内が切り替わることを確認します。

ページ移動後はそのページで支援を開始し直します。テスト終了後は fixture サーバーを Ctrl+C で停止し、一時アドオンを削除するかブラウザを終了します。結果には Firefox / Floorp のバージョン、成功した操作、失敗した操作を分けて記録してください。

Firefox の実拡張をツールバー操作から自動確認する方法は [tests/firefox/README.md](../firefox/README.md) を参照してください。
