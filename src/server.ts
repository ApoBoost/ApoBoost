// アプリの起動。共通処理 → 画面ごとの経路 → 待ち受け開始 → （待ち受けできたら）裏で動く仕事 の順に組み立てる。
// 経路そのものは src/routes/ に、共通の道具は src/app/context.ts にある（#139）。
// 管理画面（localhost）。
import express from "express";
import { S, setting, settingOn, settingNum, saveSettingValue } from "./settings.js";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { getDb, getSetting, setSetting as saveSetting, SCREENSHOT_DIR, MATERIAL_DIR, domainOf, jst, channelMode, STATUS_LABEL, OUTCOME_LABEL, type Campaign, type Job, type SenderProfile } from "./db.js";
import { parseCompanyCsv, parseCompanyXlsx, importRowsToCampaign, parseSuppressionCsv, parseSuppressionText, importSuppressions, type ImportSummary, type CompanyRow } from "./csv.js";
import { composeMessage, activeProvider, activeAiConfig, aiStatusLabel, testAiConnection, AI_MODELS, DEFAULT_TEMPLATE, loadNgWords, lintMessage, aiUsageThisMonth, aiMonthlyLimit } from "./message.js";
import { optOut, testSmtp, explainSmtpError, checkSmtpPassword, emailPause, clearEmailPause, senderEmailOk, buildEmailBody } from "./email.js";
import { logError, logInfo, recentLogs, clearLogs, logCounts } from "./applog.js";
import { jpError } from "./jp.js";
import { healthChecks, diagnosticsText } from "./health.js";
import { createBackup, listBackups, requestRestore, autoBackupIfDue, backupLabel, BACKUP_DIR } from "./backup.js";
import { autostartEnabled, autostartSupported, enableAutostart, disableAutostart, autostartPath, repairAutostart } from "./autostart.js";
import { releaseAwakeAll, AWAKE_NOTE } from "./awake.js";
import { licenseStatus, setLicenseKey, licenseEnforced } from "./license.js";
import { syncShare, shareConfigured, APPS_SCRIPT, KEY as SHARE_KEY } from "./share.js";
import { drainForShutdown, clearStaleRuns, runCampaign, requestStop, isRunning, isScanning, scanCampaign, processJob, inSendWindow, sentToday, sentTodayBySender, warmupLimit, effectiveEmailLimit, nextWindowText } from "./worker.js";
import { launchBrowser, openAndFill } from "./engine.js";
import { checkReplies, isCheckingReplies, replyScanStatus, verifyInterruptedEmails, learnFromCorrection, loadReplyRules, clearReplyRulesCache } from "./replies.js";
import { notify, notifyEnabled } from "./notify.js";
import { checkUpdate, applyUpdate, requestRestart, currentVersion, updateChannel } from "./update.js";
import { errorPage } from "./ui/layout.js";
import { esc, layout, lawView, todoView, todoRunView, setupView, checklistView, reportView, campaignListView, sendersView, type SenderExtra, campaignForm, campaignView, jobView, suppressionsView, settingsView, loginPage, passwordView, usersView, updateView, testView, gameView, guideView, statsView, importPreviewView, logsView, healthView, errKind, type NavUser } from "./views.js";
import { authMiddleware, renameUser, requireAdmin, startSession, endSession, findUser, verifyPassword, createUser, setPassword, listUsers, ensureFirstAdmin, randomPassword, cleanupSessions, needsFirstSetup, type AuthedRequest } from "./auth.js";
import { app, appState, ASSETS_DIR, CLEAN_PORT, navUser, notFound, shareUrls } from "./app/context.js";
import * as authRoutes from "./routes/auth.js";
import * as todoRoutes from "./routes/todo.js";
import * as jobsRoutes from "./routes/jobs.js";
import * as campaignsRoutes from "./routes/campaigns.js";
import * as sendersRoutes from "./routes/senders.js";
import * as listsRoutes from "./routes/lists.js";
import * as settingsRoutes from "./routes/settings.js";
import * as pagesRoutes from "./routes/pages.js";
import * as supportRoutes from "./routes/support.js";
import { startBackground } from "./app/background.js";

