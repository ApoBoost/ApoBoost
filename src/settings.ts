// 設定キーの一覧（#141）。
// これまで "auto_update" のような文字列がコードのあちこちに直接書かれていて、
// 1文字打ち間違えると「設定したのに効かない」が黙って起きる状態だった。
// キーと既定値はここだけに書き、読む側は必ずここを通す。
import { getSetting, setSetting } from "./db.js";

export const S = {
  autoUpdate: "auto_update",                 // 1=新しい版が出たら自動で更新
  updateChannel: "update_channel",           // stable | beta
  licenseKey: "license_key",
  licenseEnforce: "license_enforce",         // 以前の版の「制限する／しない」。いまは読まない（ライセンスは必須で、外せない）
  licenseTrialStart: "license_trial_start",  // お試し期間の始まり（この版を初めて起動した日時）
  termsAgreed: "terms_agreed",               // 同意した利用規約の版と日時・同意した人（例: "2026-10-05|2026-10-05 10:00|admin"）
  excludedIndustries: "excluded_industries", // 送りたくない業種・キーワード（改行区切り）
  notifyDesktop: "notify_desktop",           // 1=パソコンに通知を出す
  gameEnabled: "game_enabled",               // 1=おまけのゲームを表示
  effectsEnabled: "effects_enabled",         // 1=右下のキャラクターなどの演出を表示
  aiMonthlyLimit: "ai_monthly_limit_jpy",
  todoHideDays: "todo_hide_days",            // この日数たった要対応は「見送り」に回す
  dailySummary: "daily_summary",             // 1=1日の終わりにまとめを通知
  notifyReply: "notify_reply",               // 1=アポ・返信が来たらすぐ通知
  listPageSize: "list_page_size",            // 送信一覧の1ページの件数
  sendPace: "send_pace",                     // フォーム送信の間隔: slow(8〜15秒・既定) | normal(5〜9秒) | fast(3〜5秒)
  setupEmailSkipped: "setup_email_skipped",  // 1.0.14 だけが使った全員共通の「フォームだけで使う」。いまはユーザー別（setupEmailSkipKey）。管理者にだけ引き継ぐ
} as const;

export type SettingKey = (typeof S)[keyof typeof S];

/** 既定値。ここに無いキーは空文字が既定 */
const DEFAULTS: Partial<Record<SettingKey, string>> = {
  [S.autoUpdate]: "0",
  [S.updateChannel]: "stable",
  [S.licenseEnforce]: "0",
  [S.notifyDesktop]: "1",
  [S.gameEnabled]: "0",
  [S.effectsEnabled]: "0",
  [S.aiMonthlyLimit]: "0",
  [S.todoHideDays]: "30",
  [S.dailySummary]: "1",
  [S.notifyReply]: "1",
  [S.listPageSize]: "100",
  [S.sendPace]: "slow",
};

export function setting(key: SettingKey): string {
  return getSetting(key, DEFAULTS[key] ?? "");
}
export function settingOn(key: SettingKey): boolean {
  return setting(key) === "1";
}
export function settingNum(key: SettingKey, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const n = Number(setting(key));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : Number(DEFAULTS[key] ?? 0);
}
export function saveSettingValue(key: SettingKey, value: string | number | boolean): void {
  setSetting(key, typeof value === "boolean" ? (value ? "1" : "0") : String(value));
}

// ---- はじめの設定の「フォームだけで使う（メールの設定は飛ばす）」----
// ユーザーごとに持つ（法令確認の law_ack:<ID> と同じ作り）。全員共通だと、一般ユーザーが押しただけで
// 管理者や他のメンバーの「送信用メール」の手順まで済み扱いになっていた
export const setupEmailSkipKey = (userId: number) => `setup_email_skipped:${userId}`;

/** この人が「フォームだけで使う」を選んでいるか。
 *  まだ自分で選んでいない人は、1.0.14 で保存された全員共通の値を、管理者についてだけ引き継ぐ
 *  （1.0.14 で押したのは、ほとんどが初回設定をした管理者のため。一般ユーザーには引き継がない） */
export function setupEmailSkippedFor(user: { id: number; role: string }): boolean {
  const own = getSetting(setupEmailSkipKey(user.id), "");
  if (own) return own === "1";
  return user.role === "admin" && getSetting(S.setupEmailSkipped, "") === "1";
}

export function saveSetupEmailSkipped(userId: number, on: boolean): void {
  setSetting(setupEmailSkipKey(userId), on ? "1" : "0");
}
