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
const { splitAddress, classify } = await import("../src/formFiller.js");
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

// ---- formFiller.ts: 項目の種類判定 ----
const fi = (sig: string, type = "text") => ({ idx: 0, tag: "input", type, name: "", id: "", sig, required: false, options: [], checked: false, formIndex: 0, maxlength: 0, placeholder: "", inputmode: "", pattern: "", glabel: "" } as unknown as Parameters<typeof classify>[0]);
eq("classify: type=tel の郵便番号は郵便番号", classify(fi("例）1234567 | 郵便番号 | zip || 郵便番号 住所", "tel")), "postal");
eq("classify: type=tel のFAXは入れない", classify(fi("FAX | fax || FAX番号", "tel")), "ignore");
eq("classify: type=tel の電話は電話", classify(fi("例) 042-643-6261 | telephone-number || 電話番号", "tel")), "tel");

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

// ---- CSV・画面まわり（取り込み・ドメイン・お知らせ・数値・権限）----
{
  const { domainOf } = await import("../src/db.js");
  const { parseCompanyCsv, parseCompanyXlsx, headerReport, normHeader, xlsxText, detectDelimiter, parseSuppressionText, importRowsToCampaign } = await import("../src/csv.js");
  const ctx = await import("../src/app/context.js");
  const { resultNote } = await import("../src/ui/parts.js");

  // domainOf: 再送禁止・除外・重複判定の鍵なので、正しいURLの結果は直す前と同じであること（直す前の値で固定）
  const same: [string, string][] = [
    ["example.co.jp", "example.co.jp"],
    ["https://www.Example.co.jp/contact", "example.co.jp"],
    ["http://example.co.jp/", "example.co.jp"],
    ["example.co.jp/contact?x=1", "example.co.jp"],
    ["https://example.co.jp:8443/x", "example.co.jp"],
    ["www.example.com", "example.com"],
    ["https://sub.example.co.jp/form#top", "sub.example.co.jp"],
    ["日本語.jp", "xn--wgv71a119e.jp"],
    ["https://日本語.jp/", "xn--wgv71a119e.jp"],
    ["http://127.0.0.1:8080/x", "127.0.0.1"],
    ["http://localhost:3999/a", "localhost"],
    ["http://e3.localhost:3999/a", "e3.localhost"],
    ["a@b.co.jp", "b.co.jp"],
    ["", ""],
    ["httpexample.com", ""],
  ];
  for (const [u, d] of same) eq(`domainOf: ${u || "(空)"}`, domainOf(u), d);
  // URL欄に入りがちな「URLではない文字」はドメインにしない（以前は xn--68jub や - になっていた）
  for (const junk of ["なし", "-", "不明", "ー", "n/a", "TBD", "株式会社テスト", "　", "ftp://x.com"]) eq(`domainOf: 「${junk}」はドメインにしない`, domainOf(junk), "");
  eq("domainOf: 前後の空白は無視", domainOf(" https://example.com "), "example.com");

  // 見出しの正規化と別名
  eq("見出し: 全角・空白・括弧を除く", normHeader("ＨＰ　ＵＲＬ（任意）"), "hpurl");
  eq("見出し: メールアドレス（代表）", normHeader("メールアドレス（代表）"), "メールアドレス");
  ok("見出し: 読み仮名の列は別扱い", normHeader("会社名（カナ）") !== "会社名");
  const rep = (hs: string[]) => Object.fromEntries(headerReport(hs).used.map((u) => [u.field, u.header]));
  eq("見出し: よくある書き方を読める", rep(["法人名", "ホームページURL", "メールアドレス（代表）", "業種", "所在地"]), { 企業名: "法人名", 企業URL: "ホームページURL", メール: "メールアドレス（代表）", 業種: "業種" });
  eq("見出し: HP URL / Webサイト / 会社HP / サイトURL", ["HP URL", "Webサイト", "会社HP", "サイトURL"].map((h) => rep(["会社名", h])["企業URL"]), ["HP URL", "Webサイト", "会社HP", "サイトURL"]);
  eq("見出し: 担当者メールを会社URLやメールと取り違えない", rep(["会社名", "担当者メール", "画像URL"]), { 企業名: "会社名" });
  eq("見出し: 会社名（カナ）が先にあっても会社名を使う", rep(["会社名（カナ）", "会社名", "URL"]), { 企業名: "会社名", 企業URL: "URL" });
  eq("見出し: 使わなかった見出しを返す", headerReport(["会社名", "URL", "担当者", "備考"]).unused, ["担当者", "備考"]);

  // 区切り・引用符
  eq("区切り: セミコロン", detectDelimiter("会社名;URL;メール"), ";");
  eq("区切り: タブ", detectDelimiter("会社名\tURL"), "\t");
  eq("区切り: カンマ", detectDelimiter("会社名,URL;備考"), ",");
  {
    const r = parseCompanyCsv("会社名;ホームページURL;メールアドレス\n株式会社A;https://a.example.jp/;info@a.example.jp\n");
    eq("CSV: セミコロン区切りを読める", [r.length, r[0]?.company_name, r[0]?.site_url, r[0]?.email], [1, "株式会社A", "https://a.example.jp/", "info@a.example.jp"]);
    eq("CSV: 見出しを持ち回る", r.headers, ["会社名", "ホームページURL", "メールアドレス"]);
    const q = parseCompanyCsv('企業名,企業URL\n株式会社"B"商事,https://b.example.jp/\n');
    eq("CSV: セルの途中の \" で止まらない", q[0]?.company_name, '株式会社"B"商事');
    let msg = "";
    try { parseCompanyCsv('企業名,企業URL\n"株式会社C,https://c.example.jp/\n'); } catch (e) { msg = String((e as Error).message); }
    ok("CSV: 読めないときは日本語で行と直し方を出す", /行目/.test(msg) && /ダブルクォーテーション/.test(msg) && !/Quote/.test(msg), msg);
    ok("jp: CSVの英語エラーを日本語に", jpError("Invalid Opening Quote: a quote is found on field 0 at line 2").includes("ダブルクォーテーション"));
    ok("jp: 壊れたExcelを英語のまま出さない", jpError("ADM-ZIP: Invalid or unsupported zip format. No END header found").includes("Excelファイル"));
    ok("jp: 不正なURLを「ブラウザが閉じた」と言わない", jpError("Protocol error (Page.navigate): Cannot navigate to invalid URL").includes("URLの形"));
  }
  // 除外リスト: 見出しの表記ゆれとセミコロン
  eq("除外リスト: 見出しの表記ゆれ", parseSuppressionText("会社名;ドメイン\nA社;a.example.jp")[0]?.domain, "a.example.jp");

  // Excel: ふりがな（rPh）を会社名にくっつけない・書式付き文字列はつなげる
  eq("xlsx: ふりがなを除く", xlsxText('<si><t>株式会社サンプル</t><rPh sb="0" eb="4"><t>カブシキガイシャ</t></rPh><phoneticPr fontId="1"/></si>'), "株式会社サンプル");
  eq("xlsx: 書式付きの文字列はつなげる", xlsxText("<si><r><t>株式会社</t></r><r><rPr><b/></rPr><t xml:space=\"preserve\">A&amp;B</t></r></si>"), "株式会社A&B");
  {
    const AdmZip = (await import("adm-zip")).default;
    const z = new AdmZip();
    z.addFile("xl/sharedStrings.xml", Buffer.from('<sst><si><t>会社名</t></si><si><t>企業URL</t></si><si><t>株式会社テスト</t><rPh sb="0" eb="4"><t>カブシキガイシャテスト</t></rPh><phoneticPr fontId="1"/></si></sst>'));
    z.addFile("xl/worksheets/sheet1.xml", Buffer.from('<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="inlineStr"><is><t>https://t.example.jp/</t><rPh><t>ゆーあーるえる</t></rPh></is></c></row></sheetData></worksheet>'));
    const xr = await parseCompanyXlsx(z.toBuffer());
    eq("xlsx: 会社名にフリガナが付かない", [xr[0]?.company_name, xr[0]?.site_url], ["株式会社テスト", "https://t.example.jp/"]);
  }

  // 取り込み: URL欄の「なし」はURL扱いしない。メールがあればメールで送る
  {
    const db = getDb();
    const sid = Number(db.prepare("INSERT INTO sender_profiles(label, company, person, email) VALUES('t','テスト社','担当','me@example.jp')").run().lastInsertRowid);
    const cid = Number(db.prepare("INSERT INTO form_campaigns(name, sender_id, channel) VALUES('t', ?, 'form_first')").run(sid).lastInsertRowid);
    const row = (company_name: string, site_url: string, email: string) => ({ company_name, form_url: "", site_url, email, industry: "", sub_industry: "", prefecture: "", representative: "" });
    const s = importRowsToCampaign(cid, [row("A社", "なし", "info@a-nashi.example.jp"), row("B社", "-", ""), row("C社", "不明", "")], { dryRun: true });
    eq("取り込み: 「なし」でもメールがあればメールで送る", [s.addedEmail, s.addedForm, s.noUrl], [1, 0, 2]);
    eq("取り込み: 「-」「不明」を同じ会社の重複にしない", s.duplicated, 0);
    // テスト送信・再試行: メールはブラウザを起動しない（テンプレートの文面なら相手のHPを読まない）
    db.prepare("UPDATE form_campaigns SET mode='template' WHERE id=?").run(cid);
    eq("ブラウザ: フォームは要る／テンプレのメールは要らない", [ctx.needsBrowser("form", cid), ctx.needsBrowser("email", cid)], [true, false]);
  }

  // お知らせ（flash）: ? と # を落とし、ユーザー別に保存する
  eq("flash: ? を落とす", ctx.flashKey(3, "/todo?kind=captcha"), "3:/todo");
  eq("flash: # を落とす", ctx.flashKey(3, "/jobs/5#fix"), "3:/jobs/5");
  {
    const reqA = { user: { id: 1 }, path: "/todo" } as never, reqB = { user: { id: 2 }, path: "/todo" } as never;
    ctx.setFlash(reqA, "/todo?kind=noform", "Aさんへ");
    eq("flash: 別の人には出ない", ctx.takeFlash(reqB), "");
    eq("flash: 本人には ?kind 付きの行き先でも出る", ctx.takeFlash(reqA), "Aさんへ");
    eq("flash: 1回出したら消える", ctx.takeFlash(reqA), "");
    ctx.setFlash({ path: "/" } as never, "/", "ログインしました");
    eq("flash: ログイン前に積んだものも出る", ctx.takeFlash({ user: { id: 1 }, path: "/" } as never), "ログインしました");
  }

  // async の経路の例外で画面が固まらない（戻り先に日本語のお知らせを出して返す）
  {
    let redirected = "";
    const req = { user: { id: 9 }, method: "POST", path: "/x", params: { id: "7" } } as never;
    const res = { headersSent: false, req, redirect(to: string) { redirected = to; } } as never;
    const h = ctx.safeAsync(async () => { throw new Error("browserType.launch: Failed to launch the browser process"); }, (r) => `/jobs/${Number((r as unknown as { params: { id: string } }).params.id)}`);
    h(req, res, () => {});
    await new Promise((r) => setTimeout(r, 10));
    eq("safeAsync: 戻り先へ返す", redirected, "/jobs/7");
    ok("safeAsync: 日本語のお知らせ", ctx.takeFlash({ user: { id: 9 }, path: "/jobs/7" } as never).includes("ブラウザを起動できません"));
    let nexted: unknown = null;
    ctx.safeAsync(async () => { throw new Error("x"); })(req, { headersSent: false } as never, (e?: unknown) => { nexted = e; });
    await new Promise((r) => setTimeout(r, 10));
    ok("safeAsync: 戻り先が無ければ共通のエラーページへ", nexted instanceof Error);
  }

  // 管理者だけの設定: 一般ユーザーは元の画面に戻す。管理者（1人で使っている人）はそのまま通す
  {
    let passed = false, to = "";
    const mw = ctx.adminOnly("/suppressions");
    const mkRes = (req: unknown) => ({ req, redirect(t: string) { to = t; } }) as never;
    const admin = { user: { id: 1, role: "admin" }, path: "/share/settings" };
    mw(admin as never, mkRes(admin), () => { passed = true; });
    ok("adminOnly: 管理者は通す", passed && !to);
    passed = false;
    const member = { user: { id: 2, role: "member" }, path: "/share/settings" };
    mw(member as never, mkRes(member), () => { passed = true; });
    ok("adminOnly: 一般ユーザーは戻す", !passed && to === "/suppressions");
  }

  // キャンペーンの数値: 0 を既定値に戻さない・空欄は今の値・開始≧終了は保存しない
  {
    const fb = ctx.CAMPAIGN_NUM_DEFAULTS;
    const a = ctx.campaignNumbers({ daily_limit: "0", email_daily_limit: "0", send_window_start: "0", send_window_end: "24", resend_days: "0" }, fb);
    eq("数値: 0 はそのまま", [a.daily_limit, a.email_daily_limit, a.send_window_start, a.send_window_end, a.resend_days, a.note], [0, 0, 0, 24, 0, ""]);
    const b = ctx.campaignNumbers({ daily_limit: "", email_daily_limit: "abc", send_window_start: "18", send_window_end: "9", resend_days: "" }, { ...fb, daily_limit: 50 });
    eq("数値: 空欄・文字は今の値、再送禁止の空欄は0にしない", [b.daily_limit, b.email_daily_limit, b.resend_days], [50, 100, 90]);
    eq("数値: 開始≧終了は元の時間帯に戻す", [b.send_window_start, b.send_window_end], [9, 18]);
    ok("数値: 戻した理由を出す", b.note.includes("開始"));
    eq("数値: 全角数字・範囲外", (({ daily_limit, send_window_end }) => [daily_limit, send_window_end])(ctx.campaignNumbers({ daily_limit: "１２０", send_window_end: "30" }, fb)), [120, 24]);
  }

  // 結果のお知らせに内部の値（sent など）を出さない
  eq("結果: 日本語の状態名", resultNote({ status: "sent", result_text: "送信完了を確認\n詳細" }), "送信済み（送信完了を確認）");
  ok("結果: 知らない状態でも英語を出さない", !/[a-z]/.test(resultNote({ status: "weird" })));
}

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

