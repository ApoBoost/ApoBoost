// 設定キーの一覧（#141）。
// これまで "auto_update" のような文字列がコードのあちこちに直接書かれていて、
// 1文字打ち間違えると「設定したのに効かない」が黙って起きる状態だった。
// キーと既定値はここだけに書き、読む側は必ずここを通す。
import { getSetting, setSetting } from "./db.js";

export const S = {
  autoUpdate: "auto_update",                 // 1=新しい版が出たら自動で更新
  updateChannel: "update_channel",           // stable | beta
  licenseKey: "license_key",
  licenseEnforce: "license_enforce",         // 1=未登録・期限切れを1日50件に制限
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
