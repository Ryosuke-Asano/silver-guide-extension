# Silver Guide データと状態の契約

本仕様は [製品設計](../product-design.md) の状態、保存、メッセージ、移行を定める。型は設計用の契約であり、既存の実装へ追加済みのコードではない。実装では実行時スキーマと往復テストも用意する。

## 1 不変条件

- 原 PDF は不変とし、解析と出力へ渡すデータは別の所有物にする。
- すべての回答、項目修正、確認、出力は文書 ID と revision に結び付ける。
- 本人の確認や修正を、遅れて返った解析結果で上書きしない。
- 回答の元値、表示形式、PDF へ配置した値を区別する。
- 保存成功は IndexedDB のコミット後、ファイル保存成功はダウンロード完了後に通知する。
- 一つの保管庫の解除と書き込みを所有する作業セッションは一つとする。
- content script は保管庫の一覧、原 PDF、復号鍵、任意プロフィールを取得できない。
- 閲覧、記入、出力、提出の状態を分ける。

## 2 文書と欄のモデル

PDF様式の一部だけを選ぶ場合や複数の様式候補を組み合わせる場合に備え、採用履歴は項目ごとに保持する。文書全体の様式表示と出力スナップショットは、その履歴の集合から作る。下の`DocumentRecord.template`は単一様式の場合の要約であり、項目の採用元を置き換えない。

実装の`PdfField.templateBinding`には、様式ID・版・様式側の項目ID、完全一致／配置候補、原本hashと配置指紋、descriptorと項目の意味のdigest、採用日時を保存する。署名元のkeyId・packageId・release・payloadHash、公式出典・確認日・様式とpackageの有効期限も固定する。署名された原文の日付形式を保持し、アプリ内部の採用・確認日時とは別の実行時スキーマで検証する。

更新・期限・撤回・鍵の除外は最新の確認済みcatalogと照合する。回答と配置を変えず、影響項目の対応と条件を再確認へ戻す。同じ意味のデータや辞書だけの更新は出力revisionを変えない。履歴から戻した項目も再照合し、旧下書きに存在しない採用版を推定しない。本人の原本確認は失効理由と対象の識別情報へ結び付け、署名元の版を新しい版へ昇格した扱いにしない。

作成・保存の直前にも確認状態を検査する。まだcatalog確認中の項目や未確認の様式を、古い出力の確認状態だけで保存しない。明示的に除外した項目は他の合法な欄の出力を妨げず、原本の読み取り専用制約は独立して守る。

実装のPDF回答は、文字・日付・数値・単一選択では文字列、チェックではboolean、nativeの複数選択では文字列配列とする。null・空文字と旧callerのundefinedは空欄互換だが、文字欄の空配列や単一選択の配列は互換としない。画面とwriterは`pdfAnswerTypeCompatible`を共有し、型不一致を文字列へ暗黙変換しない。再確認状態は空欄・非該当・未完了出力の許可より前に検査し、保留操作で`needs-review`を消さない。

項目・ページの履歴を取り消す場合も、現在の回答のown値を優先して保持する。false・空配列・空文字・nullは現在値であり、履歴の値へ戻さない。現在存在しないIDだけ履歴の回答を補い、合計上限を超える復元は履歴の移動を含めて変更しない。意味・記入者・条件・種類・配置が変わった保持回答は再確認にする。値を変更しない明示確認は項目revision・作業revision・確認日時へ結び付け、下書きへ保存する。

ページ判断は関係する項目の全配置と全選択肢を照合し、一部ページだけの対象除外を原子的に拒否する。原本の全ページ・回答・native制約を保持する。出力には全ページのindexとreviewだけを渡し、独立したowned snapshotを最初のawaitより前に確保する。geometryと文書能力は原本セッションから取得し、呼出側の追加プロパティで上書きしない。対象外または記入欄なしと確認したページへの有効な記入先の矛盾は、未完了出力の許可でも拒否する。