app.use(express.urlencoded({ extended: false }));
app.use("/assets", express.static(ASSETS_DIR, { maxAge: "1h" }));
// 動いているのが ApoBoost か・終了待ちか、を答える（ログイン不要）。二重起動したときに、新しい方がこれを見て
// 「すでに起動している」のか「前の ApoBoost が終わるのを待てばよい」のかを決める（下の EADDRINUSE の処理）。
// ログイン確認より前に置く（初回設定がまだのPCでは、ログイン確認が /welcome に転送してしまうため）
app.get("/healthz", (_req, res) => { res.setHeader("cache-control", "no-store"); res.json({ app: "apoboost", stopping: appState.stopping }); });
app.use(authMiddleware);

// 画面ごとの経路を登録する（順番は元の server.ts と同じ並び）
authRoutes.register();
todoRoutes.register();
jobsRoutes.register();
campaignsRoutes.register();
sendersRoutes.register();
listsRoutes.register();
settingsRoutes.register();
pagesRoutes.register();
supportRoutes.register();

// どの経路にも当たらなかったURLと、処理中に起きたエラーは、整ったページで返す（#105）
app.use((req, res) => { notFound(req, res); });

app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[apoboost] 画面の表示でエラー:", err);
  logError("page", `${req.method} ${req.path}: ${jpError(err, 300)}`);
  if (res.headersSent) return;
  let nav: NavUser = null;
  try { nav = navUser(req); } catch { /* ログイン前など */ }
  res.status(500).send(errorPage(500, nav));
});

const PORT = Number(process.env.PORT ?? 3210);
const URL_MAIN = `http://localhost:${PORT}`;

/** ダブルクリック起動（ApoBoost起動.command / .bat）のときは、ブラウザも開く。
 *  「起動したのに、どこを開けばいいか分からない」をなくすため */
function openBrowserIfAsked(): void {
  if (process.env.FO_OPEN !== "1") return;
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", URL_MAIN] : [URL_MAIN];
  try { spawn(cmd, args, { stdio: "ignore", detached: true }).unref(); } catch { /* 開けなくても起動は続ける */ }
}

/** そのポートで動いているのが ApoBoost か（ログイン画面に名前が出るか）。どの版でも /login はある */
async function apoboostAlreadyThere(): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/login`, { signal: AbortSignal.timeout(3000) });
    return (await r.text()).includes("ApoBoost");
  } catch { return false; }
}

/** 動いている ApoBoost が、終了の合図を受けて送信の終わりを待っているところか。
 *  /healthz が無い古い版・ApoBoost 以外・応答が無いときは false（これまでどおり「すでに起動しています」として扱う） */
async function previousIsStopping(): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/healthz`, { redirect: "manual", signal: AbortSignal.timeout(3000) });
    if (!r.ok) return false;
    const j = (await r.json()) as { app?: string; stopping?: boolean };
    return j.app === "apoboost" && j.stopping === true;
  } catch { return false; }
}

// 前の ApoBoost が終わるのを待つときの、待ち受けをやり直す間隔と打ち切り。
// 前の方は送信中の会社を最大120秒待ってから終わる（worker.ts の drainForShutdown）ので、それより少し長く待つ
const RETRY_EVERY_MS = 2_000;
const RETRY_FOR_MS = 130_000;
let waitingSince = 0;

// 待ち受けを先に始め、できてから裏の仕事（送信中のまま止まった会社の後始末・送信の自動再開など）を動かす。
// 以前は裏の仕事が先に動いたため、2つ目を起動すると、動いている1つ目が送信中の会社を「失敗」にしてしまい、
// さらにポートの取り合いに負けても（想定外のエラーとして握りつぶされて）プロセスが残り、送信の再開が二重に動く恐れがあった
const server = app.listen(PORT);
server.on("error", onListenError);

function onListenError(e: NodeJS.ErrnoException): void {
  if (e.code !== "EADDRINUSE") {
    console.error(`[apoboost] ポート ${PORT} で待ち受けできませんでした（${e.code ?? e.message}）。パソコンを再起動してから、もう一度起動してください`);
    process.exit(1);
  }
  // 前の ApoBoost が「送信の終わりを待って終了する」ところだった（止めてすぐ起動し直した・アップデート後に開き直した、など）。
  // 以前はここで「すでに起動しています」と言って閉じていたため、前の方が終わると何も動いていない状態になっていた。
  // 終わりしだい待ち受けできるよう、2秒おきにやり直す（130秒で打ち切り）
  if (waitingSince) {
    if (Date.now() - waitingSince < RETRY_FOR_MS) { setTimeout(() => server.listen(PORT), RETRY_EVERY_MS); return; }
    console.log("\n============================================================");
    console.log("  前の ApoBoost が終わらなかったため、起動できませんでした。");
    console.log("  しばらく待ってから、もう一度起動してください。");
    console.log("============================================================\n");
    setTimeout(() => process.exit(0), 300);
    return;
  }
  previousIsStopping().then((stopping) => {
    if (stopping) {
      waitingSince = Date.now();
      console.log("\n============================================================");
      console.log("  前の ApoBoost が送信の終わりを待っています。終わりしだい起動します。");
      console.log("  （最長で2分ほどです。この画面は閉じずにお待ちください）");
      console.log("============================================================\n");
      setTimeout(() => server.listen(PORT), RETRY_EVERY_MS);
      return;
    }
    alreadyRunning();
  });
}

