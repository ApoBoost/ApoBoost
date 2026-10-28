// ログイン・パスワード・ユーザー管理
// 管理画面（localhost）。
import express from "express";
import { S, setting, settingOn, settingNum, saveSettingValue, saveSetupEmailSkipped } from "../settings.js";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { getDb, getSetting, setSetting as saveSetting, SCREENSHOT_DIR, MATERIAL_DIR, domainOf, jst, channelMode, STATUS_LABEL, OUTCOME_LABEL, type Campaign, type Job, type SenderProfile } from "../db.js";
import { parseCompanyCsv, parseCompanyXlsx, importRowsToCampaign, parseSuppressionCsv, parseSuppressionText, importSuppressions, type ImportSummary, type CompanyRow } from "../csv.js";
import { composeMessage, activeProvider, activeAiConfig, aiStatusLabel, testAiConnection, AI_MODELS, DEFAULT_TEMPLATE, loadNgWords, lintMessage, aiUsageThisMonth, aiMonthlyLimit } from "../message.js";
import { optOut, testSmtp, explainSmtpError, checkSmtpPassword, emailPause, clearEmailPause, senderEmailOk, buildEmailBody } from "../email.js";
import { logError, logInfo, recentLogs, clearLogs, logCounts } from "../applog.js";
import { jpError } from "../jp.js";
import { healthChecks, diagnosticsText } from "../health.js";
import { createBackup, listBackups, requestRestore, autoBackupIfDue, backupLabel, BACKUP_DIR } from "../backup.js";
import { autostartEnabled, autostartSupported, enableAutostart, disableAutostart, autostartPath, autostartBlockedReason, ROOT as APP_ROOT } from "../autostart.js";
import { releaseAwakeAll, AWAKE_NOTE } from "../awake.js";
import { licenseStatus, setLicenseKey, licenseEnforced, licenseeLine } from "../license.js";
import { termsAgreed, agreeTerms, termsAgreedInfo } from "../terms.js";
import { syncShare, shareConfigured, APPS_SCRIPT, KEY as SHARE_KEY } from "../share.js";
import { drainForShutdown, clearStaleRuns, runCampaign, requestStop, isRunning, isScanning, scanCampaign, processJob, inSendWindow, sentToday, sentTodayBySender, warmupLimit, effectiveEmailLimit, nextWindowText } from "../worker.js";
import { launchBrowser, openAndFill } from "../engine.js";
import { checkReplies, isCheckingReplies, replyScanStatus, verifyInterruptedEmails, learnFromCorrection, loadReplyRules, clearReplyRulesCache } from "../replies.js";
import { notify, notifyEnabled } from "../notify.js";
import { checkUpdate, applyUpdate, requestRestart, currentVersion, updateChannel } from "../update.js";
import { errorPage } from "../ui/layout.js";
import { esc, layout, termsPage, lawView, todoView, todoRunView, setupView, checklistView, reportView, campaignListView, sendersView, type SenderExtra, campaignForm, campaignView, jobView, suppressionsView, settingsView, loginPage, passwordView, usersView, updateView, testView, gameView, guideView, statsView, importPreviewView, logsView, healthView, errKind, type NavUser } from "../views.js";
import { authMiddleware, renameUser, requireAdmin, startSession, endSession, findUser, verifyPassword, createUser, setPassword, listUsers, ensureFirstAdmin, randomPassword, cleanupSessions, needsFirstSetup, isLocalRequest, createFirstAdmin, defaultAdminUsername, type AuthedRequest } from "../auth.js";
import { firstAdminPage, forgotPage } from "../ui/account.js";
import crypto from "node:crypto";
import { DATA_DIR } from "../db.js";
import { app, db, redirectWith, takeFlash, me, appState, navUser, loginFails, LOGIN_WINDOW, recentFails, issuedOnce, shareUrls } from "../app/context.js";

/** 管理者がまだいないのに、このPC以外から開いたときの案内 */
const FIRST_SETUP_ELSEWHERE = "まだ管理者が決まっていません。ApoBoost を起動したパソコンで http://localhost:" + (process.env.PORT ?? 3210) + " を開き、管理者のログインIDとパスワードを決めてください";

