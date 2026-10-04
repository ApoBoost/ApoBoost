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
  // SUPPORT_URL を空にして、テストから本物の質問箱の受け口に届かないようにする
  env: { ...process.env, PORT: String(PORT), CLEAN_PORT: "0", GAME: "0", DATA_DIR, FO_OPEN: "0", SUPPORT_URL: "" },
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
  // ---- お知らせの行き先と、取り込みプレビューの見出し表示 ----
  {
    const post = (p: string, body: string) => fetch(`${BASE}${p}`, { method: "POST", redirect: "manual", headers: { cookie, "content-type": "application/x-www-form-urlencoded" }, body });
    // 行き先に ?kind= が付いていても、お知らせが出ること（以前は出なかった）
    await post("/todo/bulk", "action=dismiss&ids=4&back=%2Ftodo%3Fkind%3Dcaptcha");
    if (!(await (await get("/todo?kind=captcha")).text()).includes("見送りにしました")) ng("行き先に ?kind が付くと、お知らせが出ません");
    await post("/todo/bulk", "action=undismiss&ids=4&back=%2Ftodo");
    await get("/todo");
    // セミコロン区切り・表記ゆれの見出しを読み、読み取れた／使わなかった見出しを出す
    const fd = new FormData();
    fd.append("pasted", "法人名;ホームページURL;担当者\nスモーク取込;https://imp.example.test/;山田");
    const pv = await (await fetch(`${BASE}/campaigns/1/import`, { method: "POST", headers: { cookie }, body: fd })).text();
    if (!pv.includes("法人名 → 企業名") || !pv.includes("ホームページURL → 企業URL") || !pv.includes("使わなかった見出し")) ng("取り込みプレビューに見出しの読み取り結果がありません");
    if ((await post("/campaigns/1/import-cancel", "")).status !== 302) ng("取り込みの取り消しが通りません");
  }
  // ホームは、キャンペーンごとに進み具合と数字を出す
  {
    const home = await (await get("/")).text();
    if (!home.includes("スモーク用キャンペーン") || !home.includes('class="hrow"')) ng("ホームにキャンペーンごとの進み具合がありません");
    if (!home.includes('id="fo-help-btn"')) ng("右下の質問箱がありません");
  }
  // 質問箱の「この会社について質問する」: その1社の状況だけを返す。失敗の種類に合った答えを選ぶ印（key）が付く
  {
    const r = await get("/support/context?job=5"); // 失敗サービス（入力エラー）
    const j = (await r.json()) as { ok: boolean; company: string; key: string; text: string };
    if (!j.ok || j.company !== "失敗サービス" || j.key !== "input") ng(`会社の状況が返りません: ${JSON.stringify(j).slice(0, 160)}`);
    if (/a@example\.test|山田|03-0000/.test(j.text)) ng("会社の状況に、送信者の個人情報が混ざっています");
    if ((await get("/support/context?job=99999")).status !== 404) ng("存在しない会社の状況が 404 になりません");
    if ((await get("/support/context?campaign=99999")).status !== 404) ng("存在しないキャンペーンの状況が 404 になりません");
    const todo = await (await get("/todo")).text();
    if (!todo.includes("foHelpOpen({jobId:")) ng("要対応に「この会社について質問する」がありません");
    const th = (await (await get("/support/thread")).json()) as { enabled: boolean };
    if (th.enabled !== false) ng("送り先が未設定なのに、担当者への質問が有効になっています");
  }
  // 起動中にエラーが出ていないこと
  if (/TypeError|ReferenceError|SqliteError/.test(out)) ng(`起動ログにエラー:\n${out.slice(-600)}`);
} catch (e) {
  ng(String((e as Error).message ?? e));
} finally {
  stop();
}

