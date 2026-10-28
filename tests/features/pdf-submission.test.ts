// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://service.example/apply"}
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sameSubmissionPlan, submissionPlan, submitAttachedPdf } from "../../src/features/pdf/submission";

const field = () => document.getElementById("attachment") as HTMLInputElement;
beforeEach(() => { document.body.innerHTML = '<form action="/send"><input id="attachment" type="file" accept=".pdf"><input id="name" required><button type="submit">申請を送信</button></form>'; });

describe("site submission boundary", () => {
  it("keeps generic forms on attachment-only unless submission was chosen", async () => {
    const plan = submissionPlan(field())!;
    expect(plan.defaultSubmit).toBe(false); expect(plan.label).toBe("申請を送信");
    const submit = vi.fn(); plan.form.addEventListener("submit", submit);
    expect((await submitAttachedPdf(field(), plan, false, () => true)).status).toBe("attached"); expect(submit).not.toHaveBeenCalled();
  });
  it("preserves the native validation and submitter without claiming server acceptance", async () => {
    const plan = submissionPlan(field())!, submit = vi.fn((event: SubmitEvent) => event.preventDefault());
    plan.form.addEventListener("submit", submit);
    expect((await submitAttachedPdf(field(), plan, true, () => true)).status).toBe("needs-input"); expect(submit).not.toHaveBeenCalled();
    (document.getElementById("name") as HTMLInputElement).value = "見本";
    expect((await submitAttachedPdf(field(), plan, true, () => true)).status).toBe("submission-requested");
    expect(submit).toHaveBeenCalledTimes(1); expect(submit.mock.calls[0][0].submitter).toBe(plan.button);
  });
  it("rejects changed actions and ambiguous submit buttons", async () => {
    const plan = submissionPlan(field());
    document.querySelector("form")!.action = "https://other.example/send";
    expect(sameSubmissionPlan(plan, field())).toBe(false);
    await expect(submitAttachedPdf(field(), plan, true, () => true)).rejects.toThrow("変わりました");
    document.querySelector("form")!.insertAdjacentHTML("beforeend", '<button type="submit">別の手続</button>');
    expect(submissionPlan(field())).toBeNull();
  });
  it("does not enable the local demo adapter merely because public element IDs match", () => {
    document.querySelector("form")!.id = "registration-form"; document.querySelector("button")!.id = "review-button";
    document.body.insertAdjacentHTML("beforeend", '<button id="complete-button">完了</button><div id="complete-stage"></div>');
    expect(submissionPlan(field())!.adapter).toBeNull(); expect(submissionPlan(field())!.defaultSubmit).toBe(false);
  });
});