/** 初回設定の「パソコンの起動時に自動で立ち上げる」の出し方。
 *  Mac で「ダウンロード」「デスクトップ」「書類」の中に置いていると、裏で動く node がフォルダを読めず自動起動が動かないことがあるので、
 *  そのときは一言添える（起動ファイルの案内と同じ内容） */
function welcomeAutostart(checked = true): { supported: boolean; checked: boolean; placeNote?: string } {
  const home = os.homedir();
  const watched = process.platform === "darwin" && ["Downloads", "Desktop", "Documents"].some((d) => (APP_ROOT + path.sep).startsWith(path.join(home, d) + path.sep));
  return {
    supported: autostartSupported(),
    checked,
    placeNote: watched ? "※ いまの置き場所（ダウンロード・デスクトップ・書類の中）では、自動起動が動かないことがあります。フォルダごとホームの直下に移すのがおすすめです。" : undefined,
  };
}

/** この画面の経路を登録する。server.ts から、ログイン確認などの共通処理のあとに呼ばれる */
export function register(): void {
// ---- ログイン画面 ----
app.get("/login", (req, res) => {
  if ((req as AuthedRequest).user) return res.redirect("/");
  // 管理者がまだいないのに他のPCから開いた場合: ここではログインできないので、どこで何をすればよいかを出す
  const notice = needsFirstSetup() ? FIRST_SETUP_ELSEWHERE : undefined;
  res.send(loginPage({ next: String(req.query.next ?? "/"), notice, licensee: licenseeLine() }));
});

// ---- 初回設定（管理者がまだいないとき、このPCから開いた人に管理者のIDとパスワードを決めてもらう）----
app.get("/welcome", (req, res) => {
  if (!needsFirstSetup()) return res.redirect("/");
  if (!isLocalRequest(req)) return res.status(403).send(loginPage({ notice: FIRST_SETUP_ELSEWHERE }));
  res.send(firstAdminPage({ username: defaultAdminUsername(), autostart: welcomeAutostart() }));
});

app.post("/welcome", (req, res) => {
  if (!needsFirstSetup()) return res.redirect("/login");
  if (!isLocalRequest(req)) return res.status(403).send(loginPage({ notice: FIRST_SETUP_ELSEWHERE }));
  // 別のサイトからこの画面に送り込まれた送信は受けない（他人が決めたパスワードで管理者を作られないように）。
  // いまのブラウザはフォーム送信に Origin を付けるので、付いていれば自分のURLと一致するかを見る
  const origin = String(req.headers.origin ?? "");
  if (origin && origin !== `${req.protocol}://${req.headers.host}`) return res.status(403).send(firstAdminPage({ error: "この画面は、ApoBoost の画面から開いて送ってください" }));
  const username = String(req.body.username ?? "").trim();
  const p1 = String(req.body.password ?? ""), p2 = String(req.body.password2 ?? "");
  // 入力のやり直しで画面を出し直すときは、自動起動のチェックも本人が選んだとおりに戻す
  const wantAuto = req.body.autostart === "1";
  const again = (error: string) => firstAdminPage({ username, error, autostart: welcomeAutostart(req.body.autostart_shown ? wantAuto : true) });
  if (p1 !== p2) return res.status(400).send(again("パスワードが一致しません。もう一度入力してください"));
  if (req.body.terms !== "1") return res.status(400).send(again("利用規約に同意すると、はじめられます"));
  let u: ReturnType<typeof createFirstAdmin>;
  try {
    u = createFirstAdmin(username, p1);
  } catch (e) {
    return res.status(400).send(again(String((e as Error).message)));
  }
  logInfo("auth", `最初の管理者を作りました（ログインID: ${u.username}）`);
  agreeTerms(u.username);
  startSession(res, u.id);
  // 自動起動は「おまけ」。失敗しても初回設定は成功させ、理由だけお知らせに出す。
  // テストや開発の起動（別ポート・一時データ・APOBOOST_NO_AUTOSTART=1）では、このPCの本物の自動起動に登録しない（autostart.ts）
  let autoNote = "";
  if (wantAuto && autostartSupported()) {
    const blocked = autostartBlockedReason();
    if (blocked) autoNote = `（自動起動: ${blocked}）`;
    else {
      try {
        const r = enableAutostart();
        autoNote = r.ok ? "次にパソコンを起動したときから、ApoBoost は自動で立ち上がります。" : `自動起動は設定できませんでした（${r.message}）。「動作チェック」の画面からやり直せます。`;
      } catch (e) {
        autoNote = `自動起動は設定できませんでした（${String((e as Error).message ?? e).slice(0, 120)}）。「動作チェック」の画面からやり直せます。`;
      }
    }
  }
  // そのまま「はじめの設定」へ（ホームを経由させない。最初にやることが1つに決まっているため）
  redirectWith(res, "/setup", `管理者「${u.username}」でログインしました。下の順に進めれば送信を始められます。${autoNote ? ` ${autoNote}` : ""}`);
});

// ---- 利用規約 ----
// 読むのは誰でも（ログイン前も）。同意は管理者だけ。まだ同意していない管理者は、ほかの画面に進めない（auth.ts）
app.get("/terms", (req, res) => {
  const u = (req as express.Request & { user?: { role: string } }).user;
  res.send(termsPage({ canAgree: u?.role === "admin" && !termsAgreed(), waitAdmin: Boolean(u) && u?.role !== "admin" && !termsAgreed(), agreedInfo: termsAgreedInfo() }));
});
app.post("/terms", requireAdmin, (req, res) => {
  if (req.body.agree !== "1") return res.redirect("/terms");
  agreeTerms(me(req).username);
  logInfo("auth", `利用規約（${termsAgreedInfo()?.at ?? ""}）に同意しました: ${me(req).username}`);
  redirectWith(res, "/", "利用規約に同意しました。ありがとうございます");
});

// はじめの設定:「フォームだけで使う（メールの設定は飛ばす）」。フォームにだけ送る人は、送信用メールの手順が
// 永久に「未完了」のまま残り、次の手順に進めないように見えていたため、済み扱いにできるようにする（取り消しもできる）
// 選んだ人の分だけ変える（ユーザー別。一般ユーザーが押しても、ほかの人の手順は変わらない）
app.post("/setup/skip-email", (req, res) => {
  saveSetupEmailSkipped(me(req).id, req.body.skip !== "0");
  redirectWith(res, "/setup", req.body.skip !== "0" ? "メールの設定を飛ばしました。フォームだけで送ります（あとからメールも使えます）" : "メールの設定を、はじめの設定の手順に戻しました");
});

app.post("/login", (req, res) => {
  const next = String(req.body.next || "/");
  const ip = String(req.socket.remoteAddress ?? "");
  const name = String(req.body.username ?? "").trim().toLowerCase();
  const keyUser = `${ip}|${name}`, keyIp = `${ip}|*`;
  const userFails = recentFails(keyUser), ipFails = recentFails(keyIp);
  if (userFails.length >= 5 || ipFails.length >= 10) {
    const oldest = (userFails.length >= 5 ? userFails : ipFails)[0];
    const mins = Math.max(1, Math.ceil((oldest + LOGIN_WINDOW - Date.now()) / 60_000));
    return res.status(429).send(loginPage({ error: `ログインに続けて失敗したため、しばらくログインできません（約${mins}分後にもう一度お試しください）。パスワードが分からない場合は管理者に再発行を依頼してください`, next }));
  }
  const u = findUser(String(req.body.username ?? ""));
  if (!u || !u.active || !verifyPassword(String(req.body.password ?? ""), u.password_hash)) {
    const now = Date.now();
    loginFails.set(keyUser, [...userFails, now]);
    loginFails.set(keyIp, [...ipFails, now]);
    return res.status(401).send(loginPage({ error: "ログインIDかパスワードが違います", next }));
  }
  loginFails.delete(keyUser);
  startSession(res, u.id);
  // 「//よそのサイト」や「/\\…」は、ブラウザがよそのサイトへの移動として扱うので通さない
  res.redirect(/^\/(?![\/\\])/.test(next) ? next : "/");
});

// ---- パスワードの再設定（ログインせずに、このPCから）----
// 管理者が1人だけでパスワードを忘れると、誰も再発行できず、送信の状況も見られなくなっていた。
// 確認の番号は、このPCの黒い画面と data フォルダのファイルにだけ出す。ブラウザの画面には出さないので、
// 番号を知れるのは、このPCの前にいる人（＝ファイルもデータベースも元から触れる人）だけ
const RESET_FILE = path.join(DATA_DIR, "パスワード再設定の番号.txt");
const RESET_MS = 10 * 60_000;
let resetCode: { code: string; until: number; tries: number } | null = null;
const dropResetFile = () => { try { fs.rmSync(RESET_FILE, { force: true }); } catch { /* 消せなくても、番号はもう使えない */ } };
const resetCodeLive = () => {
  if (resetCode && Date.now() > resetCode.until) { resetCode = null; dropResetFile(); }
  return resetCode;
};
/** よそのサイトから送り込まれた送信は受けない（/welcome と同じ） */
const sameOrigin = (req: express.Request) => { const o = String(req.headers.origin ?? ""); return !o || o === `${req.protocol}://${req.headers.host}`; };

app.get("/forgot", (req, res) => {
  if (needsFirstSetup()) return res.redirect("/welcome");
  if (!isLocalRequest(req)) return res.status(403).send(forgotPage({ step: "elsewhere" }));
  res.send(resetCodeLive() && req.query.enter ? forgotPage({ step: "enter", codeFile: RESET_FILE }) : forgotPage({ step: "start" }));
});

app.post("/forgot", (req, res) => {
  if (needsFirstSetup()) return res.redirect("/welcome");
  if (!isLocalRequest(req)) return res.status(403).send(forgotPage({ step: "elsewhere" }));
  if (!sameOrigin(req)) return res.status(403).send(forgotPage({ step: "start", error: "この画面は、ApoBoost の画面から開いて送ってください" }));
  if (req.body.step === "code") {
    resetCode = { code: String(crypto.randomInt(0, 1_000_000)).padStart(6, "0"), until: Date.now() + RESET_MS, tries: 0 };
    const users = (db.prepare("SELECT username, role FROM users WHERE active=1 ORDER BY role='admin' DESC, id").all() as { username: string; role: string }[])
      .map((u) => `${u.username}${u.role === "admin" ? "（管理者）" : ""}`).join("、");
    const lines = [
      "", "==================== パスワードの再設定 ====================",
      `  確認の番号: ${resetCode.code}`,
      `  ログインID: ${users}`,
      "  この番号を、ブラウザの「パスワードの再設定」の画面に入れてください（10分で使えなくなります）。",
      "  自分で押した覚えがなければ、無視してください。",
      "============================================================", "",
    ];
    console.log(lines.join("\n"));
    try { fs.writeFileSync(RESET_FILE, `\ufeff${lines.join("\r\n")}`); } catch { /* 黒い画面には出ている */ }
    logInfo("auth", "パスワードの再設定の番号を出しました（このPCから）");
    return res.redirect("/forgot?enter=1");
  }
  const live = resetCodeLive();
  const username = String(req.body.username ?? "").trim();
  const again = (error: string) => res.status(400).send(live ? forgotPage({ step: "enter", error, username, codeFile: RESET_FILE }) : forgotPage({ step: "start", error }));
  if (!live) return again("確認の番号の期限が切れました。もう一度「確認の番号を出す」を押してください");
  const code = String(req.body.code ?? "").normalize("NFKC").replace(/\D/g, "");
  if (code !== live.code) {
    // 当てずっぽうで通らないよう、5回間違えたら番号を捨てる
    if (++live.tries >= 5) { resetCode = null; dropResetFile(); return res.status(400).send(forgotPage({ step: "start", error: "確認の番号を5回間違えたので、番号を使えなくしました。もう一度「確認の番号を出す」を押してください" })); }
    return again(`確認の番号が違います（黒い画面のいちばん新しい番号を入れてください。あと${5 - live.tries}回）`);
  }
  const u = findUser(username);
  if (!u || !u.active) return again("そのログインIDは見つかりません。黒い画面に出ているログインIDを入れてください");
  const p1 = String(req.body.password ?? ""), p2 = String(req.body.password2 ?? "");
  if (p1 !== p2) return again("新しいパスワードが一致しません。もう一度入力してください");
  try {
    setPassword(u.id, p1, false);
  } catch (e) {
    return again(String((e as Error).message));
  }
  resetCode = null;
  dropResetFile();
  // ほかで開いたままのログインは閉じる（パスワードを知られて変えた場合に備えて）。ログインの失敗回数も消す
  db.prepare("DELETE FROM sessions WHERE user_id=?").run(u.id);
  for (const k of [...loginFails.keys()]) if (k.endsWith(`|${u.username}`) || k.endsWith("|*")) loginFails.delete(k);
  logInfo("auth", `パスワードを再設定しました（このPCから・ログインID: ${u.username}）`);
  startSession(res, u.id);
  redirectWith(res, "/", `パスワードを変えました。次からは新しいパスワードでログインしてください（ログインID: ${u.username}）`);
});

app.get("/logout", (req, res) => {
  endSession(req, res);
  res.redirect("/login");
});

// ---- パスワード変更（本人）----
app.get("/password", (req, res) => res.send(layout("パスワードの変更", passwordView(Boolean(me(req).must_change)), takeFlash(req), navUser(req), appState.updateReady)));

app.post("/password", (req, res) => {
  const u = me(req);
  const cur = String(req.body.current ?? "");
  const n1 = String(req.body.next1 ?? ""), n2 = String(req.body.next2 ?? "");
  if (!u.must_change && !verifyPassword(cur, u.password_hash)) return redirectWith(res, "/password", "いまのパスワードが違います");
  if (n1 !== n2) return redirectWith(res, "/password", "新しいパスワードが一致しません");
  try {
    setPassword(u.id, n1, false);
    redirectWith(res, "/", "パスワードを変更しました");
  } catch (e) {
    redirectWith(res, "/password", String((e as Error).message));
  }
});

app.get("/users", requireAdmin, (req, res) => {
  const issued = issuedOnce.get(me(req).id);
  issuedOnce.delete(me(req).id);
  res.send(layout("ユーザー管理", usersView(listUsers(), issued, shareUrls()), takeFlash(req), navUser(req), appState.updateReady));
});

app.post("/users", requireAdmin, (req, res) => {
  const password = String(req.body.password ?? "").trim() || randomPassword();
  try {
    const u = createUser(String(req.body.username ?? ""), password, {
      role: req.body.role === "admin" ? "admin" : "user",
      displayName: String(req.body.display_name ?? "").trim(),
      mustChange: true,
    });
    issuedOnce.set(me(req).id, { username: u.username, password });
    res.redirect("/users");
  } catch (e) {
    redirectWith(res, "/users", String((e as Error).message));
  }
});

// ログインIDの変更（管理者のみ）。全員が admin だと誰のアカウントか分からず、狙われやすいため変えられるようにする
app.post("/users/:id/username", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  try {
    const before = db.prepare("SELECT username FROM users WHERE id=?").get(id) as { username: string } | undefined;
    if (!before) return redirectWith(res, "/users", "そのアカウントが見つかりません");
    renameUser(id, String(req.body.username ?? ""));
    redirectWith(res, "/users", `ログインIDを「${before.username}」→「${String(req.body.username).trim().toLowerCase()}」に変更しました。本人に伝えてください`);
  } catch (e) {
    redirectWith(res, "/users", String((e as Error).message));
  }
});

app.post("/users/:id/reset", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const u = db.prepare("SELECT * FROM users WHERE id=?").get(id) as { username: string } | undefined;
  if (!u) return redirectWith(res, "/users", "見つかりません");
  const password = randomPassword();
  setPassword(id, password, true);
  db.prepare("DELETE FROM sessions WHERE user_id=?").run(id);
  issuedOnce.set(me(req).id, { username: u.username, password });
  res.redirect("/users");
});

app.post("/users/:id/toggle", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (id === me(req).id) return redirectWith(res, "/users", "自分自身は停止できません");
  db.prepare("UPDATE users SET active = CASE active WHEN 1 THEN 0 ELSE 1 END WHERE id=?").run(id);
  db.prepare("DELETE FROM sessions WHERE user_id=? AND (SELECT active FROM users WHERE id=?)=0").run(id, id);
  redirectWith(res, "/users", "変更しました");
});
}
