import { describe, expect, it } from "vitest";
import { guidePackFor } from "./guide-packs";

const residentRecordGuideUrl = new URL(
  "https://www.city.yokohama.lg.jp/kurashi/koseki-zei-hoken/todokede/koseki-juminhyo/shoumei/jyuminhyou/online.html"
);

describe("guidePackFor", () => {
  it("enables the verified Yokohama resident-record guide only when its public heading still matches", () => {
    const pack = guidePackFor(residentRecordGuideUrl, {
      headings: ["住民票の写し・住民票記載事項証明書をオンライン申請する"]
    });

    expect(pack?.id).toBe("yokohama-resident-record-online-guide");
    expect(pack?.routes.map((route) => route.officialUrl)).toContain(
      "https://shinsei.city.yokohama.lg.jp/cu/141003/ea/residents/portal/home"
    );
  });

  it("falls back to general assistance when the verified page changes", () => {
    expect(guidePackFor(residentRecordGuideUrl, { headings: ["別のページ"] })).toBeUndefined();
  });

  it("does not enable a Yokohama guide from a different origin", () => {
    const copiedUrl = new URL(
      "https://example.test/kurashi/koseki-zei-hoken/todokede/koseki-juminhyo/shoumei/jyuminhyou/online.html"
    );

    expect(
      guidePackFor(copiedUrl, { headings: ["住民票の写し・住民票記載事項証明書をオンライン申請する"] })
    ).toBeUndefined();
  });
});
