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

export type GuidePack = {
  id: string;
  reviewedAt: string;
  origin: string;
  pathPattern: RegExp;
  fields: readonly GuideField[];
  routes: readonly GuideRoute[];
};

// 行政サイト固有の案内は、公開ページを確認してからここへ追加する。
// 初期実装には未確認の URL や推測した手続き案内を含めない。
export const GUIDE_PACKS: readonly GuidePack[] = [];

export function guidePackFor(url: URL): GuidePack | undefined {
  return GUIDE_PACKS.find((pack) => pack.origin === url.origin && pack.pathPattern.test(url.pathname));
}
