export type GlossaryEntry = {
  id: string;
  term: string;
  plainLabel: string;
  plainExplanation: string;
};

function entry(
  id: string,
  term: string,
  plainLabel: string,
  plainExplanation: string
): GlossaryEntry {
  return { id, term, plainLabel, plainExplanation };
}

export const GLOSSARY: readonly GlossaryEntry[] = [
  entry("eligibility", "支給要件", "受け取るための条件", "給付金などを受け取るために、満たす必要がある条件です。"),
  entry("application", "申請", "利用したいことを伝える手続き", "制度やサービスを利用したいと、決められた方法で伝えることです。"),
  entry("eligible-person", "対象者", "利用できる人", "その制度やサービスを利用できる条件に当てはまる人です。"),
  entry("required", "必要書類", "手続きで出す書類", "申請や確認のために、用意して出す必要がある書類です。"),
  entry("household", "世帯", "同じ家で生活する人のまとまり", "住民票で使う、同じ住所で生活する人のまとまりです。"),
  entry("head-household", "世帯主", "世帯の代表として登録された人", "住民票で、その世帯の代表として登録されている人です。"),
  entry("resident-record", "住民票", "住所などを証明する書類", "住んでいる場所や世帯の情報を証明する、自治体の記録や証明書です。"),
  entry("identity", "本人確認", "本人かどうか確かめること", "手続きをする人が、本当にその本人かどうかを確かめることです。"),
  entry("proxy", "代理人", "本人の代わりに手続きする人", "本人から頼まれて、本人の代わりに手続きをする人です。"),
  entry("power", "委任状", "代わりに手続きしてよいという書類", "本人が、ほかの人に手続きを頼んだことを示す書類です。"),
  entry("certificate", "証明書", "事実を証明する書類", "住所や収入などの事実を、役所などが証明する書類です。"),
  entry("deadline", "期限", "しなければならない最終の日", "申請や提出を終えなければならない、最後の日です。"),
  entry("fee", "手数料", "手続きにかかるお金", "証明書を出してもらうときなどに、役所へ支払うお金です。"),
  entry("reduction", "減免", "料金を少なくする、または払わなくてよくすること", "条件に合う人の料金を減らしたり、払わなくてよくしたりすることです。"),
  entry("tax", "住民税", "住んでいる自治体に納める税金", "住んでいる都道府県や市区町村に納める税金です。"),
  entry("income", "所得", "収入から必要な費用を引いた金額", "収入から、仕事などに必要だった費用を引いた後の金額です。"),
  entry("pension", "年金", "老後などの生活を支える制度", "年を取ったときや、障害・遺族になったときの生活を支える制度です。"),
  entry("care", "介護保険", "介護サービスを使うための制度", "介護が必要になったときに、サービスを利用しやすくするための保険制度です。"),
  entry("notification", "通知", "役所からの知らせ", "役所が、手続きの結果や大切な情報を知らせることです。"),
  entry("decision", "決定", "役所が内容を決めること", "申請の結果などについて、役所が正式に内容を決めることです。")
];
