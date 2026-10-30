// This page is a local form mock. Values stay in memory and are never submitted.
import { initializeMeasurement } from "./measurement.js";
import { isBundledDemo } from "./bundled.js";
const KANA = /^[ァ-ヶーA-Za-zＡ-Ｚａ-ｚ\s　]+$/;
const DIGITS = /^[0-9]+$/;
const LOCAL_ADDRESSES = new Map([
  ["2200032", "西区老松町"],
  ["2310005", "中区本町"],
  ["2220033", "港北区新横浜"]
]);

const text = value => String(value ?? "");
const nonempty = value => text(value).trim().length > 0;
const MAX_PDF_BYTES = 20 * 1024 * 1024;

const readableFileSize = bytes => bytes < 1024 * 1024
  ? `${Math.max(1, Math.ceil(bytes / 1024))} KB`
  : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

const readBlob = (blob, Reader) => {
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer();
  if (typeof Reader !== "function") return Promise.reject(new Error("File reading is unavailable"));
  return new Promise((resolve, reject) => {
    const reader = new Reader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error ?? new Error("File reading failed"));
    reader.onabort = () => reject(new Error("File reading was cancelled"));
    reader.readAsArrayBuffer(blob);
  });
};

/** Check the attachment locally without parsing or transmitting its contents. */
export async function validatePdfAttachment(file, { FileReader: Reader = globalThis.FileReader } = {}) {
  if (!file || !Number.isFinite(file.size) || typeof file.slice !== "function") {
    return { valid: false, error: "PDFファイルを選んでください。" };
  }
  if (file.size > MAX_PDF_BYTES) return { valid: false, error: "PDFは20MB以内のファイルを選んでください。" };
  if (file.size < 12) return { valid: false, error: "PDFの形式を確認できません。PDFファイルを選び直してください。" };
  try {
    const [headBuffer, tailBuffer] = await Promise.all([
      readBlob(file.slice(0, 1024), Reader),
      readBlob(file.slice(Math.max(0, file.size - 2048)), Reader)
    ]);
    const decoder = new TextDecoder("latin1");
    const head = decoder.decode(headBuffer);
    const tail = decoder.decode(tailBuffer);
    if (!/^%PDF-(?:1\.[0-9]|2\.0)(?:[\r\n\s]|$)/.test(head) || !/%%EOF[\x00\t\n\f\r ]*$/.test(tail)) {
      return { valid: false, error: "PDFの形式を確認できません。PDFファイルを選び直してください。" };
    }
    return { valid: true, file, name: text(file.name), size: file.size, sizeLabel: readableFileSize(file.size) };
  } catch {
    return { valid: false, error: "ファイルを読み込めませんでした。PDFを選び直してください。" };
  }
}

/** Validate at confirmation time; never rewrite a value during Japanese input. */
export function validateRegistration(data, today = new Date()) {
  const issues = [];
  const issue = (ids, message) => issues.push({ ids: Array.isArray(ids) ? ids : [ids], message });
  const required = (id, label) => {
    if (!nonempty(data[id])) issue(id, `${label}を入力してください。`);
  };
  const postcode = (prefix, label) => {
    const ids = [`${prefix}-first`, `${prefix}-last`];
    if (!/^[0-9]{3}$/.test(text(data[ids[0]])) || !/^[0-9]{4}$/.test(text(data[ids[1]]))) {
      issue(ids, `${label}は半角数字で、前の欄に3桁、後の欄に4桁を入力してください。`);
    }
  };
  const phone = (prefix, label) => {
    const ids = [`${prefix}-first`, `${prefix}-middle`, `${prefix}-last`];
    const [first, middle, last] = ids.map(id => text(data[id]));
    if (!middle || !last) issue(ids, `${label}の後ろの2つの欄を入力してください。`);
    else if ([first, middle, last].some(value => value && (!DIGITS.test(value) || value.length > 4))) {
      issue(ids, `${label}は各欄4桁以内の半角数字で入力してください。`);
    } else if (middle.length + last.length < 7) {
      issue(ids, `${label}の後ろの2つの欄は、合わせて7桁以上で入力してください。`);
    }
  };

  if (!["resident", "work", "student", "regional"].includes(data.registrationType)) {
    issue("registration-type", "当てはまる登録条件を選んでください。");
  }
  required("full-name", "名前");
  if (text(data["full-name"]).length > 512) issue("full-name", "名前は512文字以内で入力してください。");
  required("name-kana", "名前カタカナ");
  if (nonempty(data["name-kana"]) && !KANA.test(text(data["name-kana"]))) {
    issue("name-kana", "名前カタカナはカタカナで入力してください。");
  }
  if (text(data["name-kana"]).length > 512) issue("name-kana", "名前カタカナは512文字以内で入力してください。");

  const birthIds = ["birth-year", "birth-month", "birth-day"];
  const [year, month, day] = birthIds.map(id => Number(data[id]));
  const birth = new Date(year, month - 1, day);
  const current = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (!/^[0-9]{4}$/.test(text(data["birth-year"])) || year < 1868 ||
      !Number.isInteger(month) || !Number.isInteger(day) ||
      birth.getFullYear() !== year || birth.getMonth() !== month - 1 || birth.getDate() !== day) {
    issue(birthIds, "生年月日は、存在する日付を西暦・半角数字で入力してください。");
  } else if (birth > current) issue(birthIds, "生年月日が未来日です。");

  postcode("zip", "郵便番号");
  required("address", "住所");
  phone("phone", "電話番号");
  if (["work", "student"].includes(data.registrationType)) {
    required("work-name", "在勤・在学先名称");
    postcode("work-zip", "在勤・在学先郵便番号");
    required("work-address", "在勤・在学先住所");
    phone("work-phone", "在勤・在学先電話番号");
  }
  if (data.registrationType !== "regional" && data["contact-method"] === "email" && !nonempty(data.email)) {
    issue("email", "予約連絡方法で「メール」を選んだ場合は、E-mailを入力してください。");
  }
  if (nonempty(data.email) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text(data.email))) {
    issue("email", "E-mailは半角のメールアドレスで入力してください。");
  }
  return issues;
}