// ---- メールをエラーなく送れるか（email.ts / worker.ts / message.ts / 送信者の入力チェック）----
// 実在のメールサーバーには一切つながない。偽のエラーと、このテストの中だけで立てる偽のSMTPサーバー（127.0.0.1・空きポート）で確かめる
{
  const net = await import("node:net");
  const { classifySmtpError, explainSmtpError, isGoogleSmtp, normalizeAppPassword, checkSmtpPassword, sendEmail, buildEmailBody, unsubscribeAddress, emailPause, clearEmailPause } = await import("../src/email.js");
  const { renderTemplate, lintMessage, aiErrorKind } = await import("../src/message.js");
  const { processJob, sentTodayBySender, sentToday, warmupLimit, aiPause } = await import("../src/worker.js");
  const { validateSender } = await import("../src/app/context.js");
  const db = getDb();
  const smtpE = (o: Record<string, unknown>) => Object.assign(new Error(String(o.message ?? "")), o);

  // SMTPエラーの分け方: 宛先側の一時エラーと受信箱いっぱいでアカウントを止めない。差出人拒否・上限・ログイン拒否はアカウント単位で止める
  eq("SMTP: ログイン拒否(535)はアカウント停止", classifySmtpError(smtpE({ code: "EAUTH", command: "AUTH PLAIN", responseCode: 535, message: "Invalid login: 535-5.7.8 Username and Password not accepted" })), { kind: "pause", minutes: 60, penalty: true });
  eq("SMTP: 宛先の受信箱いっぱい(552 5.2.2)はその会社だけ", classifySmtpError(smtpE({ code: "EENVELOPE", command: "RCPT TO", responseCode: 552, message: "Recipient command failed: 552 5.2.2 Quota exceeded" })).kind, "permanent");
  eq("SMTP: 宛先の一時エラー(450)は時間を置いて送り直す", classifySmtpError(smtpE({ code: "EENVELOPE", command: "RCPT TO", responseCode: 450, message: "450 4.2.1 try later" })).kind, "temporary");
  eq("SMTP: 本文後の一時エラー(451)も送り直す", classifySmtpError(smtpE({ code: "EMESSAGE", command: "DATA", responseCode: 451, message: "Message failed: 451 4.3.0 temporary" })).kind, "temporary");
  eq("SMTP: 差出人拒否(553)はアカウント停止24時間（ウォームアップは下げない）", classifySmtpError(smtpE({ code: "EENVELOPE", command: "MAIL FROM", responseCode: 553, message: "Mail command failed: 553 5.7.1 Sender address rejected: not owned by user" })), { kind: "pause", minutes: 1440, penalty: false });
  eq("SMTP: Gmailの1日の上限(5.4.5)は24時間停止", classifySmtpError(smtpE({ command: "MAIL FROM", responseCode: 550, message: "550 5.4.5 Daily user sending limit exceeded" })), { kind: "pause", minutes: 1440, penalty: true });
  eq("SMTP: Gmailの送りすぎ(421 4.7.0)は1時間停止", classifySmtpError(smtpE({ command: "RCPT TO", responseCode: 421, message: "421 4.7.0 Try again later" })).kind, "pause");
  eq("SMTP: 本文を送る前の切断は回線の一時停止", classifySmtpError(smtpE({ code: "ECONNECTION", command: "CONN", message: "Connection closed unexpectedly" })), { kind: "pause", minutes: 10, penalty: false });
  eq("SMTP: 本文を送った後の切断は「送れたか不明」", classifySmtpError(smtpE({ code: "ECONNECTION", command: "CONN", message: "Connection closed unexpectedly", deliveryUnknown: true })).kind, "unknown");
  eq("SMTP: 本文の後でもサーバーが断ったなら不明ではない", classifySmtpError(smtpE({ code: "EMESSAGE", command: "DATA", responseCode: 550, message: "550 5.7.1 spam", deliveryUnknown: true })).kind, "permanent");
  eq("SMTP: 宛先アドレスの形が不正はその会社だけ", classifySmtpError(smtpE({ code: "EENVELOPE", command: "API", message: "Invalid recipient \"x\"" })).kind, "permanent");

  // 日本語の説明: ログイン拒否はサービスごと、ポート違い・切断・宛先不明
  const gws = { smtp_host: "smtp.gmail.com", smtp_port: 465, smtp_user: "sales@my-company.co.jp", smtp_pass: "abcdefghijklmnop" } as never;
  ok("説明: Workspace（独自ドメイン×smtp.gmail.com）はGoogleの案内", explainSmtpError(smtpE({ code: "EAUTH", command: "AUTH PLAIN", responseCode: 535, message: "Invalid login: 535" }), gws).startsWith("Google"));
  ok("説明: Microsoft 365 は SMTP AUTH の案内", /SMTP認証/.test(explainSmtpError(smtpE({ code: "EAUTH", command: "AUTH LOGIN", responseCode: 535, message: "535 5.7.3 Authentication unsuccessful" }), { smtp_host: "smtp.office365.com", smtp_port: 587 } as never)));
  ok("説明: Google 以外で Google の案内を出さない", !/Google/.test(explainSmtpError(smtpE({ code: "EAUTH", command: "AUTH PLAIN", responseCode: 535, message: "535 auth failed" }), { smtp_host: "mail.example.jp", smtp_port: 465 } as never)));
  ok("説明: Greeting never received はポートと暗号化", /ポート番号/.test(explainSmtpError(smtpE({ code: "ETIMEDOUT", command: "CONN", message: "Greeting never received" }), gws)));
  ok("説明: wrong version number もポートと暗号化", /465/.test(explainSmtpError(new Error("C0:error:0A00010B:SSL routines:ssl3_get_record:wrong version number"), gws)));
  ok("説明: ECONNRESET は途中で切れた", /途中で切れ/.test(explainSmtpError(smtpE({ code: "ESOCKET", message: "read ECONNRESET" }), gws)));
  ok("説明: 550 5.1.1 は宛先が存在しない", /存在しません/.test(explainSmtpError(smtpE({ command: "RCPT TO", responseCode: 550, message: "550 5.1.1 The email account that you tried to reach does not exist" }), gws)));
  ok("jp: SMTPのログイン拒否を日本語に", jpError("Invalid login: 535-5.7.8 Username and Password not accepted").includes("ログインを拒否"));

  // Google の判定とアプリパスワードの空白
  ok("Google判定: 既定（空）は smtp.gmail.com", isGoogleSmtp({ smtp_host: "" } as never));
  ok("Google判定: smtp.gmail.com", isGoogleSmtp({ smtp_host: "smtp.gmail.com" } as never));
  ok("Google判定: Outlook は違う", !isGoogleSmtp({ smtp_host: "smtp.office365.com" } as never));
  ok("パスワード確認: 独自ドメインの Workspace でも16文字を確かめる", checkSmtpPassword({ smtp_host: "smtp.gmail.com", smtp_user: "a@my-company.co.jp", smtp_pass: "hunter2" } as never) !== null);
  eq("アプリパスワード: 半角空白", normalizeAppPassword("abcd efgh ijkl mnop"), "abcdefghijklmnop");
  eq("アプリパスワード: NBSP・全角空白・連続空白", normalizeAppPassword(" abcd efgh　ijkl  mnop​"), "abcdefghijklmnop");
  eq("アプリパスワード: 全角英字", normalizeAppPassword("ａｂｃｄ ｅｆｇｈ ｉｊｋｌ ｍｎｏｐ"), "abcdefghijklmnop");
  eq("アプリパスワード: ふつうのパスワードの中の空白は残す", normalizeAppPassword(" pass word 1 "), "pass word 1");

  // 差し込み: 知らない名前は残して文面チェックで止める。値が空の既知の名前はこれまでどおり空
  eq("差し込み: 知らない名前は残す", renderTemplate("{{企業}} 御中", { 会社名: "株式会社A" }), "{{企業}} 御中");
  eq("差し込み: 値が空の既知の名前は空", renderTemplate("{{業種}}の皆さま", { 業種: "" }), "の皆さま");
  ok("文面チェック: 件名の差し込み残りはエラー", lintMessage("本文です", "{{企業}}様へのご案内").some((l) => l.level === "error" && l.text.includes("件名")));

  // AIの失敗: 自分側の原因は会社を失敗にしない
  eq("AI: キー失効はキャンペーン停止", aiErrorKind(new Error("anthropic 401: invalid x-api-key"))?.kind, "config");
  eq("AI: 残高切れはキャンペーン停止", aiErrorKind(new Error("anthropic 400: Your credit balance is too low"))?.kind, "config");
  eq("AI: 429 は5分待つ", aiErrorKind(new Error("anthropic 429: rate_limit_error")), { kind: "transient", minutes: 5 });
  eq("AI: 回線断は待つ", aiErrorKind(Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } }))?.kind, "transient");
  eq("AI: その会社だけの問題は従来どおり", aiErrorKind(new Error("anthropic 400: prompt is too long")), null);
  eq("AI: ブラウザの時間切れはAIのせいにしない", aiErrorKind(new Error("page.goto: Timeout 20000ms exceeded")), null);

  // 送信者の電話番号: 別種のハイフン・全角でも弾かず、半角にそろえて保存する
  for (const [input, want] of [["03‐1234‐5678", "03-1234-5678"], ["０３－１２３４－５６７８", "03-1234-5678"], ["03ー1234ー5678", "03-1234-5678"], ["03−1234−5678", "03-1234-5678"], ["（03）1234-5678", "(03)1234-5678"]]) {
    const body: Record<string, unknown> = { company: "株式会社A", person: "田中 太郎", email: "a@example.jp", tel: input };
    eq(`電話: ${input} を受け付ける`, validateSender(body), null);
    eq(`電話: ${input} は半角にそろう`, body.tel, want);
  }
  ok("電話: 文字は弾く", validateSender({ company: "A", person: "田中", email: "a@example.jp", tel: "代表番号" }) !== null);

  // 配信停止の受付先は、読んでいる受信箱（smtp_user）。返信先は利用者が決めたまま
  {
    const sd = { company: "株式会社送信", person: "田中", email: "form@front.example", reply_email: "reply@front.example", smtp_user: "sales@mail.example", address: "東京都港区1-1" } as never;
    eq("配信停止の宛先は smtp_user", unsubscribeAddress(sd), "sales@mail.example");
    const b = buildEmailBody("本文", sd, "to@x.example");
    ok("配信停止リンク（mailto）は smtp_user 宛て", b.html.includes("mailto:sales@mail.example?subject="));
    ok("本文末尾の案内も smtp_user 宛て", b.text.includes("sales@mail.example 宛て") && b.text.includes("メール: reply@front.example"));
    eq("smtp_user がアドレスの形でなければ返信先", unsubscribeAddress({ smtp_user: "user123", reply_email: "", email: "a@b.example" } as never), "a@b.example");
  }

  // ---- 偽のSMTPサーバーで、送信の各段階のエラーを本物の nodemailer のエラーとして確かめる ----
  type Mode = { mail?: string; rcpt?: string; end?: string | "cut"; cutAtRcpt?: boolean; onData?: (raw: string) => void };
  let mode: Mode = {};
  const server = net.createServer((sock) => {
    let buf = "", inData = false, data = "", authWait = false;
    const say = (l: string) => { if (!sock.destroyed) sock.write(l + "\r\n"); };
    say("220 fake.local ESMTP");
    sock.on("error", () => {});
    sock.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      for (;;) {
        if (inData) {
          const end = buf.indexOf("\r\n.\r\n");
          if (end < 0) return;
          data += buf.slice(0, end); buf = buf.slice(end + 5); inData = false;
          mode.onData?.(data);
          if (mode.end === "cut") { sock.destroy(); return; }
          say(mode.end ?? "250 2.0.0 queued");
          continue;
        }
        const i = buf.indexOf("\r\n");
        if (i < 0) return;
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        const cmd = line.toUpperCase();
        if (authWait) { authWait = false; say("235 2.7.0 ok"); }
        else if (cmd.startsWith("EHLO")) say("250-fake.local\r\n250-AUTH PLAIN\r\n250 8BITMIME");
        else if (cmd === "AUTH PLAIN") { authWait = true; say("334 "); }
        else if (cmd.startsWith("AUTH PLAIN")) say("235 2.7.0 ok");
        else if (cmd.startsWith("MAIL FROM")) say(mode.mail ?? "250 ok");
        else if (cmd.startsWith("RCPT TO")) { if (mode.cutAtRcpt) { sock.destroy(); return; } say(mode.rcpt ?? "250 ok"); }
        else if (cmd === "DATA") { inData = true; data = ""; say("354 go"); }
        else if (cmd === "QUIT") { say("221 bye"); sock.end(); }
        else say("250 ok");
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as { port: number }).port;

  const mkSender = (label: string, smtpUser: string) => db.prepare(`INSERT INTO sender_profiles(label,company,person,email,reply_email,smtp_user,smtp_pass,smtp_host,smtp_port,address) VALUES(?,?,?,?,?,?,?,?,?,?)`)
    .run(label, "株式会社送信テスト", "田中 太郎", "front@sender.example", "", smtpUser, "pass", "127.0.0.1", port, "東京都港区1-1").lastInsertRowid as number;
  const sA = mkSender("A", "a@sender.example");
  const sB = mkSender("B", "b@sender.example");
  const tpl = "{{会社名}}\nご担当者様\n\n突然のご連絡失礼いたします。株式会社送信テストの田中と申します。\n\n弊社は中小企業向けに、問い合わせ対応を楽にする仕組みをご提供しております。\n貴社の業務の手間を減らすお手伝いができればと思い、ご連絡いたしました。\n\nご興味があれば本メールにご返信ください。\n田中 太郎 front@sender.example\n\n※本メッセージが不要な場合は、お手数ですがその旨ご連絡ください。以後のご連絡は控えさせていただきます。";
  const camp = db.prepare(`INSERT INTO form_campaigns(name,sender_id,mode,subject_text,template_text,channel,email_warmup) VALUES(?,?,?,?,?,?,0)`).run("メール送信テスト", sA, "template", "ご案内", tpl, "email").lastInsertRowid as number;
  const mkJob = (name: string, email: string) => db.prepare(`INSERT INTO form_jobs(campaign_id,company_name,email,domain,channel,status) VALUES(?,?,?,?,'email','queued')`).run(camp, name, email, email.split("@")[1]).lastInsertRowid as number;
  const row = (id: number) => db.prepare("SELECT status, result_text, sent_by_sender, sent_at, retry_after FROM form_jobs WHERE id=?").get(id) as { status: string; result_text: string; sent_by_sender: number | null; sent_at: string | null; retry_after: string | null };
  const sender = (id: number) => db.prepare("SELECT * FROM sender_profiles WHERE id=?").get(id) as never;
  const noBrowser = null as never;

  // 正常に送れる。本文を受け取った時点で、送信アカウント（sent_by_sender）がもう書かれている
  {
    let seen: number | null = -1;
    let raw = "";
    const j = mkJob("株式会社送れる", "info@ok.example");
    mode = { onData: (d) => { raw = d; seen = row(j).sent_by_sender; } };
    await processJob(noBrowser, j);
    eq("送信: 送信済みになる", row(j).status, "sent");
    eq("送信: 送る前に送信アカウントを書いている（途中で止まっても正しい送信済みフォルダを見られる）", seen, sA);
    ok("送信: 返信先（Reply-To）は利用者の設定のまま", /Reply-To: front@sender\.example/i.test(raw));
    ok("送信: List-Unsubscribe は送信用アカウント宛て", /List-Unsubscribe:[^\n]*mailto:a@sender\.example/i.test(raw.replace(/\r\n\s+/g, " ")));
  }
  // 本文を送り切った後に切れた → 「送れたか不明」。待機に戻さない（同じ相手に二重送信しない）
  {
    const j = mkJob("株式会社切断", "info@cut.example");
    mode = { end: "cut" };
    await processJob(noBrowser, j);
    const r = row(j);
    eq("切断: 失敗（要確認）にする", r.status, "failed");
    ok("切断: 送信済みフォルダの確認に回す印が付く", r.result_text.startsWith("送信の最後で通信が切れたため中断") && r.result_text.includes("送信済みか不明"), r.result_text);
    ok("切断: アカウントは止めない", !emailPause(sender(sA)));
  }
  // 本文の前（RCPT）で切れた → 届いていないので、アカウントを10分止めて待機に戻す
  {
    const j = mkJob("株式会社前切断", "info@precut.example");
    mode = { cutAtRcpt: true };
    await processJob(noBrowser, j);
    eq("本文前の切断: 待機に戻す", row(j).status, "queued");
    ok("本文前の切断: アカウントを一時停止", Boolean(emailPause(sender(sA))));
    clearEmailPause(sender(sA));
  }
  // 宛先の一時エラー（450）→ 時間を置いて待機。3回目で失敗
  {
    const j = mkJob("株式会社一時", "info@temp.example");
    mode = { rcpt: "450 4.2.1 mailbox busy, try later" };
    await processJob(noBrowser, j);
    eq("一時エラー: 1回目は待機", row(j).status, "queued");
    ok("一時エラー: すぐには送り直さない（retry_after）", Boolean(row(j).retry_after));
    ok("一時エラー: アカウントは止めない", !emailPause(sender(sA)));
    await processJob(noBrowser, j);
    eq("一時エラー: 2回目も待機", row(j).status, "queued");
    await processJob(noBrowser, j);
    eq("一時エラー: 3回目で失敗", row(j).status, "failed");
  }
  // 宛先の受信箱いっぱい（552 5.2.2）→ その会社だけ失敗。アカウントは止めない
  {
    const j = mkJob("株式会社満杯", "info@full.example");
    mode = { rcpt: "552 5.2.2 The email account that you tried to reach is over quota" };
    await processJob(noBrowser, j);
    eq("受信箱いっぱい: その会社は失敗", row(j).status, "failed");
    ok("受信箱いっぱい: アカウントは止めない", !emailPause(sender(sA)));
  }
  // 差出人拒否（553 MAIL FROM）→ その会社は待機に戻して、アカウントを止める
  {
    const j = mkJob("株式会社差出人", "info@from.example");
    mode = { mail: "553 5.7.1 Sender address rejected: not owned by user" };
    await processJob(noBrowser, j);
    eq("差出人拒否: 会社は失敗にせず待機", row(j).status, "queued");
    ok("差出人拒否: アカウントを止める", Boolean(emailPause(sender(sA))));
    clearEmailPause(sender(sA));
  }
  // 戻りメールで「失敗」になった分も、今日の送信数に数える（上限を超えて送らない）
  {
    const before = sentTodayBySender(sA);
    const okJob = db.prepare("SELECT id FROM form_jobs WHERE company_name='株式会社送れる'").get() as { id: number };
    db.prepare("UPDATE form_jobs SET status='failed', prev_status='sent', result_text='送信後に戻ってきた（届かなかった）: 宛先不明' WHERE id=?").run(okJob.id);
    eq("今日の送信数: 戻りメールで失敗になっても減らない（アカウント別）", sentTodayBySender(sA), before);
    ok("今日の送信数: キャンペーン別も数える", sentToday(camp, "email") >= 1);
  }
  // ウォームアップの起点: 登録が古くても、メールを送ったことが無ければ初日
  {
    const old = mkSender("古い登録", "old@sender.example");
    db.prepare("UPDATE sender_profiles SET created_at=datetime('now','-60 days') WHERE id=?").run(old);
    eq("ウォームアップ: 登録から60日でも、送った記録が無ければ初日の上限", warmupLimit(old, 500).limit, 30);
    // 旧版の送信（sent_by_sender が無い）は、キャンペーンの送信者のアカウントで送ったものとして数える
    const c2 = db.prepare(`INSERT INTO form_campaigns(name,sender_id,mode,subject_text,template_text,channel) VALUES('旧版',?, 'template','件名','本文','email')`).run(old).lastInsertRowid as number;
    db.prepare(`INSERT INTO form_jobs(campaign_id,company_name,email,domain,channel,status,sent_at) VALUES(?,?,?,?,'email','sent',datetime('now','-20 days'))`).run(c2, "株式会社旧版", "x@old.example", "old.example");
    eq("ウォームアップ: 旧版で20日前から送っていれば通常の上限", warmupLimit(old, 500).limit, 500);
  }
  // 切り替えたアカウントで送った分も、そのアカウントの今日の数に入る
  {
    db.prepare("UPDATE form_campaigns SET email_sender_ids=? WHERE id=?").run(String(sB), camp);
    const j = mkJob("株式会社切替", "info@switch.example");
    db.prepare("UPDATE form_jobs SET sent_by_sender=? WHERE id=?").run(sB, j);
    mode = {};
    const { setEmailPause } = await import("../src/email.js");
    setEmailPause(sender(sA), 10, "テスト");
    await processJob(noBrowser, j);
    eq("切替: 別アカウントで送れる", [row(j).status, row(j).sent_by_sender], ["sent", sB]);
    eq("切替: 切替先の今日の数に入る", sentTodayBySender(sB), 1);
    clearEmailPause(sender(sA));
  }
  ok("AIの一時停止は既定でなし", aiPause() === null);
  // 送信直前の文面チェック: 知らない差し込みがあれば送らない
  {
    db.prepare("UPDATE form_campaigns SET subject_text='{{企業}}へのご案内' WHERE id=?").run(camp);
    const j = mkJob("株式会社差し込み", "info@tpl.example");
    mode = {};
    await processJob(noBrowser, j);
    // 1社ずつ失敗にすると待機中の全社が失敗に変わるので、会社は待機に戻してキャンペーンを止める
    const before = (db.prepare("SELECT status FROM form_campaigns WHERE id=?").get(camp) as { status: string }).status;
    eq("差し込み間違い: 送らずに待機へ戻す", row(j).status, "queued");
    ok("差し込み間違い: 理由が分かる", row(j).result_text.includes("件名の差し込み"));
    eq("差し込み間違い: キャンペーンを一時停止", before, "paused");
    eq("差し込み間違い: 送っていない", row(j).sent_at ?? null, null);
    db.prepare("UPDATE form_campaigns SET status='running' WHERE id=?").run(camp);
  }
  // AIで文面を作るキャンペーン: AI側の失敗で会社を「失敗」にしない（通信はしない。fetch を差し替えて失敗させる）
  {
    const realFetch = globalThis.fetch;
    db.prepare("INSERT INTO settings(key,value) VALUES('ai_provider','anthropic'),('ai_api_key','test-dummy-key') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();
    db.prepare("UPDATE form_campaigns SET mode='ai', subject_text='ご案内', status='running' WHERE id=?").run(camp);
    const mkAiJob = (name: string, dom: string) => {
      db.prepare("INSERT INTO site_cache(domain,title,text) VALUES(?,?,?) ON CONFLICT(domain) DO NOTHING").run(dom, "テスト", "テスト会社のサイト");
      return mkJob(name, `info@${dom}`);
    };
    try {
      globalThis.fetch = (async () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } }); }) as typeof fetch;
      const j1 = mkAiJob("株式会社AI回線", "ai-net.example");
      await processJob(noBrowser, j1);
      eq("AI回線断: 会社は失敗にせず待機", row(j1).status, "queued");
      ok("AI回線断: AIを使う送信をしばらく止める", Boolean(aiPause()));
      db.prepare("DELETE FROM settings WHERE key='ai_pause'").run();
      globalThis.fetch = (async () => new Response('{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}', { status: 401 })) as typeof fetch;
      const j2 = mkAiJob("株式会社AIキー", "ai-key.example");
      await processJob(noBrowser, j2);
      eq("AIキー失効: 会社は失敗にせず待機", row(j2).status, "queued");
      eq("AIキー失効: キャンペーンを一時停止", (db.prepare("SELECT status FROM form_campaigns WHERE id=?").get(camp) as { status: string }).status, "paused");
    } finally {
      globalThis.fetch = realFetch;
      db.prepare("DELETE FROM settings WHERE key IN ('ai_provider','ai_api_key','ai_pause')").run();
    }
  }
  await new Promise<void>((r) => server.close(() => r()));
}

if (failed) { console.error(`\nunit: ${failed}件 失敗`); process.exit(1); }
console.log("unit: ALL OK");
