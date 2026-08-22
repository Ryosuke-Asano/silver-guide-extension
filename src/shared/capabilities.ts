/**
 * 支援開始後にポップアップへ返す、公開されているページ構造だけから得る情報。
 * 入力値・閲覧履歴・サイト内容の外部送信には使わない。
 */
export type PageCapabilities = {
  canInput: boolean;
  canProceed: boolean;
  canRead: true;
  hasVerifiedGuide: boolean;
};

export const BASIC_READING_CAPABILITIES: PageCapabilities = {
  canInput: false,
  canProceed: false,
  canRead: true,
  hasVerifiedGuide: false
};