export function lookupLocalAddress(first, last) {
  return LOCAL_ADDRESSES.get(`${text(first)}${text(last)}`) ?? null;
}

export function initializeMock(doc = document) {
  const form = doc.getElementById("registration-form");
  if (!form) return;
  const measurement = initializeMeasurement(doc, () => form.reset());
  const get = id => doc.getElementById(id);
  const status = get("mock-status");
  const summary = get("form-errors");
  const errorList = get("errors-list");
  const stages = { entry: get("input-stage"), review: get("review-stage"), complete: get("complete-stage") };
  const errorDescriptions = new Map();
  const upload = get("pdf-upload");
  const uploadStatus = get("pdf-upload-status");
  const clearUpload = get("pdf-upload-clear");
  let attachment = null;
  let attachmentState = "empty";
  let attachmentError = "";
  let attachmentVersion = 0;
  let shownIssues = [];
  const uploadError = upload ? doc.createElement("p") : null;
  if (uploadError) {
    uploadError.id = "pdf-upload-error";
    uploadError.className = "yk-field-error";
    uploadError.hidden = true;
    (upload.closest(".yk-cell") ?? upload.parentElement).append(uploadError);
  }
  const announce = message => { if (status) status.textContent = message; };
  const registrationType = () => form.querySelector('input[name="registrationType"]:checked')?.value ?? "";

  const collect = () => {
    const result = { registrationType: registrationType() };
    for (const field of form.querySelectorAll("#input-stage input[id], #input-stage select[id], #input-stage textarea[id]")) {
      if (field.type !== "file") result[field.id] = field.value;
    }
    return result;
  };

  const renderAttachment = () => {
    if (!upload) return;
    const invalid = attachmentState === "invalid";
    upload.setAttribute("aria-busy", String(attachmentState === "pending"));
    if (invalid) upload.setAttribute("aria-invalid", "true");
    else upload.removeAttribute("aria-invalid");
    const descriptions = new Set((upload.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean));
    if (invalid) descriptions.add("pdf-upload-error");
    else descriptions.delete("pdf-upload-error");
    if (descriptions.size) upload.setAttribute("aria-describedby", [...descriptions].join(" "));
    else upload.removeAttribute("aria-describedby");
    if (uploadError) { uploadError.hidden = !invalid; uploadError.textContent = invalid ? attachmentError : ""; }
    if (clearUpload) { clearUpload.hidden = attachmentState === "empty"; clearUpload.disabled = attachmentState === "empty"; }
    if (uploadStatus) {
      uploadStatus.textContent = attachmentState === "pending" ? "PDFの形式を確認しています。"
        : attachmentState === "ready" ? `${attachment.name}（${attachment.sizeLabel}）を添付しました。内容は送信されません。`
          : invalid ? "PDFを選び直すか、添付を取り消してください。"
            : isBundledDemo ? "PDFは選択されていません。本番の計測では記入済みPDFを添付してください。" : "PDFは選択されていません。添付は任意です。";
    }
  };

  const attachmentIssue = () => attachmentState === "pending"
    ? { ids: ["pdf-upload"], message: "PDFの形式を確認しています。確認が終わってから進んでください。" }
    : attachmentState === "invalid" ? { ids: ["pdf-upload"], message: attachmentError }
      : attachmentState === "empty" && isBundledDemo && doc.documentElement.hasAttribute("data-silver-guide-measure")
        ? { ids: ["pdf-upload"], message: "比較の計測にはPDFが必要です。このフォームから原本を開き、記入済みPDFを添付してください。" } : null;

  const clearErrors = () => {
    for (const [field, errorIds] of errorDescriptions) {
      field.removeAttribute("aria-invalid");
      const descriptions = (field.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(id => id && !errorIds.has(id));
      if (descriptions.length) field.setAttribute("aria-describedby", descriptions.join(" "));
      else field.removeAttribute("aria-describedby");
    }
    errorDescriptions.clear();
    form.querySelectorAll("[data-mock-field-error]").forEach(element => element.remove());
    errorList?.replaceChildren();
    if (summary) summary.hidden = true;
    shownIssues = [];
    renderAttachment();
  };

  const showErrors = (issues, focus = true) => {
    clearErrors();
    shownIssues = issues;
    issues.forEach(({ ids, message }, index) => {
      const fields = ids.map(get).filter(Boolean);
      const target = fields[0];
      if (!target) return;
      const errorId = `mock-error-${index}`;
      const error = doc.createElement("p");
      error.className = "yk-field-error";
      error.id = errorId;
      error.dataset.mockFieldError = "";
      error.textContent = message;
      (target.closest(".yk-cell") ?? target.parentElement).append(error);
      fields.forEach(field => {
        field.setAttribute("aria-invalid", "true");
        const descriptions = new Set((field.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean));
        descriptions.add(errorId);
        field.setAttribute("aria-describedby", [...descriptions].join(" "));
        if (!errorDescriptions.has(field)) errorDescriptions.set(field, new Set());
        errorDescriptions.get(field).add(errorId);
      });
      const item = doc.createElement("li");
      const link = doc.createElement("a");
      link.href = `#${target.id}`;
      link.textContent = message;
      link.addEventListener("click", event => {
        event.preventDefault();
        (target.matches("fieldset") ? target.querySelector("input") : target)?.focus();
      });
      item.append(link);
      errorList?.append(item);
    });
    if (summary) { summary.hidden = false; if (focus) summary.focus(); }
    announce(`${issues.length}件の入力内容を確認してください。`);
  };

  const refreshAttachmentErrors = () => {
    const remaining = shownIssues.filter(issue => !issue.ids.includes("pdf-upload"));
    const hadAttachmentIssue = remaining.length !== shownIssues.length;
    if (!hadAttachmentIssue) { renderAttachment(); return; }
    const issue = attachmentIssue();
    if (issue) remaining.push(issue);
    if (remaining.length) showErrors(remaining, false);
    else clearErrors();
    renderAttachment();
  };

  const clearAttachment = () => {
    measurement.cleared();
    attachmentVersion++;
    attachment = null;
    attachmentState = "empty";
    attachmentError = "";
    if (upload) upload.value = "";
    refreshAttachmentErrors();
  };

  upload?.addEventListener("change", async () => {
    const file = upload.files?.[0];
    if (!file) { clearAttachment(); return; }
    const version = ++attachmentVersion;
    attachment = null;
    attachmentState = "pending";
    attachmentError = "";
    refreshAttachmentErrors();
    const result = await validatePdfAttachment(file, { FileReader: doc.defaultView?.FileReader });
    if (version !== attachmentVersion) return;
    if (result.valid) {
      attachment = result;
      attachmentState = "ready";
      measurement.attached();
    } else {
      attachmentState = "invalid";
      measurement.cleared();
      attachmentError = result.error;
      // Clearing permits the same file to trigger change after it is repaired.
      upload.value = "";
    }
    refreshAttachmentErrors();
  });
  clearUpload?.addEventListener("click", () => {
    clearAttachment();
    upload?.focus();
  });

  const setStage = stage => {
    for (const [name, element] of Object.entries(stages)) if (element) element.hidden = name !== stage;
    doc.querySelectorAll("#steps [data-step]").forEach(element => {
      const current = element.dataset.step === stage;
      element.classList.toggle("is-current", current);
      if (current) element.setAttribute("aria-current", "step");
      else element.removeAttribute("aria-current");
    });
    if (stage !== "entry") stages[stage]?.querySelector("h2")?.focus();
  };

  const updateConditions = () => {
    const type = registrationType();
    const work = ["work", "student"].includes(type);
    const workFields = get("work-fields");
    if (workFields) {
      workFields.hidden = !work;
      workFields.querySelectorAll("input, select, button, textarea").forEach(field => { field.disabled = !work; });
    }
    form.querySelectorAll(".reservation-row").forEach(row => {
      row.hidden = type === "regional";
      row.querySelectorAll("input, select, button, textarea").forEach(field => { field.disabled = type === "regional"; });
    });
    if (get("email")) get("email").required = type !== "regional" && get("contact-method")?.value === "email";
  };

  const combinedPhone = (data, prefix) => [data[`${prefix}-first`], data[`${prefix}-middle`], data[`${prefix}-last`]].filter(Boolean).join("-");
  const buildReview = data => {
    const types = { resident: "在住：横浜市に住んでいる方", work: "在勤：横浜市に通勤している方", student: "在学：横浜市に通学している方", regional: "広域利用" };
    const rows = [
      ["登録条件", types[data.registrationType]],
      ["名前", data["full-name"]],
      ["名前カタカナ", data["name-kana"]],
      ["生年月日", `${data["birth-year"]}年${Number(data["birth-month"])}月${Number(data["birth-day"])}日`],
      ["郵便番号", `${data["zip-first"]}-${data["zip-last"]}`],
      ["住所", data.address],
      ["電話番号", combinedPhone(data, "phone")]
    ];
    if (["work", "student"].includes(data.registrationType)) rows.push(
      ["在勤・在学先名称", data["work-name"]],
      ["在勤・在学先郵便番号", `${data["work-zip-first"]}-${data["work-zip-last"]}`],
      ["在勤・在学先住所", data["work-address"]],
      ["在勤・在学先電話番号", combinedPhone(data, "work-phone")]
    );
    if (data.registrationType !== "regional") rows.push(
      ["予約受取館", get("branch")?.selectedOptions[0]?.textContent ?? ""],
      ["予約連絡方法", data["contact-method"] === "email" ? "メール" : "連絡不要"]
    );
    if (nonempty(data.email)) rows.push(["E-mail", data.email]);
    rows.push(["記入済みPDF", attachment ? `${attachment.name}（${attachment.sizeLabel}）` : "添付なし"]);
    const list = get("review-values");
    list.replaceChildren();
    for (const [label, value] of rows) {
      const term = doc.createElement("dt");
      const description = doc.createElement("dd");
      term.textContent = label;
      description.textContent = value;
      list.append(term, description);
    }
  };

  const lookup = (prefix, targetId) => {
    const result = lookupLocalAddress(get(`${prefix}-first`)?.value, get(`${prefix}-last`)?.value);
    if (!result) {
      announce("このモックの住所検索は、220-0032・231-0005・222-0033で試せます。ほかの住所は直接入力してください。");
      return;
    }
    const target = get(targetId);
    target.value = result;
    target.dispatchEvent(new doc.defaultView.Event("input", { bubbles: true }));
    target.focus();
    announce("住所の町名までを入力しました。番地・建物名を続けて入力してください。");
  };

  form.noValidate = true;
  form.addEventListener("submit", event => {
    event.preventDefault();
    const data = collect();
    const issues = validateRegistration(data);
    const pdfIssue = attachmentIssue();
    if (pdfIssue) issues.push(pdfIssue);
    if (issues.length) { measurement.validationFailure(); showErrors(issues); return; }
    clearErrors();
    buildReview(data);
    setStage("review");
    announce("入力内容を確認できます。内容は送信されていません。");
  });
  form.addEventListener("change", event => {
    if (event.target.name === "registrationType" || event.target.id === "contact-method") {
      updateConditions();
      clearErrors();
    }
  });
  form.addEventListener("reset", () => {
    measurement.reset();
    clearAttachment();
    clearErrors();
    get("review-values")?.replaceChildren();
    setStage("entry");
    // A reset event precedes the browser's native reset of individual fields.
    queueMicrotask(() => {
      updateConditions();
      get("full-name")?.focus();
      announce("入力内容をクリアしました。はじめから試せます。");
    });
  });
  get("lookup-address")?.addEventListener("click", () => lookup("zip", "address"));
  get("lookup-work-address")?.addEventListener("click", () => lookup("work-zip", "work-address"));
  get("edit-button")?.addEventListener("click", () => {
    setStage("entry");
    get("full-name")?.focus();
    announce("入力内容を保持して、記入欄へ戻りました。");
  });
  get("complete-button")?.addEventListener("click", () => {
    setStage("complete");
    measurement.complete();
    announce("模擬の登録を完了しました。横浜市への申請・送信は行っていません。");
  });
  get("start-again")?.addEventListener("click", () => form.reset());
  updateConditions();
  renderAttachment();
}

if (typeof document !== "undefined") initializeMock(document);
