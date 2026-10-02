// 小さな部品の単体テスト（#140）。ブラウザも通信も使わないので数秒で終わる。
// 昨夜足した share / license / backup / jp / settings などは、これまで自動テストが無かった。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
process.env.FO_NO_NOTIFY = "1"; // テスト中は通知を出さない
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fo-unit-"));

const { jpError } = await import("../src/jp.js");
const { verifyLicense, signLicense, licenseStatus, setLicenseKey, cappedDailyLimit } = await import("../src/license.js");
const { sheetCsvUrl } = await import("../src/share.js");
const { urlVariants } = await import("../src/formFinder.js");
const { variantFor, subjectFor } = await import("../src/message.js");
const { phrasesFor, learnFromCorrection, classifyReply, clearReplyRulesCache } = await import("../src/replies.js");
const { S, setting, settingOn, saveSettingValue, settingNum } = await import("../src/settings.js");
const { TEMPLATE_LIBRARY } = await import("../src/templates.js");
const { createBackup, listBackups, requestRestore, pendingRestore, cancelRestore } = await import("../src/backup.js");
const { splitAddress } = await import("../src/formFiller.js");
const { excludedKeywords, matchExcludedKeyword } = await import("../src/csv.js");
const { logError, recentLogs } = await import("../src/applog.js");
const { getDb } = await import("../src/db.js");

let failed = 0;
function ok(name: string, cond: unknown, detail = "") {
  if (cond) return;
  failed++;
  console.error(`NG: ${name}${detail ? ` — ${detail}` : ""}`);
}
const eq = (name: string, a: unknown, b: unknown) => ok(name, JSON.stringify(a) === JSON.stringify(b), `得られた値 ${JSON.stringify(a)} / 期待 ${JSON.stringify(b)}`);

// ---- jp.ts: 英語エラーの日本語化 ----
ok("jp: DNSエラー", jpError(new Error("net::ERR_NAME_NOT_RESOLVED at https://x")).includes("サイトが見つかりません"));
ok("jp: タイムアウト", jpError("page.goto: Timeout 25000ms exceeded").includes("時間切れ"));
ok("jp: ポート使用中", jpError("listen EADDRINUSE: address already in use").includes("二重に起動"));
eq("jp: 日本語はそのまま", jpError("送信者が見つかりません"), "送信者が見つかりません");
eq("jp: 空は空", jpError(""), "");

// ---- settings.ts ----
eq("settings: 既定値", setting(S.updateChannel), "stable");
ok("settings: 通知は既定でオン", settingOn(S.notifyDesktop));
saveSettingValue(S.autoUpdate, true);
ok("settings: 保存して読める", settingOn(S.autoUpdate));
eq("settings: 数値の下限", (saveSettingValue(S.todoHideDays, "-5"), settingNum(S.todoHideDays, 1, 365)), 1);
saveSettingValue(S.todoHideDays, "30");

// ---- license.ts: 署名と検証（テスト用の鍵は本物と別なので「不正」になるのが正しい）----
{
  const { privateKey } = crypto.generateKeyPairSync("ed25519");
  const forged = signLicense({ to: "偽物", seats: 1, exp: "2099-01-01", issued: "2026-01-01", id: "x" }, privateKey.export({ type: "pkcs8", format: "pem" }).toString());
  ok("license: 別の鍵で作ったキーは通らない", verifyLicense(forged).ok === false);
  ok("license: 形が違うものは通らない", verifyLicense("hello").ok === false);
  eq("license: 未登録の状態", licenseStatus().state, "none");
  eq("license: 不正キーの状態", setLicenseKey(forged).state, "invalid");
  eq("license: 制限オフなら上限そのまま", cappedDailyLimit(300).limit, 300);
  saveSettingValue(S.licenseEnforce, true);
  eq("license: 制限オンで未登録なら50件", cappedDailyLimit(300).limit, 50);
  saveSettingValue(S.licenseEnforce, false);
  setLicenseKey("");
}

// ---- share.ts ----
eq("share: シートURL→CSV", sheetCsvUrl("https://docs.google.com/spreadsheets/d/abc123/edit#gid=42"), "https://docs.google.com/spreadsheets/d/abc123/export?format=csv&gid=42");
eq("share: シートでないURL", sheetCsvUrl("https://example.com/"), "");

// ---- formFinder.ts: URLの言い換え ----
{
  const v = urlVariants("https://example.co.jp/contact");
  ok("urlVariants: 4通り", v.length === 4, String(v.length));
  ok("urlVariants: www付き", v.includes("https://www.example.co.jp/contact"));
  ok("urlVariants: http", v.includes("http://example.co.jp/contact"));
  eq("urlVariants: 先頭は元のまま", v[0], "https://example.co.jp/contact");
}

