// ライセンス（#90）。他社に売るときの「どこまで・いつまで使えるか」の管理。
//
// 仕組み: 配布元の秘密鍵で署名したキーを発行し、アプリ側は公開鍵で検証する。
// キーの中身は「宛先の会社名・台数・有効期限」だけで、個人情報も通信も必要ない（オフラインで検証できる）。
//
// 正直に書いておくと: このアプリはソースコードごと配るため、ソースを書き換えれば検証は無効にできます。
// これは「期限と台数を管理し、うっかり期限切れのまま使われるのを防ぐ」ためのもので、強固なコピー防止ではありません。
// 既定では送信を止めません（license_enforce=1 のときだけ、未登録・期限切れで1日50件に制限します）。
import crypto from "node:crypto";
import { S } from "./settings.js";
import { getSetting, setSetting } from "./db.js";

/** 配布元の公開鍵（秘密鍵は license-keys/private.pem にあり、gitには入れない） */
const PUBLIC_KEY_B64 = "MCowBQYDK2VwAyEAudZdhFFCqndKn12HAolG0eQ4RMAZh2xNz8w7B3zpTp4=";

export type LicensePayload = {
  to: string;       // 宛先（会社名）
  seats: number;    // 使ってよい台数（目安。自動では数えない）
  exp: string;      // 有効期限 YYYY-MM-DD（空＝無期限）
  issued: string;   // 発行日
  id: string;       // 発行ID（控え用）
  note?: string;
};
export type LicenseState = "none" | "valid" | "expired" | "invalid";
export type LicenseStatus = { state: LicenseState; payload?: LicensePayload; label: string; daysLeft?: number };

const b64url = {
  enc: (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
  dec: (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64"),
};

/** キーを作る（配布元だけが使う。scripts/license.mjs から呼ぶ） */
export function signLicense(payload: LicensePayload, privatePem: string): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const key = crypto.createPrivateKey(privatePem);
  const sig = crypto.sign(null, body, key);
  return `APO1.${b64url.enc(body)}.${b64url.enc(sig)}`;
}

/** キーを検証する（配布先のアプリが使う） */
export function verifyLicense(keyText: string): { ok: boolean; payload?: LicensePayload } {
  try {
    const [magic, body64, sig64] = String(keyText ?? "").trim().split(".");
    if (magic !== "APO1" || !body64 || !sig64) return { ok: false };
    const body = b64url.dec(body64);
    const pub = crypto.createPublicKey({ key: Buffer.from(PUBLIC_KEY_B64, "base64"), format: "der", type: "spki" });
    if (!crypto.verify(null, body, pub, b64url.dec(sig64))) return { ok: false };
    return { ok: true, payload: JSON.parse(body.toString("utf8")) as LicensePayload };
  } catch {
    return { ok: false };
  }
}

export function licenseStatus(): LicenseStatus {
  const key = getSetting(S.licenseKey, "").trim();
  if (!key) return { state: "none", label: "ライセンス未登録（お試し利用）" };
  const v = verifyLicense(key);
  if (!v.ok || !v.payload) return { state: "invalid", label: "ライセンスキーが正しくありません（配布元にご確認ください）" };
  const p = v.payload;
  if (p.exp) {
    const end = Date.parse(`${p.exp}T23:59:59+09:00`);
    const daysLeft = Math.ceil((end - Date.now()) / 86400_000);
    if (daysLeft < 0) return { state: "expired", payload: p, label: `ライセンスの有効期限が切れています（${p.exp}まで・${p.to}）`, daysLeft };
    return { state: "valid", payload: p, daysLeft, label: `${p.to} 様（${p.seats}台まで・${p.exp}まで・あと${daysLeft}日）` };
  }
  return { state: "valid", payload: p, label: `${p.to} 様（${p.seats}台まで・期限なし）` };
}

export function setLicenseKey(key: string): LicenseStatus {
  setSetting(S.licenseKey, String(key ?? "").trim());
  return licenseStatus();
}

/** 制限をかけるか（既定はオフ＝止めない）。オンのときだけ、未登録・期限切れで1日50件までにする */
export function licenseEnforced(): boolean {
  return getSetting(S.licenseEnforce, "0") === "1";
}
export const TRIAL_DAILY_LIMIT = 50;

/** いまの1日の上限（ライセンスの状態を加味した値）。制限しない場合は設定値をそのまま返す */
export function cappedDailyLimit(configured: number): { limit: number; note: string } {
  if (!licenseEnforced()) return { limit: configured, note: "" };
  const st = licenseStatus();
  if (st.state === "valid") return { limit: configured, note: "" };
  return { limit: Math.min(configured, TRIAL_DAILY_LIMIT), note: `ライセンス未登録のため、1日 ${TRIAL_DAILY_LIMIT}件までに制限しています（${st.label}）` };
}
