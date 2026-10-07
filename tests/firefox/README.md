# Firefox 実拡張の確認

Firefox 向けの **製品と同じ manifest** を一時アドオンとして読み込み、実際のツールバーの拡張ボタンで `activeTab` を付与してから、ポップアップの開始ボタンを押します。localhost 用ホスト権限は追加しません。架空 fixture のみを使い、入力・選択の変更、実申請、認証、外部フォームの送信をしません。

## 実行方法

[Mozilla 配布版 Firefox](https://download.mozilla.org/?product=firefox-latest&os=linux) と [geckodriver](https://github.com/mozilla/geckodriver/releases) を用意します。Node.js 以外のテストライブラリは不要です。

```sh
SILVER_GUIDE_FIREFOX_PATH=/path/to/firefox \
SILVER_GUIDE_GECKODRIVER_PATH=/path/to/geckodriver \
pnpm run test:firefox
```

Firefox を既定の場所にインストールしている場合は `SILVER_GUIDE_FIREFOX_PATH` を省略できます。geckodriver が PATH にある場合もパス指定は不要です。ビルド済みの `dist/` を確認する場合は `node tests/firefox/smoke.mjs` を使います。

runner は新しい一時プロファイル・拡張コピー・XDG ディレクトリと、空いている localhost ポートを使います。既存ブラウザや Floorp のプロファイルは使いません。テスト後にセッション・サーバーを停止し、一時プロファイルを削除します。

強制中断時の子プロセス終了は未検証です。途中で端末や runner を強制終了した場合は、そのテストで起動した Firefox / geckodriver / fixture サーバーが終了していることを確認してください。

Firefox の UI を操作するため、geckodriver の公式 [UI テスト用 `--allow-system-access`](https://firefox-source-docs.mozilla.org/testing/geckodriver/Flags.html#allow-system-access) をテストプロセスに指定します。ドライバーは localhost にだけ接続を受け付けます。Firefox 自身のサンドボックス、証明書検証、署名検証は無効にしません。製品の権限も変更しません。

## 確認すること

- 実際のツールバー操作による権限付与と popup → background → content の起動
- 最初・次の項目への移動、値と radio の選択状態が変わらないこと
- 停止とポップアップからの再開、二重注入・重複パネルがないこと
- ページの ARIA エラーと native invalid 通知からの復帰、エラー原文の転載がないこと
- 同じページの手順差し替えと、狭い画面で現在の入力欄がパネルに隠れないこと
- 検索・共通欄を初期項目から除き、電話番号の可視ラベルと公開必須表示を補足すること
- 対象外の readonly / password / 独自入力欄で前のヒントを解除し、欄にパネルが重ならないこと
- fixture の送信回数が常に 0 であること

Firefox の remote popup は HTML iframe として扱えないため、その browsing context に対して Mozilla の native Marionette commands を使用します。通常のクリック判定を保ち、拡張 API や background をテスト用コードに置き換えません。この橋渡しは Firefox 157.0.1 / geckodriver 0.37.1 で確認しました。Firefox の古い版や Floorp の UI では調整が必要な場合があります。

結果は既定で OS の一時ディレクトリの `silver-guide-qa/firefox/` に保存します。`smoke-results.json`、`smoke-geckodriver.log`、画面画像を残します。出力先を変更する場合は `SILVER_GUIDE_FIREFOX_QA_DIR` を指定してください。レポートにはテスト対象の `content.js` の SHA256 と実際の viewport を記録します。Firefox の最小ウィンドウ幅による制約があり、この環境のモバイル確認は 500×758、Chromium の E2E は 390×844 です。

## 実行環境に関する制約

Codex のファイルシステム隔離内では `/proc/self/uid_map` が読み取り専用になり、Firefox の content process が起動前に終了しました。承認された一時的なテスト実行を隔離の外で行うことで解消し、Firefox 自身のサンドボックスを有効のまま上記の確認が成功しています。この環境上の失敗と拡張のテスト失敗を区別してください。

通常の Firefox / Floorp での手動確認は [E2E README](../e2e/README.md#firefox--floorp-の手動確認) を参照してください。スクリーンリーダーの発声、Floorp 自体の実行、ストア向け署名・配信はこの smoke では確認しません。
