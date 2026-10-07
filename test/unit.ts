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
const { splitAddress, classify, dialogSaysSent } = await import("../src/formFiller.js");
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
// 営業でないことの申告（チェック欄）はお断り扱い。営業日・個人情報の注意書きには当てない
{
  const { detectRefusal, detectDeclaration } = await import("../src/detect.js");
  // 営業でないことの申告は、チェック欄・設問のラベルだけで見る（ページ全文にかけると普通の文に当たる）
  ok("detect: 営業目的ではないことを確認しました は申告（チェックしない）", detectDeclaration("営業・売り込みを目的としたお問い合わせではないことを確認しました"));
  ok("detect: セールスではないことを確認 は申告", detectDeclaration("セールス・勧誘ではないことを確認しました"));
  ok("detect: 普通のお断りの文もラベルで拾う", detectDeclaration("営業目的のお問い合わせはお断りします"));
  eq("detect: ページ全文では「24時間営業ではありません」をお断りにしない", detectRefusal("当店は24時間営業ではありません。お問い合わせはこちら。"), null);
  eq("detect: ページ全文では「しつこい営業ではありません」をお断りにしない", detectRefusal("しつこい営業ではありませんのでご安心ください。"), null);
  eq("detect: ページ全文では申告の文そのものもお断りにしない（チェック欄の側で止める）", detectRefusal("営業・売り込みを目的としたお問い合わせではないことを確認しました"), null);
  eq("detect: 普通の同意チェックは申告ではない", detectDeclaration("個人情報の取扱いに同意する"), null);
  eq("detect: 営業日ではありません は対象外", detectRefusal("土日祝日は営業日ではありませんので、翌営業日にご返信します。"), null);
  eq("detect: 個人情報の注意書きは対象外", detectRefusal("ご入力いただいた個人情報は営業活動に利用するものではありません。"), null);
}
// 送信直後のポップアップ（alert）が完了の知らせか。確認・警告・打ち消しは完了にしない
eq("dialog: 送信しました は完了", dialogSaysSent("送信しました"), true);
eq("dialog: Thanks for contacting us! は完了", dialogSaysSent("Thanks for contacting us!"), true);
eq("dialog: 送信してよろしいですか は完了でない", dialogSaysSent("この内容で送信しました。よろしいですか？"), false);
eq("dialog: 入力の警告は完了でない", dialogSaysSent("お電話を入力してください"), false);
eq("dialog: 送信に失敗しました は完了でない", dialogSaysSent("送信に失敗しました"), false);
eq("dialog: まだ送信は完了していません は完了でない", dialogSaysSent("まだ送信は完了していません"), false);
eq("dialog: 確認メールの予告だけでは完了にしない", dialogSaysSent("ご入力ありがとうございます"), false);

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
  // ライセンスは必須: キーが無くても、お試し期間（初めて起動してから14日）は送れる。過ぎたら送れない。設定では外せない
  setLicenseKey("");
  const { getSetting: gs, setSetting: ss } = await import("../src/db.js");
  const { licenseBlock, licenseeLine, trialDaysLeft, TRIAL_DAYS } = await import("../src/license.js");
  const trialWas = gs(S.licenseTrialStart, "");
  ss(S.licenseTrialStart, new Date().toISOString());
  eq("license: お試し期間中はキーが無くても上限そのまま", cappedDailyLimit(300).limit, 300);
  eq("license: お試し期間の残り", trialDaysLeft(), TRIAL_DAYS);
  ok("license: お試し期間中と画面に出る", /お試し期間中（あと14日）/.test(licenseeLine()));
  ss(S.licenseTrialStart, new Date(Date.now() - (TRIAL_DAYS + 1) * 86400_000).toISOString());
  eq("license: お試し期間が過ぎたら送れない", cappedDailyLimit(300).limit, 0);
  ok("license: 送れない理由が分かる", /お試し期間（14日）が終わった/.test(licenseBlock() ?? ""));
  saveSettingValue(S.licenseEnforce, false);
  eq("license: 以前の「制限しない」の設定では外れない", cappedDailyLimit(300).limit, 0);
  eq("license: 不正なキーでも送れない", (setLicenseKey(forged), cappedDailyLimit(300).limit), 0);
  // 正しい鍵で作ったキー（テストの中で作った鍵の公開鍵は src に無いので、検証が通るのは配布元の鍵だけ。ここでは期限切れの扱いだけ確かめる）
  setLicenseKey("");
  ss(S.licenseTrialStart, trialWas || new Date().toISOString());
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

  // 見出し: 括弧の中が注記のときだけ外す（1周目で全部外すようにしたら、別の列を会社URL・会社メールとして拾っていた）
  eq("見出し: 「URL（Indeed）」より HP を会社URLにする", rep(["会社名", "HP", "URL（Indeed）"]), { 企業名: "会社名", 企業URL: "HP" });
  eq("見出し: 個人のメールを会社メールにしない", rep(["会社名", "メール（担当者個人）", "Mail(個人)"]), { 企業名: "会社名" });
  eq("見出し: 「企業名（英数字不可）」を読み仮名扱いにしない", parseCompanyCsv("企業名（英数字不可）,HP\n株式会社A,https://a.example.jp/\n").map((r) => [r.company_name, r.site_url]), [["株式会社A", "https://a.example.jp/"]]);
  eq("見出し: 注記の括弧は外す", ["会社名（必須）", "URL（例：https://example.com）", "メール（問い合わせ用）", "電話番号（ハイフンなし）"].map(normHeader), ["会社名", "url", "メール", "電話番号"]);
  ok("見出し: 英語表記の列は別扱い", normHeader("会社名(英語表記)") !== "会社名");
  eq("見出し: 素の URL と HP があれば HP", rep(["会社名", "URL", "HP"])["企業URL"], "HP");
}