```ts
type Id = string; // ランダム ID。値やファイル名から生成しない
type Revision = number;
type Point = { x: number; y: number };
type Quad = [Point, Point, Point, Point];
type Affine = [number, number, number, number, number, number];
type Box = [number, number, number, number];
type Known<T> = T | "unknown";

type Capability = {
  allowed: boolean;
  reasonCode: string | null;
};

type DocumentRecord = {
  schemaVersion: number;
  id: Id;
  revision: Revision;
  originalHash: string;
  originalBlobId: Id;
  displayName: string;
  source: { kind: "file" | "url"; url: string | null };
  pageIds: Id[];
  capabilities: Record<
    "read" | "analyze" | "nativeWrite" | "overlayWrite" | "export",
    Capability
  >;
  template: { id: Id; version: string; match: "exact" | "structural" } | null;
  engineProfileId: string;
};

type PageRecord = {
  id: Id;
  documentId: Id;
  index: number; // 内部は 0 始まり、画面は 1 始まり
  sourceRef: string | null;
  mediaBox: Box | null;
  cropBox: Box | null;
  visibleBox: Box;
  rotate: 0 | 90 | 180 | 270;
  userUnit: number;
  extraction: "native" | "image" | "mixed" | "unusable";
  regions: Array<{
    id: Id;
    quad: Quad;
    method: "native" | "ocr" | "fused";
    imageToPdf: Affine | null;
    evidenceIds: Id[];
  }>;
  review: "unseen" | "inputs-confirmed" | "no-inputs-confirmed" | "excluded";
};

type RuleAst =
  | { op: "eq"; fieldId: Id; value: string | number | boolean }
  | { op: "present"; fieldId: Id }
  | { op: "all" | "any"; args: RuleAst[] }
  | { op: "not"; arg: RuleAst };

type FieldRecord = {
  id: Id;
  documentId: Id;
  revision: Revision;
  source: "acroform" | "inferred" | "manual" | "template";
  native: {
    fieldRef: string;
    qualifiedName: string;
    widgetRefs: string[];
  } | null;
  kind: "text" | "multiline" | "date" | "number" |
    "checkbox" | "radio" | "select" | "signature" | "unknown";
  labelOriginal: string;
  labelPlain: string;
  subjectId: Id | null;
  role: "applicant" | "proxy" | "organization" | "office" | "signature" | "unknown";
  required: Known<boolean>;
  requiredEvidenceIds: Id[];
  placements: Array<{
    pageId: Id;
    quad: Quad;
    widgetRef: string | null;
    cells: Quad[];
    writingMode: "horizontal" | "vertical";
  }>;
  options: Array<{
    id: Id;
    labelOriginal: string;
    exportValue: string | null;
    placements: Array<{
      pageId: Id;
      quad: Quad;
      nativeFieldRef: string | null;
      widgetRef: string | null;
    }>;
    evidenceIds: Id[];
  }>;
  constraints: {
    maxGraphemes: number | null;
    nativeMaxLength: number | null;
    nativeLengthUnit: "utf16" | "codepoint" | "grapheme" | "unknown";
    multiline: boolean;
    nativeReadOnly: boolean;
    formatId: string | null;
    conditionStatus: "unconditional" | "known" | "unknown";
    condition: RuleAst | null;
  };
  evidenceIds: Id[];
  confidence: {
    text: number | null;
    geometry: number | null;
    labelMapping: number | null;
    kind: number | null;
    role: number | null;
    required: number | null;
    calibrationVersion: string | null;
  };
  mappingState: "proposed" | "needs-review" | "confirmed" | "rejected" | "manual";
  writePolicy: "editable" | "review-required" | "excluded";
};

type EvidenceRecord = {
  id: Id;
  documentId: Id;
  pageId: Id;
  textRaw: string;
  quad: Quad;
  method: "native" | "ocr" | "template" | "manual";
  rawOcrConfidence: number | null;
  engineVersion: string;
  sourceUrl: string | null;
};

type AnswerValue = string | number | boolean | string[] | null;
type AnswerRecord = {
  fieldId: Id;
  revision: Revision;
  rawValue: AnswerValue;
  formattedValue: AnswerValue;
  status: "empty" | "deferred" | "not-applicable" | "entered" | "needs-review";
  formattingConfirmed: boolean;
};

type ExportSnapshot = {
  id: Id;
  documentId: Id;
  originalHash: string;
  answerRevision: Revision;
  mappingRevision: Revision;
  engineProfileId: string;
  fontProfileId: string;
  templateVersion: string | null;
  mode: "editable-form" | "print" | "overlay";
  outputHash: string | null;
  validation: "pending" | "passed" | "failed";
  userReview: "pending" | "confirmed";
  download: "not-started" | "in-progress" | "completed" | "failed";
};
```

同じ種類の氏名でも `subjectId` が違えば回答を共有しない。共有する場合は明示された関係を持つ。回答に含む数値は、郵便番号や識別番号の先頭ゼロを失わないよう、意味が数値の項目以外は文字列とする。

