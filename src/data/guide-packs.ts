export type GuideField = {
  publicSelector: string;
  purpose: string;
  preparation: readonly string[];
  nextPublicSelector?: string;
};

export type GuideRoute = {
  label: string;
  officialUrl: string;
};

export type GuidePageEvidence = {
  headings: readonly string[];
};

export type GuidePack = {
  id: string;
  reviewedAt: string;
  origin: string;
  pathPattern: RegExp;
  requiredHeadings: readonly string[];
  summary: string;
  preparation?: readonly string[];
  fields: readonly GuideField[];
  routes: readonly GuideRoute[];
};

const YOKOHAMA_CITY_ORIGIN = "https://www.city.yokohama.lg.jp";
const YOKOHAMA_APPLICATION_ORIGIN = "https://shinsei.city.yokohama.lg.jp";

/**
 * 公開ページの見出しと公式 URL を確認済みの行政案内だけを登録する。
 * フォーム値、ログイン情報、暗証番号、マイナンバーは定義にも収集にも含めない。
 */
export const GUIDE_PACKS: readonly GuidePack[] = [
  {
    id: "yokohama-resident-record-online-guide",
    reviewedAt: "2026-09-16",
    origin: YOKOHAMA_CITY_ORIGIN,
    pathPattern:
      /^\/kurashi\/koseki-zei-hoken\/todokede\/koseki-juminhyo\/shoumei\/jyuminhyou\/online\.html$/,
    requiredHeadings: ["住民票の写し・住民票記載事項証明書をオンライン申請する"],
    summary: "横浜市で住民票の写しなどをオンライン申請する前に、利用できる方と必要なものを確認できます。",
    preparation: [
      "横浜市に住民登録があり、申請するのがご本人かを確認します。",
      "署名用電子証明書が有効なマイナンバーカードを用意します。",
      "電子署名で使う6〜16桁の英数字の暗証番号を確認します。4桁の暗証番号ではありません。",
      "手数料は1通300円に郵送料が加わります。支払い後、受け取りまでは1週間程度です。"
    ],
    fields: [],
    routes: [
      {
        label: "横浜市電子申請・届出システムを開く",
        officialUrl: `${YOKOHAMA_APPLICATION_ORIGIN}/cu/141003/ea/residents/portal/home`
      },
      {
        label: "オンライン申請のよくある質問を確認する",
        officialUrl:
          "https://www.city.yokohama.lg.jp/kurashi/koseki-zei-hoken/todokede/koseki-juminhyo/shoumei/shoumei-online.html"
      }
    ]
  },
  {
    id: "yokohama-application-portal-guide",
    reviewedAt: "2026-09-16",
    origin: YOKOHAMA_APPLICATION_ORIGIN,
    pathPattern: /^\/cu\/141003\/ea\/residents\/portal\/home$/,
    requiredHeadings: ["横浜市電子申請・届出システム"],
    summary: "横浜市の電子申請システムです。ログインや新規登録の前に、必要な手続きと準備を確認できます。",
    preparation: [
      "個人向けの手続きを選ぶときは、手続き一覧または手続き判定ナビを使えます。",
      "パソコンで電子署名をする場合は、電子署名拡張APとカードリーダーが必要です。",
      "ログイン情報、暗証番号、入力内容はSilver Guideが読み取ったり送信したりしません。"
    ],
    fields: [],
    routes: [
      {
        label: "動作環境を確認する",
        officialUrl: `${YOKOHAMA_APPLICATION_ORIGIN}/cu/141003/ea/residents/portal/requirement`
      },
      {
        label: "住民票のオンライン申請案内に戻る",
        officialUrl:
          "https://www.city.yokohama.lg.jp/kurashi/koseki-zei-hoken/todokede/koseki-juminhyo/shoumei/jyuminhyou/online.html"
      }
    ]
  }
];

export function guidePackFor(url: URL, evidence?: GuidePageEvidence): GuidePack | undefined {
  const pack = GUIDE_PACKS.find((candidate) => candidate.origin === url.origin && candidate.pathPattern.test(url.pathname));
  if (pack === undefined || evidence === undefined) {
    return undefined;
  }
  return pack.requiredHeadings.every((requiredHeading) =>
    evidence.headings.some((heading) => heading.includes(requiredHeading))
  )
    ? pack
    : undefined;
}
