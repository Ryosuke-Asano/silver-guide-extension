# Chrome サイドパネル

Chrome 版はページ左上の支援パネルを表示せず、Chrome の Side Panel API を使う。既存の用語説明はページ内の対象語句の近くに表示する。Firefox / Floorp 版は従来のポップアップとページ内の支援パネルを使う。

## 開始と終了

Chrome 114 以降で拡張アイコンを押すと、ブラウザーのサイドパネルが開く。その中の「このページを支援する」から現在のタブだけを開始する。サイドパネルには項目名、必須や形式、入力例、前後の項目移動、ページが示したエラーへの戻り、用語説明への導線、確認済みの公式ガイドを表示する。

「支援を停止する」でページに追加した用語と監視を解除する。Chrome の閉じるボタンはパネルを閉じるだけなので、用語支援は続く。ページを再読み込みしたり別ページへ遷移したりした場合は、開始を選び直す。タブ切り替えでは各タブの現在の状態を照会する。すでに開始済みのタブへ戻った場合は、そのタブの案内を再表示する。

サイドパネルから直接開始する権限がない場合は、通常のWebページで拡張アイコンを押してから開始する。保護された `chrome://` ページや他の拡張ページには注入しない。Chrome のポリシーやページ保護を回避しない。

## 権限とデータ

- Chrome manifest の `side_panel.default_path` は `sidepanel.html`。`action.default_popup` は削除する。
- Chrome の `sidePanel` 権限を追加する。既存の `activeTab` / `scripting` / `storage` は維持し、常時ホスト権限、`tabs` 権限、認証情報は追加しない。
- `setPanelBehavior({openPanelOnActionClick:true})` を使い、利用者による拡張アイコンの操作でネイティブパネルを開く。[Chrome公式仕様](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)。
- content script は既存の公開構造解析を使い、入力値・選択状態・添付内容を読まない。スナップショットは項目名・公開形式・表示中の手順・エラー件数・同梱されたガイドだけを含む。任意の HTML を渡さず、エラー通知のある欄の `aria-describedby` や明示されたエラー原文を補足説明から除く。状態・種類の通知がない文章の判別には [解析の制約](form-support.md) がある。
- メッセージは拡張内に限定する。背景では案内を保存・キャッシュせず、現在の content context から取得する。保存するのは従来の文字サイズ・原文表示設定だけ。

## タブと画面の境界

サイドパネルは自分の `windowId` と表示中の `tabId` を照合する。背景でも毎回 active tab を確認し、別タブへの開始・フォーカス移動・停止・設定更新を拒否する。タブ切り替え、削除、読み込み開始では UI の古い案内を直ちに外し、非同期照会の世代番号で遅い応答を破棄する。

開始ごとに `sessionId`、公開状態の変更ごとに `revision` を更新する。停止・設定更新は現在の session、項目移動は session と revision が一致する場合に限る。画面差し替え後の古い「次の項目へ」で、別の欄へ勝手に移動しない。開始処理の途中でタブや文書が切り替わった場合も開始しない。