欄の条件は深さ 16、ノード数 200 を上限とする。式の評価、正規表現、URL の読込、関数名の指定をデータへ含めない。循環参照、存在しない ID、巨大な文字列をスキーマで拒否する。未確認の条件を本人の入力値で推定して確定しない。

条件の評価値は true、false、unknown の三値とする。`conditionStatus: unconditional` の場合だけ null を無条件とし、known は非 null の AST、unknown は確認が必要な条件を表す。未回答、後回し、形式未確認、参照不能の回答からは unknown を返す。`not(unknown)` は unknown、all は false があれば false、なければ unknown を伝播し、any は true があれば true、なければ unknown を伝播する。present は本人が確定した空回答と記入済みを区別し、未回答の不在を false にしない。条件 unknown の欄を自動で非表示や該当しない状態にせず、条件確認として残す。

## 3 文章説明のモデル

文章説明は `status: explained | partial | original-only`、対象の原文 ID、原文、文脈、処理ルール版を持つ。結論、条件、行動、注意点、用語の各要素は、表示文と元の UTF-16 範囲、参照した辞書やガイドの ID を持つ。範囲は原文の版と組にし、原文が変わったら再計算する。

単に原文を表示しただけの結果を explained にしない。条件や例外を整理できない場合は partial とし、その原文範囲を省略せず見せる。原文にない結論、資格判定、期限、URL をルールの結果として作らない。個人情報を含む選択文や説明結果は機密作業データとして扱う。

## 4 作業状態と revision

作業状態は `importing → inspecting → analyzing → needs-review → editing → reviewing → exporting → validating → ready-to-save → exported` を基本とする。`paused`、`cancelled`、`failed`、`locked` を別に持つ。失敗時に前状態と再開可能な地点を保持する。

| 状態 | 許可する操作 | 次へ進む条件 |
| --- | --- | --- |
| importing と inspecting | 取消、別の入力 | bytes と能力判定が有効 |
| analyzing | 取消、完了ページの確認 | 対象ページが完了または未解決として識別済み |
| needs-review | 対応確認、欄修正、ページ除外 | 記入する欄の位置と意味を確認 |
| editing | 回答、形式変換、戻る、保存 | 検証可能な回答状態 |
| reviewing | 原本確認、未記入確認、修正 | 出力対象と未完了を本人が認識 |
| exporting と validating | 取消 | スナップショットに合う出力が検証済み |
| ready-to-save | 最終プレビュー、保存 | 検証済み bytes の本人確認 |
| exported | 再表示、修正、別保存 | 提出状態へ自動遷移しない |
| locked | 解除、暗号化バックアップ、終了 | 保管庫解除と保存地点の再構築 |

原本は `documentRevision`、項目の対応は `mappingRevision`、回答は `answerRevision`、画面の確認は参照した revision の組を持つ。いずれかが変われば関連するプレビューと出力確認を無効化する。ジョブの `generation` は開始と再試行で更新し、不一致の結果を破棄する。

本人の操作は型付きの `EditEvent` として記録し、順序番号、対象 ID、変更前後、取消に必要な情報を持つ。履歴も機密データである。一定数でチェックポイントへ集約して無制限に増やさない。文書とテンプレートの更新は別イベントとし、採用した版を固定する。

手続きの状態は `not-started`、`in-progress`、`user-reported-submitted`、`user-reported-accepted` とし、本人の申告として扱う。PDF を保存したという機械的な結果から提出や受理へ遷移しない。

## 5 メッセージとデータ転送

制御メッセージには `schemaVersion`、`requestId`、`type`、`documentId`、`revision`、`generation`、型付き payload を持たせる。ページ向け操作には `tabId`、`frameId`、文書の指紋、操作対象の ID を追加する。

| 送信先 | 許可すること | 渡さないもの |
| --- | --- | --- |
| content → background | 開始状態、選択文、公開構造、明示対象の反映結果 | PDF 本文、保管庫の探索要求、任意 URL の取得命令 |
| workspace → background | タブ操作、権限、特定の反映、取得を求める URL の管理情報 | 原 PDF の bytes、保管庫の鍵、全下書き |
| workspace → Worker | そのジョブの文書または領域、必要な回答、版 | 他の作業、プロフィール全体 |
| Worker → workspace | schema と revision に合う結果 | 自由 HTML、実行コード |

sender の拡張 ID、URL、タブ、フレーム、対応中の文書、許可状態を検証する。拡張ページからの要求でも種別とスキーマを検証する。外部からのメッセージ受付は無効とし、万能な RPC を設けない。