// ---- 初回設定（管理者がまだいないとき）----
// 空のデータで起動し、このPC（127.0.0.1）から開くと管理者を決める画面に案内され、決めたらそのままログインできること。
// ターミナルにだけ出していた初期パスワードを読み飛ばして入れない、をなくすための画面
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fo-smoke-first-"));
  const port = PORT + 1000;
  const base = `http://127.0.0.1:${port}`;
  // APOBOOST_NO_AUTOSTART: 初回設定の「自動で立ち上げる」で、このPCの本物の自動起動（launchd・スタートアップ）に登録しないように
  const env: NodeJS.ProcessEnv = { ...process.env, PORT: String(port), CLEAN_PORT: "0", GAME: "0", DATA_DIR: dir, FO_OPEN: "0", SUPPORT_URL: "", APOBOOST_NO_AUTOSTART: "1" };
  delete env.ADMIN_USER; delete env.ADMIN_PASSWORD; // 渡すと従来どおり自動で作ってしまうため
  const c = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], { env, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  c.stdout.on("data", (d) => (log += d));
  c.stderr.on("data", (d) => (log += d));
  const form = (p: string, body: string, headers: Record<string, string> = {}) =>
    fetch(`${base}${p}`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", ...headers }, body });
  try {
    let up = false;
    for (let i = 0; i < 60 && !up; i++) {
      try { await fetch(`${base}/login`, { redirect: "manual" }); up = true; } catch { await new Promise((r) => setTimeout(r, 500)); }
    }
    if (!up) throw new Error(`初回設定の確認用に起動できませんでした:\n${log.slice(-600)}`);
    const home = await fetch(`${base}/`, { redirect: "manual" });
    if (home.status !== 302 || home.headers.get("location") !== "/welcome") ng(`管理者がいないのに、初回設定に案内されません（HTTP ${home.status} → ${home.headers.get("location")}）`);
    const page = await (await fetch(`${base}/welcome`)).text();
    if (!page.includes("管理者のログインIDとパスワードを決めて") || !page.includes('name="password2"')) ng("初回設定の画面が出ていません");
    if (!log.includes("管理者のログインIDとパスワードを決めて")) ng("ターミナルに初回設定の案内が出ていません");
    if ((process.platform === "darwin" || process.platform === "win32") && !/name="autostart" value="1" checked/.test(page)) ng("初回設定に「パソコンの起動時に自動で立ち上げる」（既定でオン）が出ていません");
    // 動いているのが ApoBoost か・終了待ちか（ログイン不要。初回設定の前でも /welcome に転送されない）
    const hz = await fetch(`${base}/healthz`, { redirect: "manual" });
    const hzBody = hz.status === 200 ? await hz.json().catch(() => null) as { app?: string; stopping?: boolean } | null : null;
    if (hzBody?.app !== "apoboost" || hzBody.stopping !== false) ng(`/healthz が想定どおりに答えません（HTTP ${hz.status} ${JSON.stringify(hzBody)}）`);
    // 転送役（リバースプロキシ・トンネル）を通った要求は、接続元が 127.0.0.1 でもこのPCからとみなさない
    for (const h of ["x-forwarded-for", "forwarded", "via"]) {
      const viaProxy = await fetch(`${base}/welcome`, { redirect: "manual", headers: { [h]: "203.0.113.5" } });
      if (viaProxy.status !== 403) ng(`転送役の見出し（${h}）付きなのに、初回設定の画面が開けます（HTTP ${viaProxy.status}）`);
    }
    // 別のサイトから送り込まれた送信では作らない
    const evil = await form("/welcome", "username=evil&password=evil-pass-123&password2=evil-pass-123", { origin: "http://evil.example.test" });
    if (evil.status !== 403) ng(`別サイトからの初回設定が通っています（HTTP ${evil.status}）`);
    const mismatch = await form("/welcome", "username=owner&password=owner-pass-123&password2=other-pass-123", { origin: base });
    if (mismatch.status !== 400 || !(await mismatch.text()).includes("一致しません")) ng("確認用パスワードが違うのに通っています");
    // 自動起動にチェックを入れて送っても、テストの起動（APOBOOST_NO_AUTOSTART=1）では登録せず、初回設定は成功する
    const ok = await form("/welcome", "username=Owner&password=owner-pass-123&password2=owner-pass-123&autostart=1&autostart_shown=1", { origin: base });
    const ck = (ok.headers.get("set-cookie") ?? "").split(";")[0];
    if (ok.status !== 302 || !ck) ng(`初回設定で管理者を作れません（HTTP ${ok.status}）`);
    else {
      if (ok.headers.get("location") !== "/setup") ng(`初回設定のあと「はじめの設定」に進みません（→ ${ok.headers.get("location")}）`);
      const setup = await (await fetch(`${base}/setup`, { headers: { cookie: ck } })).text();
      if (!setup.includes("APOBOOST_NO_AUTOSTART")) ng("テストの起動なのに、自動起動を登録しなかった理由がお知らせに出ていません（登録してしまった恐れ）");
      if (!setup.includes("フォームだけで使う（飛ばす）")) ng("はじめの設定に「フォームだけで使う（飛ばす）」が出ていません");
      const skip = await form("/setup/skip-email", "skip=1", { cookie: ck });
      const skipped = await (await fetch(`${base}/setup`, { headers: { cookie: ck } })).text();
      if (skip.status !== 302 || !skipped.includes("飛ばすのをやめる")) ng("「フォームだけで使う（飛ばす）」を押しても、メールの手順が済みになりません");
      const top = await fetch(`${base}/`, { headers: { cookie: ck }, redirect: "manual" });
      if (top.status !== 200 || !(await top.text()).includes("ホーム")) ng(`初回設定のあと、ログインした状態でホームが開きません（HTTP ${top.status}）`);
      const again = await fetch(`${base}/welcome`, { redirect: "manual" });
      if (again.status !== 302) ng("管理者を決めたあとも、初回設定の画面が開けてしまいます");
      const relogin = await form("/login", "username=owner&password=owner-pass-123");
      if (relogin.status !== 302) ng("初回設定で決めたID・パスワードでログインできません");
    }
    // 二重起動: 同じポートでもう1つ起動したら、すぐ「すでに起動しています」と言って正常終了（終了コード0）し、動いている方は止まらない。
    // 0 以外で終わると Mac の自動起動（launchd）が10秒おきに起動し直し、ポートを使用中のまま永久に繰り返す
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), "fo-smoke-second-"));
    const c2 = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], { env: { ...env, DATA_DIR: dir2 }, stdio: ["ignore", "pipe", "pipe"] });
    let log2 = "";
    c2.stdout.on("data", (d) => (log2 += d));
    c2.stderr.on("data", (d) => (log2 += d));
    const code2 = await Promise.race([
      new Promise<number | null>((r) => c2.once("exit", (code) => r(code))),
      new Promise<string>((r) => setTimeout(() => r("timeout"), 30_000)),
    ]);
    if (code2 === "timeout") { ng("二重起動したあと、30秒たっても終了しません"); try { c2.kill("SIGKILL"); } catch { /* すでに終了 */ } }
    else if (code2 !== 0) ng(`二重起動の終了コードが 0 ではありません（${code2}）`);
    else if (!log2.includes("すでに起動しています")) ng("二重起動のとき「すでに起動しています」と案内されません");
    if (!(await fetch(`${base}/login`)).ok) ng("二重起動したら、動いていた方が止まってしまいました");
  } catch (e) {
    ng(String((e as Error).message ?? e));
  } finally {
    try { c.kill("SIGKILL"); } catch { /* すでに終了 */ }
  }
}

if (failed) { console.error(`\nsmoke: ${failed}件 失敗`); process.exit(1); }
console.log("smoke: ALL OK");
process.exit(0);
