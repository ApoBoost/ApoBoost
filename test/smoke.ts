// 画面のスモークテスト（#142）。
// テスト用のデータでアプリを起動し、すべての画面が開けること（白紙やエラーにならないこと）を確かめる。
// 送信はしない。実在の会社にも触れない。20秒ほどで終わる。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fo-smoke-"));
process.env.FO_NO_NOTIFY = "1"; // テスト中は通知を出さない
process.env.DATA_DIR = DATA_DIR;
const PORT = 39000 + Math.floor(Math.random() * 900);
const BASE = `http://127.0.0.1:${PORT}`;

// ---- テスト用データを入れる（ダミーの会社だけ）----
const { getDb } = await import("../src/db.js");
const { createUser } = await import("../src/auth.js");
const db = getDb();
createUser("smoke", "smoke-pass-123", { role: "admin", displayName: "スモーク", mustChange: false });
db.prepare(`INSERT INTO sender_profiles(owner_user_id,label,company,person,email,address,tel,smtp_user,smtp_pass)
  VALUES(1,'テスト送信者','株式会社テスト','山田 太郎','a@example.test','東京都港区1-1-1','03-0000-0000','a@example.test','abcdabcdabcdabcd')`).run();
db.prepare(`INSERT INTO form_campaigns(owner_user_id,name,sender_id,mode,subject_text,template_text,status)
  VALUES(1,'スモーク用キャンペーン',1,'template','ご案内','{{会社名}} 本文','paused')`).run();
const ins = db.prepare(`INSERT INTO form_jobs(campaign_id,company_name,site_url,domain,industry,prefecture,channel,email,status,result_text,sent_at,outcome,outcome_note,scan_score)
  VALUES(1,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
const rows: [string, string, string, string, string, string, string, string, string, string | null, string, string, number][] = [
  ["送信済み商事", "https://sent.example.test/", "sent.example.test", "製造", "東京都", "form", "", "sent", "完了文言を検知", "2026-09-30 01:00:00", "appointment", "自動判定（キーワード: 「日程」）2026-09-30 10:00 件名「Re: ご案内」 本文「…来週の日程をいただけますか…」", 90],
  ["断り工業", "https://no.example.test/", "no.example.test", "建設", "大阪府", "email", "info@no.example.test", "sent", "メール送信", "2026-09-30 02:00:00", "declined", "", -1],
  ["待機物産", "https://wait.example.test/", "wait.example.test", "卸売", "愛知県", "form", "", "queued", "", null, "", "", 70],
  ["認証株式会社", "https://cap.example.test/", "cap.example.test", "IT", "東京都", "form", "", "skip_captcha", "CAPTCHAあり", null, "", "", 30],
  ["失敗サービス", "https://fail.example.test/", "fail.example.test", "サービス", "福岡県", "form", "", "failed", "入力エラー: この質問は必須です", null, "", "", 60],
  ["設定ミス一号", "", "m1.example.test", "小売", "北海道", "email", "a@m1.example.test", "failed", "メール送信エラー: このアカウントは2段階認証が必要です", null, "", "", -1],
  ["設定ミス二号", "", "m2.example.test", "小売", "北海道", "email", "a@m2.example.test", "failed", "メール送信エラー: このアカウントは2段階認証が必要です", null, "", "", -1],
  ["設定ミス三号", "", "m3.example.test", "小売", "北海道", "email", "a@m3.example.test", "failed", "メール送信エラー: このアカウントは2段階認証が必要です", null, "", "", -1],
  ["フォーム無し建設", "https://nf.example.test/", "nf.example.test", "建設", "広島県", "form", "", "skip_no_form", "サイトにアクセスできない", null, "", "", 0],
];
for (const r of rows) ins.run(...r);
db.close();

// ---- アプリを起動 ----
const child = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
  env: { ...process.env, PORT: String(PORT), CLEAN_PORT: "0", GAME: "0", DATA_DIR, FO_OPEN: "0" },
  stdio: ["ignore", "pipe", "pipe"],
});
let out = "";
child.stdout.on("data", (d) => (out += d));
child.stderr.on("data", (d) => (out += d));
const stop = () => { try { child.kill("SIGKILL"); } catch { /* すでに終了 */ } };
process.on("exit", stop);

async function waitUp() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${BASE}/login`); if (r.ok) return; } catch { /* まだ */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`アプリが起動しませんでした:\n${out.slice(-800)}`);
}