/** すでに ApoBoost（またはほかのソフト）がこのポートで動いているときの案内。
 *  終了コードは 0 にする。Mac の自動起動（launchd の KeepAlive）は 0 以外で終わると起動し直すため、
 *  0 以外だと「すでに起動している」のに10秒おきに起動を繰り返してしまう。起動役（run.mjs）も 75 以外は再起動しない */
function alreadyRunning(): void {
  apoboostAlreadyThere().then((ours) => {
    console.log("\n============================================================");
    if (ours) {
      console.log("  ApoBoost はすでに起動しています。");
      console.log(`  ブラウザで ${URL_MAIN} を開いてください${process.env.FO_OPEN === "1" ? "（いま開きます）" : ""}。`);
      console.log("  この画面は閉じて構いません（動いている方の ApoBoost はそのまま動き続けます）。");
      openBrowserIfAsked();
    } else {
      console.log(`  ポート ${PORT} をほかのソフトが使っているため、ApoBoost を起動できませんでした。`);
      console.log("  パソコンを再起動してから、もう一度起動してください。");
    }
    console.log("============================================================\n");
    // ブラウザを開く命令が出ていくのを少し待ってから終わる
    setTimeout(() => process.exit(0), 300);
  });
}

server.once("listening", () => {
  if (waitingSince) console.log("[apoboost] 前の ApoBoost が終わったので、起動しました");
  startBackground();
  let first: { username: string; password: string } | null = null;
  try { first = ensureFirstAdmin(); } catch (e) { console.error(`[apoboost] 管理者を作れませんでした（ADMIN_USER / ADMIN_PASSWORD を確かめてください）: ${(e as Error).message}`); }
  if (first) {
    console.log("\n============================================================");
    console.log("  最初の管理者アカウントを作りました。控えておいてください。");
    console.log(`  ログインID : ${first.username}`);
    console.log(`  パスワード : ${first.password}`);
    if (!process.env.ADMIN_PASSWORD) console.log("  ※ 初回ログイン後にパスワード変更の画面が出ます");
    console.log("============================================================\n");
  } else if (needsFirstSetup()) {
    console.log("\n============================================================");
    console.log("  はじめての起動です。");
    console.log(`  ブラウザで ${URL_MAIN} を開き、管理者のログインIDとパスワードを決めてください。`);
    console.log("  （この設定は、このパソコンで開いたときだけできます）");
    console.log("============================================================\n");
  }
  console.log(`【フォーム＆メール】ApoBoost v${currentVersion()}: ${URL_MAIN}  (AI: ${activeProvider()}, data: ${path.resolve(process.env.DATA_DIR ?? "data")})`);
  listenClean();
  repairAutostart();
  openBrowserIfAsked();
});

// 共有用（おまけゲームを表示しない）URL。同じアプリ・同じデータ・同じログインで、別ポートから配信する。
// 人に画面を見せるときはこちらのURLを開けば、ゲームのリンクも /game も出ない。
// メインの待ち受けができてから開く（二重起動のときに、こちらだけ先に開いてしまわないように）
function listenClean(): void {
  if (process.env.GAME === "0" || process.env.GAME === "off" || CLEAN_PORT === PORT) return;
  const clean = app.listen(CLEAN_PORT, () => {
    console.log(`  ├ 共有用（ゲーム非表示）URL: http://localhost:${CLEAN_PORT}`);
  });
  clean.on("error", (e: NodeJS.ErrnoException) => {
    console.log(`  ※ 共有用URL(${CLEAN_PORT})は開けませんでした（${e.code}）。メインURLはそのまま使えます。`);
  });
}
