import { describe, expect, it } from "vitest";
import { GLOSSARY } from "./glossary";

describe("GLOSSARY", () => {
  it("has unique local entries with a concise explanation", () => {
    expect(GLOSSARY.length).toBeGreaterThanOrEqual(20);
    expect(new Set(GLOSSARY.map((entry) => entry.id)).size).toBe(GLOSSARY.length);
    expect(GLOSSARY.every((entry) => entry.term.length > 0 && entry.plainExplanation.length > 0)).toBe(
      true
    );
  });
});