// ---- 文面の検査・進まない理由・今日の数・お知らせの持ち主・大きすぎる貼り付け（2周目）----
{
  const { templateProblems, normalizeTemplateBraces, suggestTemplateVar, TEMPLATE_VARS, TEMPLATE_VAR_BUTTONS } = await import("../src/ui/parts.js");
  const { DEFAULT_TEMPLATE, DEFAULT_SUBJECT, renderTemplate, buildVars } = await import("../src/message.js");
  const ctx = await import("../src/app/context.js");
  const { sentTodaySql, SENT_TODAY_SQL } = await import("../src/db.js");
  const { sentToday } = await import("../src/worker.js");
  const db = getDb();

  // 文面の検査
  const okTpl = "{{会社名}}\n{{代表者}}\n\n突然のご連絡失礼いたします。{{自社名}}の{{担当者}}と申します。\n弊社はテストサービスを提供しております。\n{{自社メール}}";
  eq("文面: 正しい文面は問題なし", templateProblems({ subject_text: "{{会社名}}様へのご案内", template_text: okTpl }), []);
  {
    const p = templateProblems({ subject_text: DEFAULT_SUBJECT, template_text: DEFAULT_TEMPLATE });
    ok("文面: 初期値の件名の【ここに】を見つける", p.some((x) => x.startsWith("件名に【ここに")), JSON.stringify(p));
    ok("文面: 初期値の本文の【ここに】を見つける", p.some((x) => x.startsWith("本文に【ここに")), JSON.stringify(p));
  }
  ok("文面: {{企業}} に {{会社名}} を勧める", templateProblems({ subject_text: "ご案内", template_text: "{{企業}} 御中\n" + okTpl }).some((x) => x.includes("{{企業}} は使えない") && x.includes("{{会社名}} のことですか")));
  eq("文面: 近い名前", [suggestTemplateVar("社名"), suggestTemplateVar("自社電話番号"), suggestTemplateVar("ＡＩ冒頭"), suggestTemplateVar("まったく関係ない言葉")], ["会社名", "自社電話", "AI冒頭", ""]);
  ok("文面: 一重の {会社名} を止める", templateProblems({ template_text: "{会社名} 御中\n" + okTpl }).some((x) => x.includes("「{会社名}」") && x.includes("{{会社名}}")));
  ok("文面: 閉じ忘れ {{会社名} を止める", templateProblems({ template_text: "{{会社名} 御中\n" + okTpl }).some((x) => x.includes("「{{会社名}」")));
  ok("文面: 全角の ｛｛会社名｝｝ を止める", templateProblems({ template_text: "｛｛会社名｝｝ 御中\n" + okTpl }).length > 0);
  eq("文面: 保存時に全角の二重波括弧を半角にそろえる", normalizeTemplateBraces("｛｛会社名｝｝ ｛{担当者}｝ ｛飾り｝"), "{{会社名}} {{担当者}} ｛飾り｝");
  eq("文面: そろえたあとは問題なし", templateProblems({ template_text: normalizeTemplateBraces("｛｛会社名｝｝ 御中\n" + okTpl) }), []);
  eq("文面: 空白入り {{ 会社名 }} は使える", templateProblems({ template_text: "{{ 会社名 }} 御中\n" + okTpl }), []);
  ok("文面: 本文が空なら止める", templateProblems({ subject_text: "ご案内", template_text: "  " }).some((x) => x.includes("本文が空")));
  eq("文面: A/Bを使わないときは本文Bを見ない", templateProblems({ template_text: okTpl, template_b: "【ここに】", ab_enabled: 0 }), []);
  ok("文面: A/Bを使うときは本文Bと件名Bも見る", templateProblems({ template_text: okTpl, template_b: "{{企業}}", subject_b: "【ここに件名】", ab_enabled: 1 }).length === 2);
  ok("文面: 件名の別案も見る", templateProblems({ template_text: okTpl, subject_alts: "ご案内\n【ここに別案】" }).some((x) => x.startsWith("件名の別案")));
  // 差し込み名の一覧は message.ts の buildVars から取っている。実際に置き換わる名前と一致すること
  {
    const vars = { ...buildVars({ company_name: "A社", industry: "", sub_industry: "", prefecture: "", representative: "" }, { company: "B社", person: "田中", email: "", tel: "", url: "" } as never), 資料リンク: "", AI冒頭: "" };
    ok("文面: 一覧の名前はすべて置き換わる", TEMPLATE_VARS.every((v) => !renderTemplate(`{{${v}}}`, vars).includes("{{")));
    ok("文面: ボタンの名前は一覧の中にある", TEMPLATE_VAR_BUTTONS.length >= 10 && TEMPLATE_VAR_BUTTONS.every((v) => TEMPLATE_VARS.includes(v)));
  }
  // ひな形: 書き換える所はすべて【ここに…】の形（検査に掛かるように）。【ここに】を埋めれば問題が残らない
  ok("ひな形: 【 】はすべて【ここに…】", TEMPLATE_LIBRARY.every((t) => !/【(?!ここに)/.test(t.subject + t.body)), TEMPLATE_LIBRARY.filter((t) => /【(?!ここに)/.test(t.subject + t.body)).map((t) => t.id).join(","));
  ok("ひな形: 【ここに】を埋めれば問題なし", TEMPLATE_LIBRARY.every((t) => templateProblems({ subject_text: t.subject.replace(/【ここに[^】]*】/g, "X"), template_text: t.body.replace(/【ここに[^】]*】/g, "X") }).length === 0));

  // 「今日」の数は上限の判定と同じ（戻りメールで失敗に変わった分も数える）
  eq("今日: 別名付きの条件", sentTodaySql("j."), SENT_TODAY_SQL.replace(/sent_at/g, "j.sent_at"));
  const sid = Number(db.prepare("INSERT INTO sender_profiles(label, company, person, email) VALUES('s2','テスト社','担当','me2@example.jp')").run().lastInsertRowid);
  const mk = (o: Record<string, unknown> = {}) => {
    const c = { name: "進まない理由", status: "running", mode: "template", channel: "form_first", weekdays_only: 0, send_window_start: 0, send_window_end: 24, daily_limit: 100, email_daily_limit: 100, owner_user_id: null, ...o };
    const keys = Object.keys(c);
    return Number(db.prepare(`INSERT INTO form_campaigns(sender_id, ${keys.join(",")}) VALUES(?, ${keys.map(() => "?").join(",")})`).run(sid, ...Object.values(c) as never[]).lastInsertRowid);
  };
  const job = (cid: number, o: Record<string, unknown> = {}) => {
    const j = { company_name: "株式会社テスト", domain: `t${Math.random().toString(36).slice(2, 8)}.example.jp`, status: "queued", channel: "form", ...o };
    const keys = Object.keys(j);
    return Number(db.prepare(`INSERT INTO form_jobs(campaign_id, ${keys.join(",")}) VALUES(?, ${keys.map(() => "?").join(",")})`).run(cid, ...Object.values(j) as never[]).lastInsertRowid);
  };
  const camp = (id: number) => db.prepare("SELECT * FROM form_campaigns WHERE id=?").get(id) as never;
  {
    const cid = mk();
    job(cid, { status: "sent", sent_at: new Date().toISOString().replace("T", " ").slice(0, 19) });
    job(cid, { status: "failed", channel: "email", sent_at: new Date().toISOString().replace("T", " ").slice(0, 19), result_text: "戻りメール" });
    eq("今日: 戻りメールで失敗に変わった分も数える", [sentToday(cid, "form"), sentToday(cid, "email")], [1, 1]);
    eq("進まない理由: 待機が無ければ無し", ctx.campaignStall(camp(cid)), null);
    job(cid, { channel: "email", retry_after: "2999-01-01 00:00:00" });
    eq("進まない理由: 再送待ちだけなら再送待ち", ctx.campaignStall(camp(cid))?.kind, "retry");
  }
  {
    const cid = mk({ daily_limit: 1 });
    job(cid, { status: "sent", sent_at: new Date().toISOString().replace("T", " ").slice(0, 19) });
    job(cid);
    const st = ctx.campaignStall(camp(cid));
    eq("進まない理由: フォームの上限", [st?.kind, st?.blocking], ["limit", true]);
  }
  {
    const h = new Date(Date.now() + 9 * 3600_000).getUTCHours();
    const cid = h < 23 ? mk({ send_window_start: h + 1, send_window_end: 24 }) : mk({ send_window_start: 0, send_window_end: 1 });
    job(cid);
    const st = ctx.campaignStall(camp(cid));
    ok("進まない理由: 時間帯の外", st?.kind === "window" && st.text.includes("次の送信は"), JSON.stringify(st));
  }
  {
    const cid = mk({ mode: "ai" });
    job(cid);
    db.prepare("INSERT INTO settings(key,value) VALUES('ai_pause',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify({ until: Date.now() + 10 * 60_000, reason: "混雑" }));
    eq("進まない理由: AIの一時停止", ctx.campaignStall(camp(cid))?.kind, "ai");
    db.prepare("DELETE FROM settings WHERE key='ai_pause'").run();
  }
  {
    // worker が自動で止めたとき（pause_reason がまだ無い版）: 待機に戻した会社の結果の文から理由を拾い、直すボタンを付ける
    const cid = mk({ status: "paused" });
    job(cid, { result_text: `文面の差し込みに間違いがあるため待機に戻しました${ctx.AUTO_PAUSE_MARK}: 差し込みが置き換わっていません: {{企業}}` });
    const st = ctx.campaignStall(camp(cid));
    ok("進まない理由: 自動の一時停止の理由と直す先", st?.kind === "auto" && st.text.includes("{{企業}}") && st.href === `/campaigns/${cid}/edit#tpl`, JSON.stringify(st));
    db.prepare("UPDATE form_campaigns SET pause_reason='AIで文面を作れないため: APIキーが正しくありません' WHERE id=?").run(cid);
    eq("進まない理由: pause_reason があればそれを使う（管理者）", ctx.campaignStall(camp(cid), { admin: true })?.href, "/settings#s-ai");
    {
      // 一般ユーザーは /settings を開けない（403）。開けないボタンを出さず、管理者に頼むよう言う
      const st2 = ctx.campaignStall(camp(cid));
      ok("進まない理由: 一般ユーザーにはAIの設定のボタンを出さない", st2?.kind === "auto" && !st2.href && !st2.action && st2.text.includes("管理者に"), JSON.stringify(st2));
    }
    // 文面の間違いの説明に「AI」の文字が入っていても（{{AI}} の書き間違い）、AIの設定へは案内しない
    db.prepare("UPDATE form_campaigns SET pause_reason='文面に直す所があるため: 件名の差し込みが置き換わっていません: {{AI}}' WHERE id=?").run(cid);
    eq("進まない理由: 文面の間違いはAIの設定へ案内しない", ctx.campaignStall(camp(cid), { admin: true })?.href, `/campaigns/${cid}/edit#tpl`);
    db.prepare("UPDATE form_campaigns SET status='paused', pause_reason='' WHERE id=?").run(cid);
    db.prepare("UPDATE form_jobs SET result_text='' WHERE campaign_id=?").run(cid);
    eq("進まない理由: 手で止めたものは自動停止と言わない", ctx.campaignStall(camp(cid)), null);
  }

  // ---- 3周目: 文面の検査を「止める／知らせるだけ」に分ける・送る直前の検査（lintMessage）と食い違わない ----
  {
    const { templateCheck, campaignStatusTag } = await import("../src/ui/parts.js");
    const { lintMessage } = await import("../src/message.js");
    type F = Parameters<typeof templateCheck>[0];
    // 送る直前の検査で止まるか（message.ts の composeMessage と worker の lintMessage と同じ流れ）。
    // 全文AIでも、AIが使えないとき（キー無し・月の上限）は本文をそのまま差し込んで送るので、本文も見る
    const vars = { ...buildVars({ company_name: "A社", industry: "IT", sub_industry: "", prefecture: "東京都", representative: "山田" }, { company: "B社", person: "田中", email: "me@example.jp", tel: "03", url: "https://b.example.jp" } as never), 資料リンク: "", AI冒頭: "冒頭" };
    const sendStops = (c: F) => {
      const useB = Number(c.ab_enabled ?? 0) === 1 && String(c.template_b ?? "").trim() !== "";
      const subjects = [c.subject_text || "サービスのご案内", ...String(c.subject_alts ?? "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean), ...(useB && String(c.subject_b ?? "").trim() ? [String(c.subject_b)] : [])];
      const bodies = [String(c.template_text ?? ""), ...(useB ? [String(c.template_b)] : [])];
      return subjects.some((s) => bodies.some((b) => lintMessage(renderTemplate(b, vars), renderTemplate(s, vars)).some((l) => l.level === "error")));
    };
    const body = (t: string) => `${t}\n${okTpl}`;
    // 指摘の表。stop=開始を止めるか、warn=警告を出すか
    const rows: { name: string; c: F; stop: boolean; warn?: boolean; has?: string }[] = [
      { name: "{重要}なお知らせ（飾り）", c: { subject_text: "ご案内", template_text: body("{重要}なお知らせ") }, stop: false, warn: true },
      { name: "料金は{月額}円（飾り）", c: { subject_text: "ご案内", template_text: body("料金は{月額}円") }, stop: false, warn: true },
      { name: "件名の {重要}（飾り）", c: { subject_text: "{重要}ご案内", template_text: okTpl }, stop: false, warn: true },
      { name: "全角の飾り ｛ご案内｝", c: { subject_text: "ご案内", template_text: body("｛ご案内｝") }, stop: false, warn: true },
      { name: "URL の中の {id}", c: { subject_text: "ご案内", template_text: body("https://ex.jp/?q={id}") }, stop: false, warn: false },
      { name: "顔文字の }", c: { subject_text: "ご案内", template_text: body("よろしくお願いします(^_^)}") }, stop: false, warn: true },
      { name: "{会社名}", c: { subject_text: "ご案内", template_text: body("{会社名} 御中") }, stop: true },
      { name: "｛会社名｝", c: { subject_text: "ご案内", template_text: body("｛会社名｝ 御中") }, stop: true },
      { name: "{{会社名}", c: { subject_text: "ご案内", template_text: body("{{会社名} 御中") }, stop: true },
      { name: "{{会社名}}}", c: { subject_text: "ご案内", template_text: body("{{会社名}}} 御中") }, stop: true },
      { name: "{{{会社名}}（送る直前でも止まる形）", c: { subject_text: "ご案内", template_text: body("{{{会社名}} 御中") }, stop: true },
      { name: "保存前からある ｛｛会社名｝｝", c: { subject_text: "ご案内", template_text: body("｛｛会社名｝｝ 御中") }, stop: true, has: "保存し直すと自動で直ります" },
      { name: "{{自社url}}", c: { subject_text: "ご案内", template_text: body("{{自社url}}") }, stop: true, has: "{{自社URL}} のことですか" },
      { name: "{{企業}}", c: { subject_text: "ご案内", template_text: body("{{企業}} 御中") }, stop: true, has: "{{会社名}} のことですか" },
      { name: "件名の {{企業}}", c: { subject_text: "{{企業}}様へ", template_text: okTpl }, stop: true },
      { name: "全文AIで本文が空", c: { mode: "ai", subject_text: "ご案内", template_text: " " }, stop: true, has: "伝えたいことを書いてください" },
      { name: "全文AIの本文の {会社名}", c: { mode: "ai", subject_text: "ご案内", template_text: "{会社名}向けのサービスです" }, stop: false, warn: true },
      { name: "全文AIでも件名の {会社名} は止める", c: { mode: "ai", subject_text: "{会社名}様へ", template_text: "サービスのご案内" }, stop: true },
      { name: "全文AIの本文の {{企業}}（AIが使えないとき送る直前で止まる）", c: { mode: "ai", subject_text: "ご案内", template_text: "{{企業}}向け" }, stop: true },
      { name: "A/Bで本文Bが空なら件名Bは見ない", c: { ab_enabled: 1, subject_text: "ご案内", template_text: okTpl, subject_b: "{{企業}}【ここに件名】", template_b: "" }, stop: false, warn: true },
      { name: "A/Bで本文Bがあれば件名Bも見る", c: { ab_enabled: 1, subject_text: "ご案内", template_text: okTpl, subject_b: "{{企業}}", template_b: okTpl }, stop: true },
      { name: "正しい文面", c: { subject_text: "{{会社名}}様へのご案内", template_text: okTpl }, stop: false, warn: false },
    ];
    for (const r of rows) {
      const tc = templateCheck(r.c);
      eq(`文面3: ${r.name} を${r.stop ? "止める" : "止めない"}`, tc.errors.length > 0, r.stop);
      if (r.warn !== undefined) eq(`文面3: ${r.name} の警告`, tc.warnings.length > 0, r.warn);
      if (r.has) ok(`文面3: ${r.name} の説明`, [...tc.errors, ...tc.warnings].some((x) => x.includes(r.has!)), JSON.stringify(tc));
      // 開始を通した文面は、送る直前の検査でも止まらない（ここが食い違うと、待機中の全社が自動停止に変わる）
      if (!tc.errors.length) eq(`文面3: ${r.name} は送る直前でも止まらない`, sendStops(r.c), false);
      // 送る直前で止まる文面は、開始の時点で止める
      if (sendStops(r.c)) eq(`文面3: ${r.name} は送る直前で止まるので開始でも止める`, tc.errors.length > 0, true);
    }
    // 波括弧のでたらめな組み合わせでも、「開始は通るのに送る直前で止まる」が無いこと
    {
      const parts = ["{", "}", "{{", "}}", "｛", "｝", "会社名", "企業", "重要", " ", "\n", "https://ex.jp/?q=", "様", "AI冒頭"];
      let seed = 12345;
      const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
      const bad: string[] = [];
      for (let i = 0; i < 3000; i++) {
        const t = Array.from({ length: 1 + Math.floor(rnd() * 8) }, () => parts[Math.floor(rnd() * parts.length)]).join("");
        const c = { subject_text: rnd() < 0.3 ? t : "ご案内", template_text: body(t) };
        if (!templateCheck(c).errors.length && sendStops(c)) bad.push(t);
      }
      eq("文面3: 開始を通る文面は送る直前でも止まらない（3,000通り）", bad.slice(0, 5), []);
    }
    // 古い呼び出し元のための templateProblems は errors と同じ
    eq("文面3: templateProblems は止める理由だけ", templateProblems({ subject_text: "ご案内", template_text: body("{重要}") }), []);

    // 状態の札: 進まない理由があれば、それを名前と説明に使う（メールの一時停止まで「時間待ち」と出ていた）
    ok("札: メールの一時停止は時間待ちと言わない", campaignStatusTag("running", false, { kind: "email", text: "メール送信を一時停止中です" }).includes("メール停止中") && campaignStatusTag("running", false, { kind: "email", text: "メール送信を一時停止中です" }).includes('title="メール送信を一時停止中です"'));
    ok("札: 再送待ち", campaignStatusTag("running", false, { kind: "retry", text: "再送待ち" }).includes(">再送待ち<"));
    ok("札: 理由が無ければ時間待ち", campaignStatusTag("running", false).includes(">時間待ち<"));

    // 進まない理由の文が二重にならない（待機に戻した会社の結果の文から拾うとき）
    {
      const cid = mk({ status: "paused", subject_text: "ご案内", template_text: "{{企業}} 御中" });
      job(cid, { result_text: `文面に直す所があるため待機に戻しました${ctx.AUTO_PAUSE_MARK}: 差し込みが置き換わっていません: {{企業}}` });
      const st = ctx.campaignStall(camp(cid));
      eq("進まない理由3: 文が二重にならない", st?.text, "自動で一時停止しました。文面に直す所があるため: 差し込みが置き換わっていません: {{企業}}");
      eq("進まない理由3: 文面を直す先は #tpl 付き", [st?.href, st?.action], [`/campaigns/${cid}/edit#tpl`, "文面を直す"]);
      // ホームでは「「X」を自動で止めました。理由」の1文にする
      const { homeCard } = await import("../src/ui/home.js");
      const html = homeCard({ senders: 1, campaigns: 1, newAppointments: [], todo: 0, runningNames: [], setupDone: 1, setupTotal: 1, todayForm: 0, todayEmail: 0, monthForm: 0, monthEmail: 0, appointments: 0, queued: 1,
        perCampaign: [{ id: cid, name: "案件A", status: "paused", running: false, todayForm: 0, todayEmail: 0, monthForm: 0, monthEmail: 0, appointments: 0, replies: 0, declines: 0, queued: 1, todo: 0, todoCaptcha: 0, capForm: 10, capEmail: 0, windowOk: true, nextStart: "", paused: "", stall: { ...st!, href: st!.href ?? "", action: st!.action ?? "" } }] } as never);
      ok("ホーム3: 自動で止めた理由が1文", html.includes("「案件A」を自動で止めました。文面に直す所があるため") && !html.includes("止まっています。自動で"), html.slice(0, 400));
      // 文面を直したら、「文面を直す」ではなく開始を促す
      db.prepare("UPDATE form_campaigns SET template_text=? WHERE id=?").run(okTpl, cid);
      const st2 = ctx.campaignStall(camp(cid));
      ok("進まない理由3: 文面が直っていれば開始を促す", st2?.kind === "auto" && !st2.href && st2.text.includes("文面は直っています"), JSON.stringify(st2));
    }
    // メールの設定不備で止まっているときは、送信者の画面へ案内する
    {
      const { setEmailPause, clearEmailPause } = await import("../src/email.js");
      const cid = mk({ channel: "email_only" });
      job(cid, { channel: "email", email: "x@example.jp" });
      const sender = db.prepare("SELECT * FROM sender_profiles WHERE id=?").get(sid) as never;
      setEmailPause(sender, 60, "送信者の住所が未登録です。送信者プロフィールに住所を登録してください");
      const st = ctx.campaignStall(camp(cid));
      eq("進まない理由3: 住所の未登録は送信者の画面へ", [st?.kind, st?.href, st?.action], ["email", "/senders", "送信者の設定を直す"]);
      setEmailPause(sender, 60, "メールサーバー（smtp.example.jp:465）に接続できませんでした");
      eq("進まない理由3: 回線の問題は詳しく見る", ctx.campaignStall(camp(cid))?.action, "詳しく見る");
      clearEmailPause(sender);
    }
    // 全文AIの開始前の確認（本物のAIには接続しない。fetch を差し替える）
    {
      const { aiStartProblem } = await import("../src/routes/campaigns.js");
      const realFetch = globalThis.fetch;
      const calls: string[] = [];
      const fake = (status: number, bodyText: string) => { globalThis.fetch = (async (u: string) => { calls.push(String(u)); return new Response(bodyText, { status }); }) as typeof fetch; };
      fake(200, JSON.stringify({ content: [{ type: "text", text: "OK" }] }));
      eq("AI開始前: キーが無ければ確かめない", [await aiStartProblem(), calls.length], [null, 0]);
      const set = (k: string, v: string) => db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(k, v);
      set("ai_provider", "anthropic"); set("ai_api_key", "test-dummy-key");
      try {
        eq("AI開始前: 通れば止めない", await aiStartProblem(), null);
        ok("AI開始前: 差し替えた fetch だけを使う", calls.length === 1 && calls[0].includes("api.anthropic.com"), calls.join(","));
        fake(401, '{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}');
        ok("AI開始前: キーの間違いは止める", String(await aiStartProblem()).includes("APIキー"));
        fake(400, '{"error":{"message":"Your credit balance is too low"}}');
        ok("AI開始前: 残高切れは止める", String(await aiStartProblem()).includes("残高"));
        fake(404, '{"error":{"type":"not_found_error","message":"model: x"}}');
        ok("AI開始前: モデルの間違いは止める", String(await aiStartProblem()).includes("モデル"));
        fake(529, '{"error":{"type":"overloaded_error"}}');
        eq("AI開始前: 混雑は止めない（送信側が待って続ける）", await aiStartProblem(), null);
      } finally {
        globalThis.fetch = realFetch;
        db.prepare("DELETE FROM settings WHERE key IN ('ai_provider','ai_api_key') OR key LIKE 'ai_usage:%'").run();
      }
    }
  }

  // お知らせ（/events）: 一般ユーザーには自分のキャンペーンのものだけ
  {
    const { eventVisibleTo } = await import("../src/routes/pages.js");
    const mine = mk({ name: "Aさんの案件", owner_user_id: 901 });
    const other = mk({ name: "Bさんの案件", owner_user_id: 902 });
    const reqA = { user: { id: 901, role: "member" } } as never, admin = { user: { id: 1, role: "admin" } } as never;
    const ev = (title: string, body: string, key?: string) => ({ title, body, key });
    ok("お知らせ: 自分のキャンペーンは出す", eventVisibleTo(reqA, ev("送信が完了しました", "「Aさんの案件」の待機がすべて終わりました")));
    ok("お知らせ: 他の人のキャンペーンは出さない", !eventVisibleTo(reqA, ev("送信が完了しました", "「Bさんの案件」の待機がすべて終わりました")));
    ok("お知らせ: key があれば key で決める", eventVisibleTo(reqA, ev("x", "", `done:${mine}`)) && !eventVisibleTo(reqA, ev("x", "", `done:${other}`)));
    ok("お知らせ: 全員のまとめは一般ユーザーに出さない", !eventVisibleTo(reqA, ev("今日のまとめ", "送信 10件")));
    ok("お知らせ: 更新のお知らせは全員に出す", eventVisibleTo(reqA, ev("新しい版に更新しました", "v1 に更新")));
    ok("お知らせ: 管理者には全部出す", eventVisibleTo(admin, ev("送信が完了しました", "「Bさんの案件」の待機がすべて終わりました")));
  }

  // 大きすぎる貼り付け: 500のエラーページではなく、元の画面に戻して日本語で知らせる
  {
    const express = (await import("express")).default;
    const http = await import("node:http");
    const app2 = express();
    app2.post("/x", ctx.uploadSingle("csv", () => "/back"), (_req, res) => { res.send("ok"); });
    const server = app2.listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    const port = (server.address() as { port: number }).port;
    const boundary = "----fotest";
    const big = "a".repeat(21 * 1024 * 1024);
    const body = `--${boundary}\r\nContent-Disposition: form-data; name="pasted"\r\n\r\n${big}\r\n--${boundary}--\r\n`;
    const r = await new Promise<{ status: number; location: string }>((resolve, reject) => {
      const rq = http.request({ host: "127.0.0.1", port, path: "/x", method: "POST", headers: { "content-type": `multipart/form-data; boundary=${boundary}`, "content-length": Buffer.byteLength(body) } }, (rs) => { rs.resume(); resolve({ status: rs.statusCode ?? 0, location: String(rs.headers.location ?? "") }); });
      rq.on("error", reject);
      rq.end(body);
    });
    server.close();
    eq("貼り付け: 大きすぎるときは元の画面に戻す", [r.status, r.location], [302, "/back"]);
    ok("貼り付け: 理由を日本語で出す", ctx.takeFlash({ path: "/back" } as never).includes("貼り付けが大きすぎます"));
  }
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

// ---- 自動起動・初回設定（3周目）: 解除の守り・登録の書き直し・「フォームだけで使う」はユーザー別 ----
// 本物の登録（~/Library/LaunchAgents など）には触らない。登録ファイルの場所は一時フォルダに差し替え、launchctl は記録するだけの偽物にする
{
  const { disableAutostart, repairAutostart, autostartContent, autostartBlockedReason } = await import("../src/autostart.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fo-autostart-"));
  const file = path.join(dir, "com.apoboost.start.plist");
  const put = (body = "old") => fs.writeFileSync(file, body);
  const calls: string[][] = [];
  const ctl = (pidRunning: boolean) => (args: string[]) => { calls.push(args); return args[0] === "list" ? `{\n\t"Label" = "com.apoboost.start";\n${pidRunning ? '\t"PID" = 4242;\n' : ""}};` : ""; };
  ok("自動起動: 単体テストの起動（一時データ）では登録しない", autostartBlockedReason() !== "");

  put();
  let r = disableAutostart({ file, platform: "darwin", env: { APOBOOST_NO_AUTOSTART: "1" }, runLaunchctl: ctl(false) });
  ok("解除: APOBOOST_NO_AUTOSTART=1 では常に断る", !r.ok && !r.needConfirm && fs.existsSync(file), JSON.stringify(r));
  r = disableAutostart({ file, platform: "darwin", env: { APOBOOST_NO_AUTOSTART: "1" }, confirmed: true, runLaunchctl: ctl(false) });
  ok("解除: APOBOOST_NO_AUTOSTART=1 では確認しても断る", !r.ok && fs.existsSync(file));
  eq("解除: 断ったときは launchctl も呼ばない", calls.length, 0);

  r = disableAutostart({ file, platform: "darwin", env: { PORT: "3299" }, runLaunchctl: ctl(false) });
  ok("解除: 別ポートの起動では、すぐ消さずに確認する", !r.ok && r.needConfirm === true && fs.existsSync(file), JSON.stringify(r));
  ok("解除: 確認の文言", r.message.includes("既定の 3210番・data/ で起動する ApoBoost のもの"), r.message);
  r = disableAutostart({ file, platform: "darwin", env: { DATA_DIR: path.join(dir, "data-dev") }, runLaunchctl: ctl(false) });
  ok("解除: 別データの起動でも確認する", r.needConfirm === true && fs.existsSync(file));
  eq("解除: 確認の前は launchctl を呼ばない", calls.length, 0);
  r = disableAutostart({ file, platform: "darwin", env: { PORT: "3299" }, confirmed: true, runLaunchctl: ctl(false) });
  ok("解除: 2回目（確認済み）で消える", r.ok && !fs.existsSync(file), JSON.stringify(r));
  eq("解除: launchd で動いていなければ、ラベルで外す", calls.map((c) => c[0]), ["list", "remove"]);

  // launchd の方で ApoBoost が動いているときは外さない（外すと動いている ApoBoost が止まる）。ファイルは消す
  put(); calls.length = 0;
  r = disableAutostart({ file, platform: "darwin", env: {}, runLaunchctl: ctl(true) });
  ok("解除: 既定の起動なら確認なしで消える", r.ok && !fs.existsSync(file));
  eq("解除: launchd の方で動いていれば remove しない", calls.map((c) => c[0]), ["list"]);
  // 自分が launchd から起動されたものなら、launchctl に触らない
  put(); calls.length = 0;
  r = disableAutostart({ file, platform: "darwin", env: { XPC_SERVICE_NAME: "com.apoboost.start" }, runLaunchctl: ctl(false) });
  ok("解除: launchd の下で動いているときもファイルは消える", r.ok && !fs.existsSync(file));
  eq("解除: launchd の下で動いているときは launchctl を呼ばない", calls.length, 0);
  // Windows はファイルを消すだけ
  put(); calls.length = 0;
  r = disableAutostart({ file, platform: "win32", env: {}, runLaunchctl: ctl(false) });
  ok("解除: Windows はファイルを消すだけ", r.ok && !fs.existsSync(file) && calls.length === 0);
  r = disableAutostart({ file, platform: "win32", env: {} });
  ok("解除: もともと無ければオフのまま", r.ok);

  // 書き直し: あるべき中身と違えば書き直す（Mac も）。別ポート・テスト用の起動では触らない
  put("<plist>古い node を指したまま</plist>");
  ok("書き直し: 別ポートの起動では書き直さない", !repairAutostart({ file, platform: "darwin", env: { PORT: "3299" } }) && fs.readFileSync(file, "utf8").includes("古い node"));
  ok("書き直し: テスト用の起動では書き直さない", !repairAutostart({ file, platform: "darwin", env: { APOBOOST_NO_AUTOSTART: "1" } }) && fs.readFileSync(file, "utf8").includes("古い node"));
  ok("書き直し: Mac で中身が違えば書き直す", repairAutostart({ file, platform: "darwin", env: {} }) && fs.readFileSync(file, "utf8") === autostartContent("darwin"));
  ok("書き直し: Mac の中身は、いまの node を指す", autostartContent("darwin").includes(`<string>${process.execPath}</string>`));
  ok("書き直し: 同じなら書き直さない", !repairAutostart({ file, platform: "darwin", env: {} }));
  put("@echo off\r\nnpm start\r\n");
  ok("書き直し: Windows も中身が違えば書き直す", repairAutostart({ file, platform: "win32", env: {} }) && fs.readFileSync(file, "utf8").includes("chcp 65001"));
  fs.rmSync(file, { force: true });
  ok("書き直し: 登録が無ければ作らない", !repairAutostart({ file, platform: "darwin", env: {} }) && !fs.existsSync(file));
  fs.rmSync(dir, { recursive: true, force: true });

  // 「フォームだけで使う」はユーザー別。1.0.14 の全員共通の値は、まだ選んでいない管理者にだけ引き継ぐ
  const { setupEmailSkippedFor, saveSetupEmailSkipped, setupEmailSkipKey } = await import("../src/settings.js");
  const admin = { id: 9001, role: "admin" }, member = { id: 9002, role: "user" }, admin2 = { id: 9003, role: "admin" };
  ok("飛ばす: 何もしていなければ済みにならない", !setupEmailSkippedFor(admin) && !setupEmailSkippedFor(member));
  saveSettingValue(S.setupEmailSkipped, true); // 1.0.14 で保存された全体の値
  ok("飛ばす: 1.0.14 の値は管理者に引き継ぐ", setupEmailSkippedFor(admin) && setupEmailSkippedFor(admin2));
  ok("飛ばす: 1.0.14 の値は一般ユーザーには引き継がない", !setupEmailSkippedFor(member));
  saveSetupEmailSkipped(admin.id, false);
  ok("飛ばす: 管理者が「やめる」を押せば、引き継いだ値より優先する", !setupEmailSkippedFor(admin) && setupEmailSkippedFor(admin2));
  saveSetupEmailSkipped(member.id, true);
  ok("飛ばす: 一般ユーザーが押しても、その人だけ", setupEmailSkippedFor(member) && !setupEmailSkippedFor(admin));
  eq("飛ばす: キーは law_ack と同じ作り", setupEmailSkipKey(7), "setup_email_skipped:7");
  saveSettingValue(S.setupEmailSkipped, false);
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

// ---- メール2周目: 宛先の表記ゆれ・アカウント側の制限・上限と二重送信・フリーメール・送信者の入力 ----
// 実在のメールサーバーにはつながない。このテストの中で 127.0.0.1 に立てる偽のSMTPサーバーだけを使う
{
  const net = await import("node:net");
  const em = await import("../src/email.js");
  const { normalizeEmail, isOptedOut, optOut, domainSuppressed, classifySmtpError, explainSmtpError, maybeAccountSide, emailPause, clearEmailPause, unreadReplyAddress } = em;
  const { processJob, sentTodayBySender, claimJobForManual } = await import("../src/worker.js");
  const { importRowsToCampaign } = await import("../src/csv.js");
  const { validateSender } = await import("../src/app/context.js");
  const db = getDb();
  const smtpE = (o: Record<string, unknown>) => Object.assign(new Error(String(o.message ?? "")), o);

  // ① 宛先アドレスの表記ゆれ
  for (const [raw, want] of [
    ["mailto:Info@A.jp", "info@a.jp"], ["<info@a.jp>", "info@a.jp"], ["info@a.jp,", "info@a.jp"], ["info@a.jp;", "info@a.jp"],
    ["info@a.jp。", "info@a.jp"], ["info@a.jp(代表)", "info@a.jp"], ["info@a.jp（代表）", "info@a.jp"], ["ｉｎｆｏ＠ａ．ｊｐ", "info@a.jp"],
    ["a@x.jp/b@x.jp", "a@x.jp"], ["a@x.jp、b@x.jp", "a@x.jp"], ["田中<info@a.jp>", "info@a.jp"], ["mailto:info@a.jp?subject=%E9%85%8D", "info@a.jp"],
    [" info@a.jp ", "info@a.jp"], ["info@a", ""], ["なし", ""], ["info@@a.jp", ""], ["", ""], ["info＠", ""],
  ] as [string, string][]) eq(`アドレスをそろえる: ${JSON.stringify(raw)}`, normalizeEmail(raw), want);

  // 飾り付きのまま保存されている古い配信停止も、照合のときにそろえて効かせる（行は書き換えない）
  db.prepare("INSERT INTO email_optouts(email, reason) VALUES('mailto:legacy@old.example','旧版の登録')").run();
  ok("配信停止: 古い飾り付きの行にも当たる", isOptedOut("legacy@old.example"));
  ok("配信停止: 照合する側の飾りもそろえる", isOptedOut("<LEGACY@old.example>,"));
  ok("配信停止: 関係ないアドレスは当たらない", !isOptedOut("other@old.example"));
  eq("配信停止: 古い行は書き換えない", (db.prepare("SELECT COUNT(*) n FROM email_optouts WHERE email='mailto:legacy@old.example'").get() as { n: number }).n, 1);
  optOut("<Stop@New.example>,", "テスト");
  ok("配信停止: そろえた形で登録する", Boolean(db.prepare("SELECT 1 FROM email_optouts WHERE email='stop@new.example'").get()));

  // 偽のSMTPサーバー。RCPT と本文（DATA）の返事を切り替えられる。受け取った宛先を控える
  type M2 = { rcpt?: string; end?: string; onData?: () => void };
  let m2: M2 = {};
  const rcpts: string[] = [];
  const server = net.createServer((sock) => {
    let buf = "", inData = false, authWait = false;
    const say = (l: string) => { if (!sock.destroyed) sock.write(l + "\r\n"); };
    say("220 fake2.local ESMTP");
    sock.on("error", () => {});
    sock.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      for (;;) {
        if (inData) {
          const end = buf.indexOf("\r\n.\r\n");
          if (end < 0) return;
          buf = buf.slice(end + 5); inData = false;
          m2.onData?.();
          say(m2.end ?? "250 2.0.0 queued");
          continue;
        }
        const i = buf.indexOf("\r\n");
        if (i < 0) return;
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        const cmd = line.toUpperCase();
        if (authWait) { authWait = false; say("235 2.7.0 ok"); }
        else if (cmd.startsWith("EHLO")) say("250-fake2.local\r\n250-AUTH PLAIN\r\n250 8BITMIME");
        else if (cmd === "AUTH PLAIN") { authWait = true; say("334 "); }
        else if (cmd.startsWith("AUTH PLAIN")) say("235 2.7.0 ok");
        else if (cmd.startsWith("RCPT TO")) { rcpts.push(line.slice(8).trim()); say(m2.rcpt ?? "250 ok"); }
        else if (cmd === "DATA") { inData = true; say("354 go"); }
        else if (cmd === "QUIT") { say("221 bye"); sock.end(); }
        else say("250 ok");
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as { port: number }).port;
  const mkSender = (label: string, smtpUser: string) => db.prepare(`INSERT INTO sender_profiles(label,company,person,email,reply_email,smtp_user,smtp_pass,smtp_host,smtp_port,address) VALUES(?,?,?,?,?,?,?,?,?,?)`)
    .run(label, "株式会社送信テスト", "田中 太郎", smtpUser, "", smtpUser, "pass", "127.0.0.1", port, "東京都港区1-1").lastInsertRowid as number;
  const sender = (id: number) => db.prepare("SELECT * FROM sender_profiles WHERE id=?").get(id) as never;
  const tpl = "{{会社名}}\nご担当者様\n\n突然のご連絡失礼いたします。株式会社送信テストの田中と申します。\n\n弊社は中小企業向けに、問い合わせ対応を楽にする仕組みをご提供しております。\n貴社の業務の手間を減らすお手伝いができればと思い、ご連絡いたしました。\n\nご興味があれば本メールにご返信ください。\n田中 太郎\n\n※本メッセージが不要な場合は、お手数ですがその旨ご連絡ください。以後のご連絡は控えさせていただきます。";
  const mkCamp = (name: string, senderId: number, limit = 100) => db.prepare(`INSERT INTO form_campaigns(name,sender_id,mode,subject_text,template_text,channel,email_warmup,email_daily_limit) VALUES(?,?,?,?,?,?,0,?)`)
    .run(name, senderId, "template", "ご案内", tpl, "email", limit).lastInsertRowid as number;
  const mkJob = (camp: number, name: string, email: string, domain = email.split("@")[1] ?? "") => db.prepare(`INSERT INTO form_jobs(campaign_id,company_name,email,domain,channel,status) VALUES(?,?,?,?,'email','queued')`)
    .run(camp, name, email, domain).lastInsertRowid as number;
  type Row = { status: string; result_text: string; email: string; domain: string; retry_after: string | null; temp_tries: number; prev_status: string; sent_at: string | null };
  const row = (id: number) => db.prepare("SELECT status, result_text, email, domain, retry_after, temp_tries, prev_status, sent_at FROM form_jobs WHERE id=?").get(id) as Row;
  const noBrowser = null as never;

  // ① 送信直前: 飾り付きの古い行も、そろえた宛先で送り、配信停止・同じアドレス・官公庁の照合が効く
  {
    const sN = mkSender("正規化", "norm@sender.example");
    const c = mkCamp("表記ゆれ", sN);
    const j1 = mkJob(c, "株式会社飾り", "mailto:Info@Norm.example", "norm.example>");
    rcpts.length = 0; m2 = {};
    await processJob(noBrowser, j1);
    eq("飾り付き: 送れる", row(j1).status, "sent");
    eq("飾り付き: そろえた宛先に送る", rcpts, ["<info@norm.example>"]);
    eq("飾り付き: そろえた形で保存し直す（返信・戻りメールの照合のため）", [row(j1).email, row(j1).domain], ["info@norm.example", "norm.example"]);
    const j2 = mkJob(c, "株式会社配信停止済み", "<legacy@old.example>");
    await processJob(noBrowser, j2);
    eq("飾り付き: 配信停止済みには送らない", row(j2).status, "skip_optout");
    const j3 = mkJob(c, "株式会社グループ別社", "INFO@norm.example", "group-other.example");
    rcpts.length = 0;
    await processJob(noBrowser, j3);
    eq("同じアドレス: 再送禁止の期間内なら送らない", row(j3).status, "skip_duplicate");
    eq("同じアドレス: 送っていない", rcpts.length, 0);
    const j4 = mkJob(c, "株式会社壊れ", "info@@broken");
    await processJob(noBrowser, j4);
    eq("読めないアドレス: 失敗にする", row(j4).status, "failed");
    ok("読めないアドレス: 理由が分かる", row(j4).result_text.includes("メールアドレスの形が正しくない"), row(j4).result_text);
    const j5 = mkJob(c, "株式会社官公庁テスト", "soumu@city.example.lg.jp", "city.example.lg.jp>");
    await processJob(noBrowser, j5);
    eq("崩れたドメインの官公庁: 送信直前に外す", row(j5).status, "skip_suppressed");
  }

  // ① ④ 取り込み: 表記ゆれ・同じアドレス・フリーメールはアドレス単位
  {
    const sI = mkSender("取り込み", "imp@sender.example");
    const c = mkCamp("取り込みテスト", sI);
    const other = mkCamp("過去の送信", sI);
    db.prepare(`INSERT INTO form_jobs(campaign_id,company_name,email,domain,channel,status,sent_at) VALUES(?,?,?,?,'email','sent',datetime('now','-3 days'))`).run(other, "前に送ったGmailの会社", "sent@gmail.com", "gmail.com");
    db.prepare(`INSERT INTO form_jobs(campaign_id,company_name,email,domain,channel,status,sent_at) VALUES(?,?,?,?,'email','sent',datetime('now','-3 days'))`).run(other, "前に送った会社", "info@sentco.example", "sentco.example");
    db.prepare("INSERT INTO form_suppressions(domain, reason) VALUES('gmail.com','断り・返信から自動判定（旧版で入った行）')").run();
    const base = { form_url: "", site_url: "", industry: "", sub_industry: "", prefecture: "", representative: "" };
    const rows = [
      { ...base, company_name: "株式会社共通A", email: "mailto:info@group.example" },
      { ...base, company_name: "株式会社共通B", email: "info@group.example", site_url: "https://b-site.example/" },
      { ...base, company_name: "太郎商店", email: "taro@gmail.com" },
      { ...base, company_name: "花子商店", email: "hanako@gmail.com" },
      { ...base, company_name: "太郎商店（重複）", email: "taro@gmail.com" },
      { ...base, company_name: "前に送ったGmailの会社（再）", email: "SENT@gmail.com" },
      { ...base, company_name: "前に送った会社の別アドレス", email: "sales@sentco.example" },
      { ...base, company_name: "配信停止の会社", email: "<legacy@old.example>" },
      { ...base, company_name: "読めない会社", email: "info＠bad" },
      { ...base, company_name: "全角の会社", email: "ｍａｉｌ＠ｚｅｎｋａｋｕ．ｅｘａｍｐｌｅ" },
    ];
    const sum = importRowsToCampaign(c, rows);
    const st = (name: string) => db.prepare("SELECT status, email, domain, result_text FROM form_jobs WHERE campaign_id=? AND company_name=?").get(c, name) as { status: string; email: string; domain: string; result_text: string } | undefined;
    eq("取り込み: mailto: を外して保存・ドメインも正しい", [st("株式会社共通A")?.email, st("株式会社共通A")?.domain], ["info@group.example", "group.example"]);
    eq("取り込み: サイトURLが違っても同じアドレスは重複", st("株式会社共通B"), undefined);
    eq("取り込み: フリーメールは別アドレスなら別の会社", [st("太郎商店")?.status, st("花子商店")?.status], ["queued", "queued"]);
    eq("取り込み: フリーメールでも同じアドレスは重複", st("太郎商店（重複）"), undefined);
    eq("取り込み: 同じアドレスに再送禁止の期間内に送っていれば外す", st("前に送ったGmailの会社（再）")?.status, "skip_duplicate");
    eq("取り込み: 会社のドメインの再送禁止は従来どおり", st("前に送った会社の別アドレス")?.status, "skip_duplicate");
    eq("取り込み: 飾り付きの配信停止にも当たる", st("配信停止の会社")?.status, "skip_optout");
    eq("取り込み: 全角のアドレスも読める", st("全角の会社")?.email, "mail@zenkaku.example");
    ok("取り込み: 読めないアドレスは理由を出す", sum.excludedRows.some((x) => x.company === "読めない会社" && x.reason.includes("形が読めない")), JSON.stringify(sum.excludedRows));
    ok("除外: 1社の断りで入ったフリーメールのドメイン行では、ほかの会社を止めない", !domainSuppressed("gmail.com"));
    db.prepare("UPDATE form_suppressions SET reason='手動で追加' WHERE domain='gmail.com'").run();
    ok("除外: 利用者が手で入れたフリーメールのドメインは従来どおり効く", domainSuppressed("gmail.com"));
    db.prepare("DELETE FROM form_suppressions WHERE domain='gmail.com'").run();
  }

  // ② アカウント側の制限: 別の宛先で3件続いたらアカウントごと止めて、全社を待機に戻す
  {
    eq("421 は拡張コードに関係なくアカウントを止める", classifySmtpError(smtpE({ code: "EENVELOPE", command: "RCPT TO", responseCode: 421, message: "421 4.3.0 Temporary System Problem" })), { kind: "pause", minutes: 30, penalty: false });
    ok("本文の段階の 5xx はアカウント側かもしれない", maybeAccountSide(smtpE({ code: "EMESSAGE", command: "DATA", responseCode: 550, message: "550 5.7.1 content rejected" })));
    ok("宛先の 5xx（RCPT）は宛先の問題", !maybeAccountSide(smtpE({ code: "EENVELOPE", command: "RCPT TO", responseCode: 550, message: "550 5.1.1 user unknown" })));
    eq("587番で STARTTLS を始められなければアカウントごと止める", classifySmtpError(smtpE({ code: "ETLS", command: "STARTTLS", responseCode: 502, message: "Error upgrading connection with STARTTLS" })).kind, "pause");
    ok("STARTTLS の説明", /STARTTLS/.test(explainSmtpError(smtpE({ code: "ETLS", command: "STARTTLS", responseCode: 502, message: "Error upgrading connection with STARTTLS" }), { smtp_host: "mail.example.jp", smtp_port: 587 } as never)));

    const sS = mkSender("制限", "streak@sender.example");
    const c = mkCamp("アカウント制限", sS);
    m2 = { rcpt: "451 4.7.500 Server busy. Please try again later" };
    const a = mkJob(c, "株式会社一", "info@one.example"), b = mkJob(c, "株式会社二", "info@two.example"), d = mkJob(c, "株式会社三", "info@three.example");
    await processJob(noBrowser, a);
    eq("一時エラー1件目: その会社だけ再送待ち", [row(a).status, Boolean(row(a).retry_after), row(a).temp_tries], ["queued", true, 1]);
    ok("一時エラー1件目: アカウントは止めない", !emailPause(sender(sS)));
    await processJob(noBrowser, b);
    ok("一時エラー2件目: まだ止めない", !emailPause(sender(sS)));
    await processJob(noBrowser, d);
    ok("一時エラー3件目（別の宛先）: アカウントを止める", Boolean(emailPause(sender(sS))));
    eq("止めたら先の2件も待機に戻し、待ち時間と回数を戻す", [row(a).status, row(a).retry_after, row(a).temp_tries, row(b).temp_tries], ["queued", null, 0, 0]);
    eq("止めたら3件目は回数を数えない", [row(d).status, row(d).temp_tries], ["queued", 0]);
    ok("止めた理由が分かる", row(d).result_text.includes("送信用アカウント側の制限"), row(d).result_text);
    clearEmailPause(sender(sS));

    // 間に送れたら数え直す
    const e1 = mkJob(c, "株式会社四", "info@four.example"), e2 = mkJob(c, "株式会社五", "info@five.example"), e3 = mkJob(c, "株式会社六", "info@six.example"), e4 = mkJob(c, "株式会社七", "info@seven.example");
    await processJob(noBrowser, e1);
    await processJob(noBrowser, e2);
    m2 = {};
    await processJob(noBrowser, e3);
    eq("間に送れた: 送れる", row(e3).status, "sent");
    m2 = { rcpt: "451 4.7.500 Server busy" };
    await processJob(noBrowser, e4);
    ok("間に送れたら数え直す（止めない）", !emailPause(sender(sS)));

    // 回数は列に持つ: 間に「一時停止のため待機」が入っても 0 に戻らない
    const t = mkJob(c, "株式会社回数", "info@tries.example");
    db.prepare("UPDATE form_jobs SET temp_tries=2, result_text='メール送信を一時停止中のため待機に戻しました: テスト' WHERE id=?").run(t);
    db.prepare("DELETE FROM settings WHERE key LIKE 'email_streak:%'").run();
    await processJob(noBrowser, t);
    eq("回数: 待機戻しを挟んでも数えている（3回目で失敗）", row(t).status, "failed");

    // 本文の段階の 5xx（内容で断られた）も、別の宛先で3件続けばアカウントごと止め、失敗にした分も戻す
    db.prepare("DELETE FROM settings WHERE key LIKE 'email_streak:%'").run();
    m2 = { end: "550 5.7.1 Message content rejected" };
    const p1 = mkJob(c, "株式会社本文一", "info@body1.example"), p2 = mkJob(c, "株式会社本文二", "info@body2.example"), p3 = mkJob(c, "株式会社本文三", "info@body3.example");
    await processJob(noBrowser, p1);
    eq("本文で断られた1件目: その会社は失敗", row(p1).status, "failed");
    await processJob(noBrowser, p2);
    await processJob(noBrowser, p3);
    const p = emailPause(sender(sS));
    ok("本文で断られた3件目: アカウントを止める", Boolean(p));
    eq("本文で断られた: 先に失敗にした分も待機に戻す", [row(p1).status, row(p2).status, row(p3).status], ["queued", "queued", "queued"]);
    ok("24時間以内に2回目なら長めに止める（3時間）", Boolean(p) && p!.until - Date.now() > 2 * 3600_000);
    clearEmailPause(sender(sS));
    m2 = {};
  }

  // ③ 画面からの送信も上限を守る・送信中は二重に送らない・送っている途中の会社も今日の数に入る
  {
    const sL = mkSender("上限", "limit@sender.example");
    const c = mkCamp("上限テスト", sL, 1);
    const first = mkJob(c, "株式会社一通目", "info@first.example");
    const before = sentTodayBySender(sL);
    let during = -1;
    m2 = { onData: () => { during = sentTodayBySender(sL); } };
    await processJob(noBrowser, first);
    m2 = {};
    eq("枠の先取り: 送っている途中も今日の数に入る", during, before + 1);
    eq("枠の先取り: 送り終わっても二重に数えない", sentTodayBySender(sL), before + 1);
    const second = mkJob(c, "株式会社二通目", "info@second.example");
    db.prepare("UPDATE form_jobs SET status='failed', result_text='メール送信エラー: テスト' WHERE id=?").run(second);
    ok("手動の再試行: 送信中でなければ始められる", claimJobForManual(second));
    eq("手動の再試行: 直前の失敗を履歴に残す", row(second).prev_status, "failed");
    ok("手動の再試行: 送信中の会社には二度押しできない", !claimJobForManual(second));
    rcpts.length = 0;
    await processJob(noBrowser, second);
    eq("上限: 画面から送っても上限なら送らず待機に戻す", row(second).status, "queued");
    ok("上限: 理由が分かる", row(second).result_text.includes("今日のメール上限"), row(second).result_text);
    eq("上限: 送っていない", rcpts.length, 0);
    // 送信済みの会社には、手動でも始められない（画面の確認からブラウザ起動までのあいだに自動の送信が終わった場合の二重送信）
    const done = mkJob(c, "株式会社送信済み", "info@done.example");
    db.prepare("UPDATE form_jobs SET status='sent' WHERE id=?").run(done);
    ok("手動の再試行: 送信済みの会社には始められない", !claimJobForManual(done) && row(done).status === "sent");
    // 手動で送り直すときは、宛先の一時エラーの回数を数え直す。結果の文に残った「再送待ち（2/2回目…」から前の回数が復活しない
    const waiting = mkJob(c, "株式会社再送待ち", "info@wait.example");
    db.prepare("UPDATE form_jobs SET status='queued', temp_tries=2, retry_after=datetime('now','+30 minutes'), result_text='一時エラーで再送待ち（2/2回目・120分後）: テスト' WHERE id=?").run(waiting);
    ok("手動の再試行: 再送待ちの会社も始められる", claimJobForManual(waiting));
    ok("手動の再試行: 回数と待ち時間と文を数え直す", row(waiting).temp_tries === 0 && row(waiting).retry_after === null && !/^一時エラーで再送待ち/.test(row(waiting).result_text), JSON.stringify(row(waiting)));
  }

  // ⑧ 返信先が送信用アカウントと違う
  eq("返信先: 送信用と違えば知らせる", unreadReplyAddress({ smtp_user: "sales@x.example", reply_email: "tanaka@x.example", email: "a@x.example" }), "tanaka@x.example");
  eq("返信先: 同じなら何もしない（大文字・小文字の違いは同じ）", unreadReplyAddress({ smtp_user: "Sales@x.example", reply_email: "", email: "sales@x.example" }), null);
  eq("返信先: ユーザー名がアドレスの形でなければ比べない", unreadReplyAddress({ smtp_user: "user123", reply_email: "", email: "a@x.example" }), null);

  // 送信者の入力: 送信用アドレス・差出人アドレス・ポート
  {
    const base = { company: "株式会社A", person: "田中 太郎", email: "a@example.jp" };
    const b1: Record<string, unknown> = { ...base, smtp_port: "４６５", from_email: "Ｓａｌｅｓ＠Ｘ．ｊｐ", smtp_user: " sales@x.jp " };
    eq("送信者: 全角のポート・アドレスは半角にそろえて受け付ける", validateSender(b1), null);
    eq("送信者: そろえた値を保存する", [b1.smtp_port, b1.from_email, b1.smtp_user], ["465", "sales@x.jp", "sales@x.jp"]);
    ok("送信者: ポートに文字は弾く", validateSender({ ...base, smtp_port: "465番" }) !== null);
    ok("送信者: ポートの範囲外は弾く", validateSender({ ...base, smtp_port: "70000" }) !== null);
    ok("送信者: 送信用アドレスの空白は弾く", validateSender({ ...base, smtp_user: "sales @x.jp" }) !== null);
    ok("送信者: 差出人アドレスの形が違えば弾く", validateSender({ ...base, from_email: "sales@" }) !== null);
    eq("送信者: アドレスの形でないユーザー名（プロバイダのID）は通す", validateSender({ ...base, smtp_user: "user123" }), null);
  }
  await new Promise<void>((r) => server.close(() => r()));
}

// ---- メール3周目: 共有のフリーメール・要対応の分類・国際化ドメイン・送り始めた印 ----
// 共有シート（Apps Script）にはつながない。fetch を差し替えて、送った中身を控えるだけにする
{
  const db = getDb();
  const share = await import("../src/share.js");
  const { normalizeEmail } = await import("../src/email.js");
  const { todoReason } = await import("../src/ui/todo.js");
  const { errKind } = await import("../src/ui/parts.js");
  const { TODO_GROUPS } = await import("../src/app/context.js");
  const { processJob } = await import("../src/worker.js");
  const { CUT_PREFIX, INTERRUPTED_PREFIX, UNVERIFIED_TEXT, NOT_SENT_LEGACY_TEXT } = await import("../src/replies.js");

  // A1 共有シートの1列目: フリーメールはアドレス（<> 付き）、それ以外はドメイン
  eq("共有: 会社のドメインはそのまま", share.sharedKeyFor("example.co.jp", "info@example.co.jp"), "example.co.jp");
  eq("共有: フリーメールはアドレスで書く", share.sharedKeyFor("gmail.com", "Taro@Gmail.com"), "<taro@gmail.com>");
  eq("共有: フリーメールでアドレスが無ければ書かない", share.sharedKeyFor("gmail.com", ""), "");
  eq("共有: 取り込み: アドレスの行はアドレスのまま（gmail.com にしない）", [share.sharedKeyOf("<taro@gmail.com>"), share.sharedKeyOf("taro@gmail.com")], ["taro@gmail.com", "taro@gmail.com"]);
  eq("共有: 取り込み: ドメイン・URLの行は従来どおり", [share.sharedKeyOf("https://www.Example.co.jp/contact"), share.sharedKeyOf("なし")], ["example.co.jp", ""]);
  // 古い版のアプリの読み方（1列目を URL として読み、読めなければそのまま）で、<> 付きのアドレスが「gmail.com」にならないこと
  const { domainOf } = await import("../src/db.js");
  const oldRead = (cell: string) => domainOf(cell) || cell.toLowerCase().trim();
  eq("共有: 古い版が <アドレス> を読んでも gmail.com にならない", oldRead("<taro@gmail.com>"), "<taro@gmail.com>");
  ok("共有: （参考）素のアドレスだと古い版は gmail.com と読んでしまう", oldRead("taro@gmail.com") === "gmail.com");

  const realFetch = globalThis.fetch;
  const posted: unknown[][] = [];
  try {
    db.prepare("INSERT INTO settings(key,value) VALUES(?,?),(?,?),(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .run(share.KEY.sentPullUrl, "https://sheet.invalid/x.csv", share.KEY.pushUrl, "https://script.invalid/exec", share.KEY.member, "自分");
    // 取り込み: 旧版が書いた gmail.com の行・アドレスの行・自分の行
    globalThis.fetch = (async (_u: unknown, init?: { method?: string; body?: string }) => {
      if (init?.method === "POST") { const b = JSON.parse(init.body ?? "{}") as { rows: unknown[][] }; posted.push(...b.rows); return new Response(JSON.stringify({ ok: true, added: b.rows.length })); }
      return new Response("ドメイン,会社名,送った人,送信日時\ngmail.com,旧版の行,佐藤,2026-09-01\n<hanako@gmail.com>,花子商店,佐藤,2026-09-02\nmine.example,自分の会社,自分,2026-09-03\nteam.example,チームの会社,佐藤,2026-09-04\n");
    }) as typeof fetch;
    await share.pullSharedSent();
    ok("共有: 取り込みでアドレスの行はアドレスで入る", Boolean(db.prepare("SELECT 1 FROM shared_sent WHERE domain='hanako@gmail.com'").get()));
    eq("共有: 旧版の gmail.com の行では、ほかの Gmail の会社を止めない", share.sharedSentBy("gmail.com", "jiro@gmail.com"), null);
    eq("共有: 同じアドレスなら止める", share.sharedSentBy("gmail.com", "Hanako@gmail.com")?.member, "佐藤");
    eq("共有: 会社のドメインは従来どおり止める", share.sharedSentBy("team.example", "")?.member, "佐藤");
    // 自分の名前の行でも、このPCに送った記録が無ければ止める（同じ共有名を使う別のPCが送った会社に、こちらからも送らないため）
    eq("共有: 自分の名前の行でも、手元に送信の記録が無ければ止める", share.sharedSentBy("mine.example", "")?.member, "自分");

    // 書き出し: id の小さいキャンペーンが後から送った分も出る（shared_at で管理）・フリーメールはアドレスで出る
    const s1 = db.prepare(`INSERT INTO sender_profiles(label,company,person,email,smtp_user,smtp_pass) VALUES('共有','株式会社共有','田中','s@share.example','s@share.example','')`).run().lastInsertRowid as number;
    const cOld = db.prepare(`INSERT INTO form_campaigns(name,sender_id,mode,subject_text,template_text) VALUES('古いキャンペーン',?,'template','件','本')`).run(s1).lastInsertRowid as number;
    const cNew = db.prepare(`INSERT INTO form_campaigns(name,sender_id,mode,subject_text,template_text) VALUES('新しいキャンペーン',?,'template','件','本')`).run(s1).lastInsertRowid as number;
    db.prepare("UPDATE form_jobs SET shared_at=datetime('now') WHERE shared_at IS NULL").run(); // これまでの行は出し終わった扱いにして、このテストの分だけ見る
    const ins = (c: number, name: string, email: string, domain: string, status: string) => db.prepare(`INSERT INTO form_jobs(campaign_id,company_name,email,domain,channel,status,sent_at) VALUES(?,?,?,?,'email',?,${status === "sent" ? "datetime('now')" : "NULL"})`).run(c, name, email, domain, status).lastInsertRowid as number;
    const waitJob = ins(cOld, "古いキャンペーンの待機", "info@later.example", "later.example", "queued");
    ins(cNew, "新しいキャンペーンの会社", "info@new.example", "new.example", "sent");
    db.prepare("UPDATE form_jobs SET shared_at=datetime('now') WHERE id=?").run(ins(cNew, "自分が送った会社", "info@mine.example", "mine.example", "sent")); // 書き出しの確認には混ぜない
    eq("共有: 自分の名前の行は、手元に送信の記録があれば見ない（手元の再送禁止で判断する）", share.sharedSentBy("mine.example", ""), null);
    ins(cNew, "Gmailの会社", "Ken@Gmail.com", "gmail.com", "sent");
    posted.length = 0;
    await share.pushSent();
    eq("共有: 書き出し: フリーメールはアドレス、それ以外はドメイン", posted.map((r) => r[0]).sort(), ["<ken@gmail.com>", "new.example"]);
    db.prepare("UPDATE form_jobs SET status='sent', sent_at=datetime('now') WHERE id=?").run(waitJob);
    posted.length = 0;
    await share.pushSent();
    eq("共有: id の小さいキャンペーンが後から送った分も書き出す", posted.map((r) => r[0]), ["later.example"]);
    posted.length = 0;
    await share.pushSent();
    eq("共有: 書き出した分は二度出さない", posted.length, 0);
  } finally {
    globalThis.fetch = realFetch;
    db.prepare("DELETE FROM settings WHERE key IN (?,?,?)").run(share.KEY.sentPullUrl, share.KEY.pushUrl, share.KEY.member);
  }

  // A2 要対応の分類
  const R = (result_text: string, status = "failed") => todoReason({ status, result_text, channel: "email" } as never);
  eq("要対応: 送信の最後で切れた → 届いたか不明", R(`${CUT_PREFIX}（送信済みか不明・要確認）: x。送信用メールの「送信済み」フォルダに…`), "unsure");
  eq("要対応: 送信中にアプリが止まった（メール） → 届いたか不明", R(`${INTERRUPTED_PREFIX}（送信済みか不明・要確認）: 送信用メールの「送信済み」フォルダ…`), "unsure");
  eq("要対応: 確認できませんでした → 届いたか不明", R(UNVERIFIED_TEXT), "unsure");
  eq("要対応: 時刻の記録が無い古い行 → 届いたか不明", R(NOT_SENT_LEGACY_TEXT), "unsure");
  eq("要対応: 宛先が存在しない → 宛先のエラー", R("メール送信エラー: 宛先のメールアドレスが存在しません（アドレスの書き間違い・退職・廃止の可能性）"), "recipient");
  eq("要対応: 受信箱がいっぱい → 宛先のエラー", R("メール送信エラー: 相手の受信箱がいっぱいで受け取ってもらえませんでした"), "recipient");
  eq("要対応: 一時エラーが続いた → 宛先のエラー", R("メール送信エラー（3回試しても一時エラーのまま）: x"), "recipient");
  eq("要対応: アドレスの形 → 宛先のエラー", R("メールアドレスの形が正しくない（info@@x）。会社の画面の「修正して再送信」で直してください"), "recipient");
  eq("要対応: ログイン拒否は従来どおりメールの設定", R("メール送信エラー: Googleにログインを拒否されました。"), "mailconfig");
  eq("要対応: 1行目が判定不能なら、ログに timeout があっても届いたか不明", R("送信後の判定不能: 完了の表示が見つからない\nclick失敗: Timeout 30000ms exceeded"), "unsure");
  const { todoActions } = await import("../src/ui/todo.js");
  const acts = (result_text: string) => todoActions({ id: 1, status: "failed", result_text, channel: "email", email: "a@b.example" } as never, "/todo");
  ok("要対応: 届いたか不明の主ボタンは「送信済みにする」", /^<span class="todoacts">[^<]*<form[^>]*mark-sent/.test(acts(`${CUT_PREFIX}（送信済みか不明・要確認）: x`)), acts(`${CUT_PREFIX}（送信済みか不明・要確認）: x`).slice(0, 200));
  ok("要対応: アドレスの形の主ボタンは「アドレスを直す」", /^<span class="todoacts"><a class="btn small" href="\/jobs\/1#fix">アドレスを直す/.test(acts("メールアドレスの形が正しくない（x）")));
  eq("errKind: 届いたか不明", errKind({ status: "failed", result_text: `${CUT_PREFIX}（送信済みか不明・要確認）: x` }), "届いたか不明（送り直す前に確認）");
  eq("errKind: 宛先のエラー", errKind({ status: "failed", result_text: "メール送信エラー: 宛先のメールアドレスが存在しません" }), "宛先のエラー");
  eq("errKind: メールの設定", errKind({ status: "failed", result_text: "メール送信エラー: Googleにログインを拒否されました" }), "メールの設定");

  // 「通信が切れて送れなかった」のまとめ（まとめて送り直す）に、届いたか分からない会社を入れない
  {
    const net = TODO_GROUPS.find((g) => g.key === "network")!;
    const cg = db.prepare(`INSERT INTO form_campaigns(name,sender_id,mode,subject_text,template_text) VALUES('まとめ',1,'template','件','本')`).run().lastInsertRowid as number;
    const f = (t: string, ch = "form") => db.prepare(`INSERT INTO form_jobs(campaign_id,company_name,domain,channel,status,result_text) VALUES(?,?,?,?,'failed',?)`).run(cg, t.slice(0, 10), "x.example", ch, t).lastInsertRowid as number;
    const unsure = f("送信後の判定不能: 完了の表示が見つからない\nclick失敗: Timeout 30000ms exceeded");
    const logOnly = f("確認画面を抜けられない\nwait: timeout");
    const real = f("例外: page.goto: Timeout 30000ms exceeded");
    const cut = f(`${CUT_PREFIX}（送信済みか不明・要確認）: メールサーバーとの通信が途中で切れました`, "email");
    const hit = (db.prepare(`SELECT j.id FROM form_jobs j WHERE j.campaign_id=? AND ${net.where}`).all(cg) as { id: number }[]).map((r) => r.id);
    eq("まとめ送り直し: 1行目が通信エラーのものだけ", hit, [real]);
    ok("まとめ送り直し: 判定不能・ログだけの timeout・送信済みか不明は入らない", ![unsure, logOnly, cut].some((id) => hit.includes(id)));
  }

  // A6 国際化ドメイン
  eq("国際化ドメイン: xn-- の形にそろえる", normalizeEmail("info@日本語.jp"), "info@xn--wgv71a119e.jp");
  eq("国際化ドメイン: mailto: 付き・全角の＠も読める", normalizeEmail("mailto:Info＠例え.テスト"), "info@xn--r8jz45g.xn--zckzah");
  eq("国際化ドメイン: ローカル部の日本語は従来どおり不可", normalizeEmail("営業@日本語.jp"), "");
  eq("国際化ドメイン: 変換できないドメインは不可", normalizeEmail("info@日本語"), "");
  eq("国際化ドメイン: 英数字のアドレスは今までどおり", normalizeEmail("Info@Example.co.jp"), "info@example.co.jp");

  // 送り始めた印（sent_by_sender・send_started_at）: 送れていない行は試みのたびに消す。送れた記録のある行は消さない
  {
    const sp = db.prepare(`INSERT INTO sender_profiles(label,company,person,email,smtp_user,smtp_pass,address) VALUES('印','株式会社印','田中','m@mark.example','m@mark.example','x','東京都')`).run().lastInsertRowid as number;
    const cm = db.prepare(`INSERT INTO form_campaigns(name,sender_id,mode,subject_text,template_text,channel) VALUES('印',?,'template','件','本','email')`).run(sp).lastInsertRowid as number;
    db.prepare("INSERT OR IGNORE INTO form_suppressions(domain, reason) VALUES('suppressed-mark.example','テスト')").run();
    const mk = (sentAt: boolean) => db.prepare(`INSERT INTO form_jobs(campaign_id,company_name,email,domain,channel,status,sent_by_sender,send_started_at,sent_at) VALUES(?,?,?,?,'email','failed',?,datetime('now'),${sentAt ? "datetime('now')" : "NULL"})`)
      .run(cm, "株式会社印", "info@suppressed-mark.example", "suppressed-mark.example", sp).lastInsertRowid as number;
    const never = mk(false), bounced = mk(true);
    await processJob(null as never, never);
    await processJob(null as never, bounced);
    const g = (id: number) => db.prepare("SELECT status, sent_by_sender, send_started_at FROM form_jobs WHERE id=?").get(id) as { status: string; sent_by_sender: number | null; send_started_at: string | null };
    eq("送り始めた印: 送れていない行は、SMTP の前に終わったら消えている", [g(never).status, g(never).sent_by_sender, g(never).send_started_at], ["skip_suppressed", null, null]);
    eq("送り始めた印: 送れた記録のある行（戻りメール等）は消さない（今日の数・返信の照合のため）", g(bounced).sent_by_sender, sp);
  }
}

// ---- アポを担当者に渡す（LINE用の文章）----
{
  const { handoffActions, handoffText } = await import("../src/ui/appointments.js");
  ok("handoff: 日程の話は日程調整", handoffActions("来週の日程をいただけますか")[0].startsWith("日程調整"));
  ok("handoff: 料金の話は単価の案内", handoffActions("費用感を教えてください").some((t) => t.startsWith("単価")));
  eq("handoff: 日程と料金の両方", handoffActions("一度お打ち合わせを。あわせてお見積りもお願いします").length, 2);
  ok("handoff: 拾えないときはお礼と日程の候補", handoffActions("ご連絡ありがとうございます")[0].includes("お礼"));
  const row = { id: 1, company_name: "株式会社サンプル", domain: "sample.example", email: "info@sample.example", channel: "email", outcome: "appointment",
    outcome_note: "自動判定（キーワード: 「日程」）2026-10-06 05:05:00 件名「Re: ご案内」 本文「…来週の日程をいただけますか。料金も知りたいです…」",
    updated_at: "2026-10-08 05:05:00", sent_at: null, campaign_id: 1, campaign_name: "春の案内", mailbox: "me@example.com", site_url: "" };
  const t = handoffText(row, "松田");
  ok("handoff: 宛名", t.startsWith("松田さん\n"));
  ok("handoff: 会社と返信日（日本時間）", t.includes("■ 会社：株式会社サンプル") && t.includes("■ 返信日：10/8（木）14:05"));
  ok("handoff: 次にやること2つ", t.includes("1. 日程調整") && t.includes("2. 単価・料金のご案内"));
  ok("handoff: 期限は次の平日（木曜の返信なら金曜）", t.includes("■ 期限：10/9（金）中"));
  ok("handoff: 名前が無ければ宛名を付けない", handoffText(row, "").startsWith("アポの対応をお願いします。"));
  const fri = handoffText({ ...row, updated_at: "2026-10-09 05:00:00" }, "松田");
  ok("handoff: 金曜の返信なら期限は月曜", fri.includes("■ 期限：10/12（月）中"));
}

if (failed) { console.error(`\nunit: ${failed}件 失敗`); process.exit(1); }
console.log("unit: ALL OK");
