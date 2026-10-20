# Silver Guide 3.0.0

元のページの入力欄には小さな Tooltip、下線の単語にはページ内の解説ポップアップ、PDF の記入には専用タブを使う拡張機能です。長い文章を範囲選択する解説は、ブラウザーのサイドパネルにも残しています。機能を三つに絞り、独自のパスワード・保管庫・下書き管理・別入力画面を廃止しました。

| 機能 | 操作 |
| --- | --- |
| フォーム補助 | 許可済みページの欄にフォーカスすると、上側に短い案内。元の欄へ直接入力します。追加ボタンはありません |
| 文章の解説 | 本文の下線語をクリックすると、その場に短い解説ポップアップを表示します。閉じる・Escape・外側クリックで畳めます。長い文章はアイコンからサイドパネルを開いて範囲選択できます |
| PDF | パネル下の「PDFを開く」から専用タブへ。左で回答すると右の記入プレビューへ自動反映。戻る／次へ、最後は「PDFを保存」で保存します |

3.0.0 は開発版です。[採用 Spec](docs/specs/3.0.0/spec.md)、[画面とモック](docs/specs/3.0.0/screen-design.md)、[実装順](docs/specs/3.0.0/implementation-plan.md)、[実装状況](docs/specs/3.0.0/implementation-status.md)を参照してください。署名済みの一般配布物、実際の対象利用者による初見評価は別の公開条件です。

下線語ポップアップ追加前の3.0.0では、WindowsのFloorp 12.20.2／Gecko 158.0.1の通常ウィンドウで、Microsoft IMEによるフォーム・PDFへの日本語入力、標準のPDF保存先ダイアログでの保存・取消・再試行、保存PDFの再表示と再保存を確認しました。今回の追加を含む版の結果は、その履歴と分けて[実装状況](docs/specs/3.0.0/implementation-status.md)に記録しています。他OSと対象利用者の初見評価は未実施です。

書類・回答・選択文は端末内で処理し、タブを閉じた後の復元や自動保存は行いません。PDF の入力を残すには、再読み込み・終了前に PDF を保存してください。元サイトの保存・送信はそのサイトの操作に従います。旧版の保存済みデータを自動削除・平文変換する処理はありません。

## ビルド

Node.js 24 と pnpm 10.13.1 を使います。

```powershell
corepack pnpm@10.13.1 install --frozen-lockfile
corepack pnpm@10.13.1 run check
corepack pnpm@10.13.1 run test
corepack pnpm@10.13.1 run build
corepack pnpm@10.13.1 run build:chromium
```

`dist/` は Floorp・Firefox 向け、`dist-chromium/` は Chromium 向けです。実行時の OCR モデル・日本語フォント・実行コードは同梱します。[資材とライセンス](docs/runtime-assets.md)に再生成手順があります。ブラウザーを使う PDF 試験には Playwright の対応ブラウザーが必要です。

## 開発版を読み込む

Floorp・Firefox では `about:debugging#/runtime/this-firefox` の「一時的なアドオンを読み込む」から `dist/manifest.json` を選びます。Chromium では `chrome://extensions` の開発者モードで `dist-chromium/` を「展開して読み込み」ます。

ブラウザーのサイトアクセスが許可された HTTP(S) ページで、フォーム補助と本文の下線語解説が動作します。アクセスの許可・拒否はブラウザー標準の操作を使います。単語ポップアップにアイコンの操作は不要です。拡張アイコンは補助の解説サイドパネルを直接開きます。独自の設定・パスワード登録はありません。

manifest の最低版は Gecko 140、Chromium 122 です。実測した OS・ブラウザーと限界は[実装状況](docs/specs/3.0.0/implementation-status.md)に記録し、最低版の記載だけで未試験環境の動作を保証しません。Gecko ID `silver-guide@example.invalid` は開発用です。

## 資料

- [使い方](docs/user-guide.md)
- [プライバシー・権限・問い合わせ](docs/privacy-and-support.md)
- [3.0.0 の Spec と作業順](docs/specs/3.0.0/README.md)
- [過去の失敗と今回の方針](docs/specs/3.0.0/retrospective.md)
- [資料一覧と 2.0 の検証履歴](docs/README.md)

[2.0 の README](docs/history/readme-2.0.md)や旧検証資料は履歴です。旧版のテスト数・精度・性能を 3.0.0 の合格結果として扱いません。