// ---- message.ts: A/B と 件名ローテ ----
{
  const base = { subject_text: "件名A", subject_alts: "別案1\n別案2", subject_b: "件名B", template_b: "本文B", ab_enabled: 1 } as never;
  eq("A/B: 偶数はA", variantFor({ id: 10 }, base), "A");
  eq("A/B: 奇数はB", variantFor({ id: 11 }, base), "B");
  eq("A/B: オフなら常にA", variantFor({ id: 11 }, { ...(base as object), ab_enabled: 0 } as never), "A");
  eq("A/B: Bが空なら常にA", variantFor({ id: 11 }, { ...(base as object), template_b: " " } as never), "A");
  eq("件名: Bは件名B", subjectFor({ id: 11 }, base, "B"), "件名B");
  eq("件名: 3案を順番に(0)", subjectFor({ id: 3 }, base, "A"), "件名A");
  eq("件名: 3案を順番に(1)", subjectFor({ id: 4 }, base, "A"), "別案1");
  eq("件名: 3案を順番に(2)", subjectFor({ id: 5 }, base, "A"), "別案2");
}

// ---- replies.ts: 言い回しの学習 ----
{
  eq("phrases: あいさつは覚えない", phrasesFor("お世話になります。"), []);
  ok("phrases: 意味のある文を拾う", phrasesFor("お世話になります。弊社では現在導入の予定がございません。").length === 1);
  clearReplyRulesCache();
  const before = classifyReply("Re: ご案内", "担当に共有しましたので少々お待ちください").outcome;
  eq("学習前は「返信あり」", before, "replied");
  ok("学習: 1件以上覚える", learnFromCorrection("担当に共有しましたので少々お待ちください", "appointment", "テスト社") >= 1);
  eq("学習後は直した側に振り分ける", classifyReply("Re: ご案内", "担当に共有しましたので少々お待ちください。").outcome, "appointment");
}

// ---- templates.ts ----
ok("templates: 10種以上", TEMPLATE_LIBRARY.length >= 10);
ok("templates: IDが重複しない", new Set(TEMPLATE_LIBRARY.map((t) => t.id)).size === TEMPLATE_LIBRARY.length);
ok("templates: すべて会社名の差し込みと停止案内がある", TEMPLATE_LIBRARY.every((t) => t.body.includes("{{会社名}}") && /不要/.test(t.body)));
ok("templates: 知らない変数が無い", TEMPLATE_LIBRARY.every((t) => (t.body + t.subject).match(/\{\{[^}]+\}\}/g)!.every((v) => ["{{会社名}}", "{{代表者}}", "{{業種}}", "{{都道府県}}", "{{自社名}}", "{{担当者}}", "{{自社メール}}", "{{自社電話}}", "{{自社URL}}", "{{AI冒頭}}"].includes(v))));

// ---- backup.ts ----
{
  const b = await createBackup("manual");
  ok("backup: ファイルができる", listBackups().some((x) => x.file === b.file));
  ok("backup: 無いファイルは復元を予約できない", requestRestore("../../etc/passwd").ok === false);
  ok("backup: 予約できる", requestRestore(b.file).ok && pendingRestore() === b.file);
  cancelRestore();
  eq("backup: 取り消せる", pendingRestore(), "");
}

// ---- csv.ts: 除外キーワード ----
saveSettingValue(S.excludedIndustries, "病院\nクリニック、法律事務所");
eq("除外: 3語に分かれる", excludedKeywords(), ["病院", "クリニック", "法律事務所"]);
eq("除外: 会社名に一致", matchExcludedKeyword({ company_name: "さくらクリニック", industry: "", sub_industry: "" }), "クリニック");
eq("除外: 一致なし", matchExcludedKeyword({ company_name: "サンプル商事", industry: "製造", sub_industry: "" }), "");
saveSettingValue(S.excludedIndustries, "");

// ---- formFiller.ts: 住所の分割 ----
eq("住所: 4つに分かれる", splitAddress("東京都港区新橋4-5-1 アーバン新橋ビル3階"), { pref: "東京都", city: "港区", town: "新橋4-5-1", building: "アーバン新橋ビル3階" });

// ---- applog.ts ----
logError("test", "テスト用のエラー", "テスト社");
ok("applog: 書いて読める", recentLogs(5).some((r) => r.text === "テスト用のエラー" && r.company === "テスト社"));

// ---- db: インデックス ----
{
  const idx = (getDb().prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as { name: string }[]).map((r) => r.name);
  ok("db: 更新日時のインデックス", idx.includes("idx_form_jobs_updated"));
  ok("db: 反応のインデックス", idx.includes("idx_form_jobs_outcome"));
}

if (failed) { console.error(`\nunit: ${failed}件 失敗`); process.exit(1); }
console.log("unit: ALL OK");