制御メッセージは 64KiB 以下、対象回答は一項目 8KiB 以下を初期上限とする。大きい構造データは型付きのページ・領域単位へ分割し、ArrayBuffer や画像は専用 Worker channel の transferable を使う。受信側も上限を適用し、超過は明示的なエラーにする。Worker の結果は文書あたり最大 5,000 欄を初期上限とし、上限に達したページを完全解析済みと扱わない。

Worker は取消、クラッシュ、期限切れのすべてで未完了 request を reject する。制御 request は初期 10秒、重いページ処理は PDF 仕様の期限を使う。requestId は一意とし、再送による二重反映・二重保存を防止する。成功結果も対象 revision と一致する場合だけ採用する。

PDF の URL 取得は権限の許可後に workspace が所有し、AbortController、stream の容量制限、取得元確認を適用する。取得した bytes は workspace の原本 Blob と Worker の専用入力へ渡す。background は元 bytes を保持せず、長時間の fetch や巨大な IPC の中継を担当しない。

## 6 保存領域

`storage.local` は非機密設定、同意の選択、更新の版、ランダムな所有セッション ID だけに使用する。原本、抽出本文、URL、ファイル名、作業タイトル、画像、サムネイル、回答、履歴、プロフィールは暗号化 IndexedDB に保存する。`storage.sync` を使って個人の作業を同期しない。ブラウザーの storage 自体は暗号化保管庫ではない。[Mozilla の storage](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage)

DB は `vault-header`、`encrypted-chunks`、`encrypted-revisions`、`revision-pointers`、`leases` と、個人情報を含まない公開ガイド用の別 DB に分ける。タイトル、文書ハッシュ、ファイル名、内部索引も暗号化する。平文の管理情報はランダム ID、暗号方式、KDF の設定、暗号文長などに限る。暗号化が作業の存在や全メタデータを隠すとは説明しない。

原本と大きな資材は 1MiB 程度のチャンクに分け、チャンクごとに認証付き暗号を使う。チャンク順、所属、総数を認証対象へ含め、抜けや差し替えを検知する。処理済みのページ画像は原則キャッシュとし、再描画できるものをすべて保存しない。

## 7 暗号化と解除

設計上の標準方式は Web Crypto API の AES-256-GCM とする。保管庫ごとのランダムなデータ暗号鍵 DEK を生成し、パスフレーズから導出した鍵 KEK で包む。KDF は PBKDF2-HMAC-SHA-256、128bit 以上のランダム salt を使う。パラメーターは保管庫の形式に含め、更新できるようにする。[鍵の導出](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/deriveKey)

KDF の初期採用基準は 600,000 回以上を設計の下限とし、最低仕様の端末で測定して固定する。これは測定済みの保護強度を表す値ではない。解除時間の目標は基準端末で 0.3〜1.5秒とする。達成できない場合もその場で弱い方式へ切り替えず、採用基準と対応端末をレビューする。

GCM の nonce は暗号化ごとに新しい 96bit を安全な乱数から生成し、同じ鍵で再利用しない。AAD に形式、保管庫 ID、レコード ID、revision、チャンク順を含める。復号失敗を部分的な成功として読み込まない。暗号文、認証タグ、nonce、KDF 設定だけを保存し、パスフレーズ、DEK、KEK を平文で永続化しない。

パスフレーズは無断で trim、大小変換、Unicode 正規化をしない。設定時に同じ入力を確認でき、表示切替と入力支援を提供する。パスフレーズ変更は DEK を新しい KEK で包み直し、コミット完了後に切り替える。既存の暗号化バックアップには以前のパスフレーズが必要であることを示す。

解除状態は所有する作業タブのセッションだけに置く。新しい作業要求はこのセッションへ案内する。ロックは編集受付を止め、最新の回答と項目対応をスナップショットにし、保存を選んだ作業を暗号化してコミットしてから行う。成功と失敗を確定し、平文状態、復号鍵、Worker、音声、Blob URL を破棄する。

コミット失敗と端末保存を選んでいない作業には、現在の保管庫 DEK で暗号化した一時復旧 envelope を作り、暗号文だけを同じ所有タブのメモリーに残す。保存済みとは表示せず、タブ終了で失われることを示す。次の解除で DEK を復元して envelope を検証し、作業へ戻せる。暗号化にも失敗した場合はその状態と破棄またはロック延長の選択を示し、黙って成功として消さない。自動ロックの事前通知は60秒前に行い、通常のロック中断は5秒を上限に確定する。

保管庫がない一時作業にはこの自動ロックを適用しない。離席時の画面非表示は解除鍵を持つ保管庫のロックとは区別する。ブラウザーや端末の突然の終了では最後のコミット後だけが復旧可能である。