let failed = 0;
const ng = (m: string) => { failed++; console.error(`NG: ${m}`); };

try {
  await waitUp();
  const login = await fetch(`${BASE}/login`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "username=smoke&password=smoke-pass-123" });
  const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
  if (!cookie) throw new Error("ログインできませんでした");
  const get = (p: string) => fetch(`${BASE}${p}`, { headers: { cookie }, redirect: "manual" });

  // [経路, 含まれているべき文字]
  const pages: [string, string][] = [
    ["/", "ホーム"],
    ["/setup", "はじめの設定"],
    ["/todo", "要対応"],
    ["/appointments", "送信済み商事"],
    ["/todo?kind=captcha", "認証株式会社"],
    ["/todo?kind=failed", "失敗サービス"],
    ["/stats", "成果"],
    ["/report", "週次レポート"],
    ["/health", "動作チェック"],
    ["/logs", "エラーログ"],
    ["/settings", "設定"],
    ["/senders", "テスト送信者"],
    ["/senders/1", "株式会社テスト"],
    ["/suppressions", "除外リスト"],
    ["/campaigns/new", "キャンペーン"],
    ["/campaigns/1", "スモーク用キャンペーン"],
    ["/campaigns/1?tab=send", "スモーク用キャンペーン"],
    ["/campaigns/1?tab=result", "送信済み商事"],
    ["/campaigns/1/edit", "スモーク用キャンペーン"],
    ["/jobs/1", "送信済み商事"],
    ["/guide", "ご利用ガイド"],
    ["/law", "特定電子メール法"],
    ["/users", "ユーザー管理"],
    ["/update", "アップデート"],
    ["/checklist", "チェックリスト"],
    ["/template.csv", "企業名"],
    ["/diagnostics.txt", "診断ファイル"],
  ];
  for (const [p, must] of pages) {
    const r = await get(p);
    const body = await r.text();
    if (r.status !== 200) { ng(`${p} → HTTP ${r.status}`); continue; }
    if (!body.includes(must)) ng(`${p} に「${must}」がありません`);
    if (/undefined|\[object Object\]|NaN(?![a-zA-Z])/.test(body.replace(/<script[\s\S]*?<\/script>/g, ""))) ng(`${p} に undefined / [object Object] / NaN が表示されています`);
  }
  // 無いページは、整ったエラーページで 404 を返す
  {
    const r = await get("/jobs/999999");
    const body = await r.text();
    if (r.status !== 404) ng(`/jobs/999999 → HTTP ${r.status}（404のはず）`);
    if (!body.includes("ホームに戻る")) ng("404ページに「ホームに戻る」がありません");
  }
  // 英語の内部値がそのまま出ていないこと（#102）
  {
    const body = await (await get("/")).text();
    if (/>\s*(paused|running|done|draft)\s*</.test(body)) ng("ホームに英語の状態（paused 等）がそのまま出ています");
    if (/>\s*(template|tpl_ai|hybrid)\s*</.test(body)) ng("ホームに英語のモード（template 等）がそのまま出ています");
  }
  // ---- 要対応の作り直し（#113〜#118）----
  {
    const post = (p: string, body: string) => fetch(`${BASE}${p}`, { method: "POST", redirect: "manual", headers: { cookie, "content-type": "application/x-www-form-urlencoded" }, body });
    let body = await (await get("/todo")).text();
    if (!body.includes('<span class="tag sending">今日</span>')) ng("要対応に「今日」の印がありません");
    if (!body.includes("同じ原因のまとめ") || !body.includes("メールの設定が原因で送れなかった")) ng("要対応に「同じ原因のまとめ」がありません");
    // 開けないサイトには「開いて入力」を出さない（#116）
    const nf = await (await get("/todo?kind=noform")).text();
    if (/フォーム無し建設[\s\S]{0,1200}開いて入力/.test(nf)) ng("開けないサイトに「開いて入力」ボタンが出ています");
    if (!nf.includes("URLを直す")) ng("開けないサイトに「URLを直す」がありません");
    // 同じ原因を1回の操作で片づける（#117）
    const r1 = await post("/todo/group", "key=mailconfig&action=requeue");
    if (r1.status !== 302) ng(`/todo/group → HTTP ${r1.status}`);
    body = await (await get("/todo?kind=failed")).text();
    if (body.includes("設定ミス一号")) ng("まとめて送り直したのに、要対応に残っています");
    // 見送る → 見送りタブに移る → 戻せる（#115）
    await post("/todo/bulk", "action=dismiss&all=1&kind=captcha&back=%2Ftodo");
    if (!(await (await get("/todo?kind=dismissed")).text()).includes("認証株式会社")) ng("見送った会社が「見送り」タブにありません");
    if ((await (await get("/todo?kind=captcha")).text()).includes("認証株式会社")) ng("見送った会社が要対応に残っています");
    await post("/todo/bulk", "action=undismiss&all=1&kind=dismissed&back=%2Ftodo");
    // 続けて処理する画面（#118）
    const run = await (await get("/todo/run?kind=captcha")).text();
    if (!run.includes("認証株式会社") || !run.includes("送信済みにして次へ")) ng("「続けて処理する」画面に会社が出ていません");
    // アポの「確認した」: 押すとメニューの数字（未確認の数）が減り、確認済みに移る。戻せる
    const badge = (html: string) => /href="\/appointments"[^>]*>アポ<span class="badge"/.test(html);
    let ap = await (await get("/appointments")).text();
    const appoId = ap.match(/\/jobs\/(\d+)\/appo-seen/)?.[1] ?? "0";
    if (!ap.includes("確認した") || !badge(ap)) ng("未確認のアポに「確認した」ボタン・メニューの数字がありません");
    if ((await post(`/jobs/${appoId}/appo-seen`, "")).status !== 302) ng("/jobs/:id/appo-seen が通りません");
    ap = await (await get("/appointments")).text();
    if (!ap.includes("確認済み（1社）") || badge(ap)) ng("確認したのに、メニューの数字が減っていません");
    await post(`/jobs/${appoId}/appo-seen`, "seen=0");
    if (!badge(await (await get("/appointments")).text())) ng("未確認に戻したのに、メニューの数字が戻りません");
  }
  // ---- キャンペーンの3タブと一覧（#98 #103）----
  {
    const prep = await (await get("/campaigns/1?tab=prep")).text();
    const res2 = await (await get("/campaigns/1?tab=result&size=50")).text();
    if (!/data-tab="prep">/.test(prep) || !/data-tab="result" hidden>/.test(prep)) ng("準備タブを開いたとき、他のタブが隠れていません");
    if (!/data-tab="result">/.test(res2)) ng("結果タブが表示されていません");
    if (!res2.includes("1 / 1 ページ")) ng("一覧にページ送りがありません");
    const list = await (await get("/campaigns")).text();
    if (!list.includes("一時停止")) ng("キャンペーン一覧の状態が日本語になっていません");
  }
  // ホームは、キャンペーンごとに進み具合と数字を出す
  {
    const home = await (await get("/")).text();
    if (!home.includes("スモーク用キャンペーン") || !home.includes('class="hrow"')) ng("ホームにキャンペーンごとの進み具合がありません");
    if (!home.includes('id="fo-help-btn"')) ng("右下の質問箱がありません");
  }
  // 起動中にエラーが出ていないこと
  if (/TypeError|ReferenceError|SqliteError/.test(out)) ng(`起動ログにエラー:\n${out.slice(-600)}`);
} catch (e) {
  ng(String((e as Error).message ?? e));
} finally {
  stop();
}

if (failed) { console.error(`\nsmoke: ${failed}件 失敗`); process.exit(1); }
console.log("smoke: ALL OK");
process.exit(0);
