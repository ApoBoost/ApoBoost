// 裏で動く仕事（自動バックアップ・自動更新・返信の確認・共有の同期・送信の自動再開・終了時の後片付け）。
// 管理画面（localhost）。
import express from "express";
import { S, setting, settingOn, settingNum, saveSettingValue } from "../settings.js";
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
import { autostartEnabled, autostartSupported, enableAutostart, disableAutostart, autostartPath } from "../autostart.js";
import { releaseAwakeAll, AWAKE_NOTE } from "../awake.js";
import { licenseStatus, setLicenseKey, licenseEnforced } from "../license.js";
import { syncShare, shareConfigured, APPS_SCRIPT, KEY as SHARE_KEY } from "../share.js";
import { canSendNow, drainForShutdown, clearStaleRuns, runCampaign, requestStop, isRunning, isScanning, scanCampaign, processJob, inSendWindow, sentToday, sentTodayBySender, warmupLimit, effectiveEmailLimit, nextWindowText } from "../worker.js";
import { launchBrowser, openAndFill } from "../engine.js";
import { checkReplies, isCheckingReplies, replyScanStatus, verifyInterruptedEmails, recoverStuckSending, learnFromCorrection, loadReplyRules, clearReplyRulesCache } from "../replies.js";
import { notify, notifyEnabled } from "../notify.js";
import { pollSupportReplies } from "../support.js";
import { checkUpdate, applyUpdate, requestRestart, currentVersion, updateChannel } from "../update.js";
import { errorPage } from "../ui/layout.js";
import { esc, layout, lawView, todoView, todoRunView, setupView, checklistView, reportView, campaignListView, sendersView, type SenderExtra, campaignForm, campaignView, jobView, suppressionsView, settingsView, loginPage, passwordView, usersView, updateView, testView, gameView, guideView, statsView, importPreviewView, logsView, healthView, errKind, type NavUser } from "../views.js";
import { authMiddleware, renameUser, requireAdmin, startSession, endSession, findUser, verifyPassword, createUser, setPassword, listUsers, ensureFirstAdmin, randomPassword, cleanupSessions, type AuthedRequest } from "../auth.js";
import { app, db, appState, refreshUpdateFlag, syncAllSuppressions, autoUpdateIfEnabled, dailySummaryIfDue, onReplyErr, onShareErr, onSuppErr } from "./context.js";

/** タイマーと終了時の処理を仕掛ける。起動時に1回だけ、待ち受け（listen）に成功してから呼ぶ。
 *  下の「送信中→失敗」の後始末は、ApoBoost がこのPCで自分しか動いていない前提の処理なので、
 *  二重起動（ポートが使用中）のときに走ると、動いている方の送信中の会社を失敗にしてしまう（server.ts 参照） */
export function startBackground(): void {
// ---- 起動時: 前回アプリが止まったときに「送信中」のまま残った会社 ----
// 送信の途中でアプリが止まると、そのまま「送信中」で永久に残り、再送信の対象にもならなかった。
// 送ったか送っていないか分からないため、いったん「失敗（要確認）」にする（そのまま送り直すと二重送信になり得る）。
// メールは続けて送信済みフォルダを裏で確認し、送れていれば「送信済み」、送れていなければ「待機」に自動で戻す。
// updated_at は送信を始めた時刻のまま残す（送信済みフォルダの照合に使う）。
// メールで、送信用アカウントに送り始めた印（sent_by_sender）が無い会社は、まだ送っていないので確認なしで待機に戻す（replies.ts）
{
  const stuck = recoverStuckSending();
  if (stuck.requeued) console.log(`[apoboost] 送信の前に止まっていたメール ${stuck.requeued}件を待機に戻しました（まだ送っていません）`);
  if (stuck.failed) console.log(`[apoboost] 送信中のまま止まっていた ${stuck.failed}件を「失敗（要確認）」にしました`);
  setTimeout(() => {
    verifyInterruptedEmails()
      .then((r) => { if (r.sent || r.requeued) console.log(`[apoboost] 中断したメールを送信済みフォルダで確認: 送信済み ${r.sent}件 / 未送信→待機に戻した ${r.requeued}件`); })
      .catch((e) => console.error("[interrupted]", e));
  }, 5_000);
}

// ---- 終了時（Ctrl+C・ターミナルを閉じる等）: 送信中の会社が終わるまで待ってから止める ----
// 2回目の Ctrl+C ならすぐ止める（待ちきれない場合用）
let stopping = 0;

for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(sig, () => {
    // ターミナルの Ctrl+C はアプリと起動役（run.mjs）の両方に届き、起動役からも渡されるので、2秒以内の重複は同じ1回とみなす
    if (stopping && Date.now() - stopping > 2000) process.exit(130);
    if (stopping) return;
    stopping = Date.now();
    // 終わるのを待っているあいだに起動し直された場合に、新しい方が「すでに起動しています」で閉じてしまわず、
    // こちらが終わるのを待ってから起動できるよう、/healthz で「終了待ち」と答える（server.ts）
    appState.stopping = true;
    console.log("\n[apoboost] 送信中の会社があれば終わるまで待ってから終了します（すぐ止めるにはもう一度 Ctrl+C）");
    drainForShutdown().finally(() => { releaseAwakeAll(); process.exit(0); });
  });
}