Chrome の開始メッセージは、注入結果に含まれるトップフレームの `documentId` を宛先に指定する。直前の照合後に遷移した場合にも、移動先の文書へ開始メッセージを届けない。文書 ID が取得できない場合は開始しない。[注入結果の仕様](https://developer.chrome.com/docs/extensions/reference/api/scripting#type-InjectionResult)、[メッセージ宛先の仕様](https://developer.chrome.com/docs/extensions/reference/api/tabs#method-sendMessage)。

content の通知は background で送信元のトップフレーム・タブ・ウィンドウを確認して、状態を照会し直すための通知に変換する。古い文書から遅れて届いた snapshot を、そのまま UI に適用しない。対象外の欄へのフォーカス、動的な欄の追加、エラーの通知、表示サイズの変更も公開状態を再解析する。

状態の照会に失敗した場合も、表示していた案内を消し、古い操作の遅延応答を破棄する。「案内を更新する」で状態を再確認できる。

## 検証方法と制約

Browser plugin がないため、既存の Playwright / Chrome for Testing を使用する。架空の localhost fixture を使い、製品 manifest のホスト権限は増やさない。拡張の一時テストコピーだけに localhost のホスト権限を付ける。ネイティブパネルの開閉・描画と、sidepanel.html を通常のタブとして開く UI 統合テストは区別して記録する。

従来のページ内パネルの回帰テストは、直接注入時に `presentation:'page'` を指定して Firefox / Floorp の表示経路を検証する。Chrome の通常の開始経路では `presentation:'sidepanel'` を使い、ページ内に支援ドックがないことを確認する。型チェック、lint、単体、両ブラウザー向けビルド、実拡張E2Eを行う。

実行政サイトへの送信・ログイン・同意・本人確認はテストしない。iframe、サイト内 Shadow DOM、独自ウィジェット、PDF の解析範囲は拡張しない。サイドパネルの幅・左右配置は Chrome の設定による。スクリーンリーダーや各Chrome版・管理ポリシー下の挙動は個別確認が必要。

## 入力エラー原文の境界

最終レビューで、`aria-invalid=true` の欄が `aria-describedby` で参照する未標識のエラー文を、通常の説明として扱う既存の境界を再現した。架空の echo 文が snapshot に入り、plain paragraph の用語走査もその文字を読んだ。公開・非公開を文面から推測せず、宣言されたエラー状態と native 通知を使って除外する。

- `fieldDetails` は通知されたエラー欄の `aria-describedby` を解決・読取しない。公開ラベル・形式・placeholder は維持する。エラー通知が外れた場合は通常の補足を復元する。
- native エラー欄への再フォーカス時の live status でも、同じ除外を使う。
- 用語走査は、通知されたエラー欄の説明参照と全 `aria-errormessage` の領域を、文字に触れる前に除外する。すでに付いた用語ボタンが後からエラー領域へ入った場合も、文字を読まずに解除する。ガイド用の見出し・手順候補もその領域を除く。

ラベルやエラー状態などの構造が不適切なページ、通知のない未標識文の判別には制約がある。入力内容の正しさ・修正済みかどうかは判定しない。

## 2026-10-07 の最終検証

Node 24.19.0 / pnpm 10.13.1、Playwright 1.58.2 / Chrome for Testing 145.0.7632.6、Firefox 157.0.1 / geckodriver 0.37.1 を使用した。検証は Codex 計算環境の架空 localhost fixture と専用一時プロファイルで実行した。

| 確認 | 最終結果 | 範囲 |
| --- | --- | --- |
| 型チェック・lint | 成功、lint 警告 0 | 本体・単体テスト・設定 |
| 単体 | **164 / 164 成功、5ファイル** | 既存解析、背景17件、UI7件、未標識エラーの3回帰を含む |
| Chrome / Firefox ビルド | 両方成功 | `pnpm run build:chromium`、`pnpm run build` |
| Chrome ネイティブパネル E2E | **7 / 7 成功** | 実ネイティブ pane の user gesture 起動、開始停止・設定・項目移動、動的2段階、エラー復帰、タブ・reload・2ウィンドウ隔離、privacy、大きい文字 |
| 従来のページ内表示 E2E | **16 / 16 成功** | Chrome上で `presentation:page` を指定した既存の回帰経路 |
| Firefox 実拡張 smoke | **7 / 7 成功** | 製品 manifest と実ツールバー・popup、前後移動、停止再開、エラー・動的画面・公開ラベル |
| 独立エラー境界確認 | **5 / 5 成功** | ARIA / native / 既生成term / nested step / nested heading の private text 読取0・例外0 |
| 差分・E2E構文確認 | 成功 | `git diff --check` と `node --check` |

Chrome 最終一巡は **07:17:06.898 UTC 開始、33.355秒、23成功、失敗・skip・flaky 0**。Firefox は **07:15:25.060–07:15:31.781 UTC、7成功**。両方で同じ `content.js` を使った。

```text
content.js SHA256   ab30dc9dd551e424647250c8cce65b755b6b690b87bb3ca8cfe671964d8ea5ef
background.js       1d88852d9ddf69e0e2f50a3e92681cf9491512b199c54603c744c19e62493876
sidepanel JS        875508079bb60da7ead9556cc3bd7eac6da7d55ea956a5ccd7cde699a639c6c8
```

Chrome native E2E は `sidepanel.html` を通常のタブとして開かず、テスト専用の拡張ページの実クリックで `sidePanel.open` を呼び、`onOpened` と CDP target を確認した。製品の `setPanelBehavior` / `getOptions`、ページ内ドック不在、パネル操作から元ページへの移動も確認した。テスト専用ページと localhost 権限は一時コピーにだけ存在する。

privacy は、入力値・選択状態・添付・検証プロパティ・保護領域の文字の getter / setter を監視し、読取・変更・検証・送信0を確認した。未標識のエラー echo に用語を含め、ARIA / native の両方で snapshot / UIへの転載なし、用語ボタンなし、private text 読取0を確認した。見出しと手順の子にエラーが入る変種も対象にした。通知が外れた場合の通常説明の復元も確認した。

### 途中の失敗と未実施

- 初回の23件一巡は21成功・2失敗。対象外欄へ移った後に存在しない「項目の案内に戻る」を押す操作と、別プロセスのUI更新を待たないテストが原因だった。製品を変更せずテストを修正し、対象2件と全23件の再実行が成功した。
- その後のレビューで、未標識エラーの転載・用語走査による読取を架空データで再現した。これは製品側の既存境界であり、解析・focus・用語・見出し・手順を修正したうえで、上記の最終ビルドと全ブラウザ検証をやり直した。
- Firefox の最初の起動は計算環境の `/proc/self/uid_map` 制約で拡張読込前に失敗した。承認された隔離外の一時実行で成功した。Firefox自身のサンドボックス・証明書・署名保護は維持した。
- headless Chrome では元ページと pane の `document.hasFocus()` が両方 true になり、ページへ実クリック・bringToFrontしても pane の blur を確認できなかった。320px は native target のサイズ emulationと明示的なpane内スクロールで見出し・形式・横幅を実測した。自動スクロールの分岐は独立UI単体で確認し、実nativeでの自動reveal成功とは扱わない。native 設定操作中のfocus・control位置・見出しscroll呼出し0は確認した。
- Chrome の実ツールバークリックによる `activeTab` 付与、Chrome114 / Firefox121、Windows / macOS、Floorp本体、スクリーンリーダーの発声、実行政サイトの認証後の画面、管理ポリシー下は未実施。ストア配信・本番デプロイも行っていない。

### 再現と証拠

通常の環境では `pnpm run check`、`pnpm run lint`、`pnpm test`、`pnpm run test:e2e` を実行する。Firefox は [専用runnerの説明](../tests/firefox/README.md) の実行ファイルを指定して `pnpm run test:firefox` を使う。新しい fixture と全回帰コードはリポジトリに含めた。

- Chrome 最終結果・hash・native API・privacy・focus / geometry・画面: `/tmp/silver-guide-qa/sidepanel/final-complete/`
- Firefox 最終結果・画面: `/tmp/silver-guide-qa/sidepanel/final-complete-firefox/`
- 途中の23件失敗とテスト修正後: `sidepanel/final/`、`final-targeted-fix/`、`final-rerun/`
- 未標識エラーの修正前: `sidepanel/unmarked-error-before-fix/`、独立 guard は `/tmp/silver-guide-sidepanel-boundary-review/`
- 独立レビュー: `/tmp/silver-guide-qa/sidepanel-independent-review.md`

生ログ・画像・ブラウザプロファイルはソースに含めない。最終結果はこの環境の検証範囲を示すもので、任意サイトでの完全動作を保証しない。