ブラウザー再起動、明示ロック、最後の作業タブ終了、10分の未操作でロックする。OS の画面ロック検知を必須の保護手段にしない。メモリーの完全消去、侵害された端末、悪意ある拡張更新からの保護を暗号化下書きの保証へ含めない。

## 8 自動保存と復旧

保存を選んだ作業だけを自動保存する。暗号化処理は transaction の外で完了させ、暗号化した revision と active pointer の更新を同じ IndexedDB transaction でコミットする。transaction 内で長い crypto 処理を await して寿命を失わせない。

文書更新では期待する直前 revision と所有 lease を確認する。異なる revision へ黙って書き込まない。保管庫と作業の所有権は IDB の排他更新で獲得し、5秒ごとの heartbeat と初期 20秒の期限を持つ。所有画面から応答がない場合だけ解除を求め直して引き継ぐ。時刻の巻き戻りでは期限だけで奪わず、所有画面への応答確認を行う。

保存済み revision は現行と直前 2版を保持し、参照されないチャンクをコミット後に回収する。容量不足、transaction の中断、旧版への復旧では元の revision を保持する。自動保存の UI は「保存中」「端末に保存済み」「保存できていません」を区別する。

復旧では解除後に原本、欄、回答、履歴のチェックポイント、手続き、読書位置を再構築する。解析は未完了のページから再開できる。個人情報を含む未保存メモリーをブラウザー再起動後に復旧できるとは表示しない。

## 9 バックアップと削除

暗号化バックアップは版、KDF 設定、包まれた鍵、レコード一覧と整合性検証情報を持つ。復元前に容量、形式、認証、対象 ID の衝突を検査する。KDF 実行前に方式、反復回数 600,000〜2,000,000、salt 16〜32 bytes、GCM nonce 12 bytes、認証タグ 16 bytes を検証する。認証前のデータから無制限な計算量を受け入れない。形式を変更する場合は移行用の許可範囲を別に定義する。

一つのバックアップは最大 1GiB、4,096 チャンク、50,000 レコードを初期上限とし、展開後の総量も検査する。構造データは長さと深さを制限し、圧縮展開による上限迂回を認めない。大きな保管庫の出力は分割したバックアップにする。取り込みはページやチャンク単位に処理し、途中取消と失敗時にも既存の保管庫を変更しない。

別の保管庫への取込は一度メモリーで復号し、取込先の鍵で暗号化し直す。原本と進捗を含むか、本人が確認できるようにする。

作業削除は対象の revision、チャンク、索引、サムネイル、関連履歴をまとめて削除する。バックアップやダウンロード済み PDF は別のファイルとして削除対象を説明する。拡張内で削除したことを、ストレージ媒体の物理的な安全消去として保証しない。

プライベートウィンドウでは既定で一時作業に限定し、通常の保管庫を開かない。本人がプライベート利用を許可しても、ウィンドウ終了後の IndexedDB 挙動を前提に保存を保証しない。正式サポート表で検証済みの一時動作だけを示す。

## 10 形式の移行

保管庫、文書、ガイド、IPC に別の schemaVersion を持たせる。移行は旧暗号文を保持して新しい領域へ作り、検証後に pointer を切り替える。失敗した場合は旧版の読み取りと暗号化バックアップを利用できるようにする。

新しいソフトウェアが作った保管庫を旧版が更新できない場合、旧版は読み取り専用か受付拒否にし、空の新規保管庫で上書きしない。アプリのロールバックと保管庫形式の互換性を別々に判定する。

現行 `silverGuideSettings` の文字サイズと原文表示は一度だけ移行する。旧版に保存済みの文書やガイドがあると仮定しない。移行後も個人情報を扱う同意や保管庫作成を自動で有効にしない。

## 11 診断と更新のデータ

診断は列挙されたエラーコード、処理段階、匿名化したサイズ区分、ライブラリ版、所要時間を基本にする。文書 bytes、OCR、回答、選択文、URL、ファイル名、スクリーンショット、自由な例外メッセージは含めない。報告する情報を表示し、本人の操作で送る。実際の送信機能と同意の扱いは配布前に整合させる。

ガイドの更新要求は拡張とデータの版だけを使い、対象文書の指紋や閲覧した手続きで更新ファイルを選別しない。更新資材は署名検証、スキーマ、サイズ、hash を確認する。端末が長期間オフラインの場合、配信元の最新の撤回を知ったと表示しない。