// ---- 自動バックアップ: 起動から1分後に1回、以後は1日1回 ----
// フォルダを消してデータが無くなった実例があるため、DBファイルを data/backups に複製しておく（7世代）
setTimeout(() => { autoBackupIfDue().catch((e) => logError("backup", jpError(e))); }, 60_000);

setInterval(() => { autoBackupIfDue().catch((e) => logError("backup", jpError(e))); }, 6 * 60 * 60_000);

setTimeout(() => { autoUpdateIfEnabled().catch(() => {}); }, 3 * 60_000);

setInterval(() => { autoUpdateIfEnabled().catch(() => {}); }, 6 * 60 * 60_000);

// 質問箱: 担当者からの返信を5分ごとに見に行く（返信待ちの質問があるときだけ通信する）
setInterval(() => { pollSupportReplies().catch(() => 0); }, 5 * 60_000);

setInterval(() => { try { dailySummaryIfDue(); } catch (e) { logError("summary", jpError(e)); } }, 5 * 60_000);

// ---- 想定外のエラーもログに残す（黒い画面を閉じていても後から追えるように）----
process.on("uncaughtException", (e) => {
  console.error("[apoboost] 想定外のエラー:", e);
  logError("app", `想定外のエラー: ${jpError(e, 400)}`);
});

process.on("unhandledRejection", (e) => {
  console.error("[apoboost] 処理されなかったエラー:", e);
  logError("app", `処理されなかったエラー: ${jpError(e, 400)}`);
});

setTimeout(() => { checkReplies().catch(onReplyErr); }, 60_000);

setInterval(() => { checkReplies().catch(onReplyErr); }, 15 * 60_000);

setTimeout(() => { syncShare().catch(onShareErr); }, 3 * 60_000);

setInterval(() => { syncShare().catch(onShareErr); }, 24 * 60 * 60_000);

setTimeout(() => { syncAllSuppressions().catch(onSuppErr); }, 120_000);

setInterval(() => { syncAllSuppressions().catch(onSuppErr); }, 24 * 60 * 60_000);

// ---- 簡易スケジューラ: running のキャンペーンを送信時間帯に自動再開 ----
setInterval(() => {
  // 固まったまま「実行中」で残っているものがあれば解除してから、送信を再開する
  for (const id of clearStaleRuns()) {
    console.log(`[apoboost] キャンペーン ${id} の実行が止まったままだったので、再開できるようにしました`);
    notify("送信が止まっていたので再開します", `キャンペーン #${id} が15分以上動いていなかったため、自動で再開しました`, `stale:${id}`);
  }
  const ids = db.prepare("SELECT id FROM form_campaigns WHERE status='running'").all() as { id: number }[];
  for (const { id } of ids) {
    if (isRunning(id)) continue;
    // 待機の会社がもう無ければ「完了」にする（以前は送信処理を空回しして完了にしていた）
    const left = (db.prepare("SELECT COUNT(*) n FROM form_jobs WHERE campaign_id=? AND status='queued' AND is_test=0").get(id) as { n: number }).n;
    if (left === 0) { db.prepare("UPDATE form_campaigns SET status='done' WHERE id=? AND status='running'").run(id); continue; }
  }
  for (const { id } of ids) if (!isRunning(id) && canSendNow(id)) runCampaign(id).catch((e) => { console.error(`[campaign ${id}]`, e); logError("worker", `キャンペーン #${id} を再開できませんでした: ${jpError(e)}`); });
}, 60000);

setInterval(cleanupSessions, 24 * 60 * 60 * 1000);

refreshUpdateFlag();

setInterval(refreshUpdateFlag, 6 * 60 * 60 * 1000);
}
