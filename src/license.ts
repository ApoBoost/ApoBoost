// ライセンス（#90）。他社に売るときの「どこまで・いつまで使えるか」の管理。
//
// 仕組み: 配布元の秘密鍵で署名したキーを発行し、アプリ側は公開鍵で検証する。
// キーの中身は「宛先の会社名・台数・有効期限」だけで、個人情報も通信も必要ない（オフラインで検証できる）。
//
// 正直に書いておくと: ソースを書き換えれば検証は無効にできます。コピー防止の決め手は、利用規約（無断の複製・再配布・転売・
// 解析の禁止）と、画面に出る「使用を許諾した相手の名前」（流出元が分かる）の組み合わせです。
// ライセンスは必須: キーが無いと、お試し期間（初めて起動してから TRIAL_DAYS 日）が過ぎたら送信を止める。設定で外すことはできない。
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
  if (!key) { const d = trialDaysLeft(); return { state: "none", label: d > 0 ? `ライセンス未登録（お試し期間 あと${d}日）` : "ライセンス未登録（お試し期間は終了しました）" }; }
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

/** お試し期間の日数。キーが無くても、初めて起動してからこの日数は送れる */
export const TRIAL_DAYS = 14;

/** お試し期間の始まり。まだ無ければ「いま」を記録する（以前の版から上がったPCも、ここから数える） */
export function trialStart(): number {
  const raw = getSetting(S.licenseTrialStart, "");
  const t = Date.parse(raw);
  if (raw && Number.isFinite(t)) return t;
  const now = new Date();
  setSetting(S.licenseTrialStart, now.toISOString());
  return now.getTime();
}
/** お試し期間の残り日数（0 以下なら終わっている） */
export function trialDaysLeft(): number {
  return Math.ceil((trialStart() + TRIAL_DAYS * 86400_000 - Date.now()) / 86400_000);
}

/** いま送信できない理由（ライセンスの面で）。送れるなら null */
export function licenseBlock(): string | null {
  const st = licenseStatus();
  if (st.state === "valid") return null;
  if (st.state === "none" && trialDaysLeft() > 0) return null;
  if (st.state === "expired") return `ライセンスの有効期限が切れているため、送信を止めています（${st.payload?.exp ?? ""}まで）。配布元から新しいキーを受け取り、設定 → ライセンスに登録してください`;
  if (st.state === "invalid") return "ライセンスキーが正しくないため、送信を止めています。配布元から受け取ったキーを、設定 → ライセンスに貼り直してください";
  return `お試し期間（${TRIAL_DAYS}日）が終わったため、送信を止めています。配布元から受け取ったライセンスキーを、設定 → ライセンスに登録してください`;
}

/** 画面の下に出す「使用を許諾した相手」。流出したコピーでも、元の購入者の名前が出る */
export function licenseeLine(): string {
  const st = licenseStatus();
  if (st.state === "valid" && st.payload) return `${st.payload.to} 様に使用を許諾しています（ライセンス ${st.payload.id}）`;
  if (st.state === "none") { const d = trialDaysLeft(); return d > 0 ? `お試し期間中（あと${d}日）` : "ライセンス未登録（お試し期間は終了しました）"; }
  return st.label;
}

/** 以前の版の「制限する／しない」の名残。いまは常に必須 */
export function licenseEnforced(): boolean {
  return true;
}
/** 以前の版の名残（1日50件の制限）。いまは使わない */
export const TRIAL_DAILY_LIMIT = 50;

/** いまの1日の上限（ライセンスの状態を加味した値）。送れないときは 0 */
export function cappedDailyLimit(configured: number): { limit: number; note: string } {
  const why = licenseBlock();
  if (!why) return { limit: configured, note: "" };
  return { limit: 0, note: why };
}
