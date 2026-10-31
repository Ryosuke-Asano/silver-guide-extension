// @vitest-environment jsdom
import { expect, it } from "vitest";
import { DEMO_SITE_URL, isPublishedDemoForm } from "../../src/shared/demo-site";
import { libraryDemoAdapter } from "../../src/adapters/sites/library-demo";

it("limits simulated auto-completion to the exact published form and expected controls", () => {
  document.body.innerHTML = '<form id="registration-form"><button id="review-button">確認</button></form><button id="complete-button">完了</button><section id="complete-stage"></section>';
  const form = document.querySelector("form")!, button = document.querySelector("button")!;
  const matches = (href: string) => libraryDemoAdapter.matches({ form, button, document: { location: { href }, getElementById: document.getElementById.bind(document) } as unknown as Document });
  for (const url of [DEMO_SITE_URL, DEMO_SITE_URL + "index.html?source=demo"]) {
    expect(isPublishedDemoForm(url)).toBe(true); expect(matches(url)).toBe(true);
  }
  for (const url of ["https://other.example/silver-guide-extension/", DEMO_SITE_URL.replace("https:", "http:"), DEMO_SITE_URL.replace("silver-guide-extension/", "other-project/"), DEMO_SITE_URL + "guide.html", DEMO_SITE_URL + "sub/index.html"]) {
    expect(isPublishedDemoForm(url)).toBe(false); expect(matches(url)).toBe(false);
  }
  document.getElementById("complete-button")!.remove();
  expect(matches(DEMO_SITE_URL)).toBe(false);
});
