// 送信者
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
import { drainForShutdown, clearStaleRuns, runCampaign, requestStop, isRunning, isScanning, scanCampaign, processJob, inSendWindow, sentToday, sentTodayBySender, warmupLimit, effectiveEmailLimit, nextWindowText } from "../worker.js";
import { launchBrowser, openAndFill } from "../engine.js";
import { checkReplies, isCheckingReplies, replyScanStatus, verifyInterruptedEmails, learnFromCorrection, loadReplyRules, clearReplyRulesCache } from "../replies.js";
import { notify, notifyEnabled } from "../notify.js";
import { checkUpdate, applyUpdate, requestRestart, currentVersion, updateChannel } from "../update.js";
import { errorPage } from "../ui/layout.js";
import { esc, layout, lawView, todoView, todoRunView, setupView, checklistView, reportView, campaignListView, sendersView, type SenderExtra, campaignForm, campaignView, jobView, suppressionsView, settingsView, loginPage, passwordView, usersView, updateView, testView, gameView, guideView, statsView, importPreviewView, logsView, healthView, errKind, type NavUser } from "../views.js";
import { authMiddleware, renameUser, requireAdmin, startSession, endSession, findUser, verifyPassword, createUser, setPassword, listUsers, ensureFirstAdmin, randomPassword, cleanupSessions, type AuthedRequest } from "../auth.js";
import { app, db, redirectWith, takeFlash, me, appState, navUser, scope, ownedSender, notFound, forbidden, senderExtras, smtpCheckNote, SENDER_COLS, prefWarning, validateSender } from "../app/context.js";

/** この画面の経路を登録する。server.ts から、ログイン確認などの共通処理のあとに呼ばれる */
export function register(): void {
app.post("/senders/:id/test", async (req, res) => {
  const s = ownedSender(req, Number(req.params.id));
  if (!s) return notFound(req, res);
  try {
    if (!s.smtp_user || !s.smtp_pass) throw new Error("送信用メールアカウントが未設定です");
    const bad = checkSmtpPassword(s);
    if (bad) throw new Error(bad);
    await testSmtp(s);
    redirectWith(res, "/senders", `メールの接続テストに成功しました（${s.smtp_user}）`);
  } catch (e) {
    redirectWith(res, `/senders/${s.id}`, `接続できませんでした: ${explainSmtpError(e, s)}`);
  }
});

// ---- senders ----
app.get("/senders", (req, res) => {
  const sc = scope(req);
  const list = db.prepare(`SELECT * FROM sender_profiles WHERE ${sc.sql} ORDER BY id`).all(...sc.args) as SenderProfile[];
  // 各送信者を使っているキャンペーン数（編集・使い回しの判断材料。集計するだけの追加表示）
  const usage: Record<number, number> = {};
  for (const r of db.prepare(`SELECT sender_id, COUNT(*) n FROM form_campaigns WHERE ${sc.sql} GROUP BY sender_id`).all(...sc.args) as { sender_id: number; n: number }[]) usage[r.sender_id] = r.n;
  res.send(layout("送信者", sendersView(list, usage, senderExtras(list), Number(req.query.open) || 0), takeFlash(req), navUser(req), appState.updateReady));
});

// 編集は一覧の中で開く（#106）。古いリンクも一覧へ送る
app.get("/senders/:id", (req, res) => {
  const s = ownedSender(req, Number(req.params.id));
  if (!s) return notFound(req, res);
  const sc = scope(req);
  const list = db.prepare(`SELECT * FROM sender_profiles WHERE ${sc.sql} ORDER BY id`).all(...sc.args) as SenderProfile[];
  res.send(layout("送信者", sendersView(list, {}, senderExtras(list), s.id), takeFlash(req), navUser(req), appState.updateReady));
});

app.post("/senders", async (req, res) => {
  const err = validateSender(req.body);
  if (err) return redirectWith(res, "/senders", err);
  const vals = SENDER_COLS.map((k) => String(req.body[k] ?? "").trim());
  // チェックボックスは未チェックだと送られてこないので、値の有無で 0/1 にする
  const telReqOnly = req.body.tel_required_only ? 1 : 0;
  const replyCheck = req.body.reply_check ? 1 : 0;
  const created = db.prepare(`INSERT INTO sender_profiles(owner_user_id, ${SENDER_COLS.join(",")}, smtp_pass, tel_required_only, reply_check, tls_insecure, inbox_sort) VALUES(?, ${SENDER_COLS.map(() => "?").join(",")}, ?, ?, ?, ?, ?)`).run(me(req).id, ...vals, String(req.body.smtp_pass ?? "").trim(), telReqOnly, replyCheck, req.body.tls_insecure ? 1 : 0, req.body.inbox_sort ? 1 : 0);
  redirectWith(res, "/senders", `送信者を追加しました${prefWarning(String(req.body.address ?? ""))}${await smtpCheckNote(Number(created.lastInsertRowid))}`);
});

app.post("/senders/:id", async (req, res) => {
  if (!ownedSender(req, Number(req.params.id))) return forbidden(req, res);
  const verr = validateSender(req.body);
  if (verr) return redirectWith(res, `/senders/${Number(req.params.id)}`, verr);
  const vals = SENDER_COLS.map((k) => String(req.body[k] ?? "").trim());
  const pass = String(req.body.smtp_pass ?? "").trim();
  const telReqOnly = req.body.tel_required_only ? 1 : 0;
  // 設定を直したら、メール送信の一時停止は解除する（直したのに止まったままにならないように）
  { const old = db.prepare("SELECT * FROM sender_profiles WHERE id=?").get(Number(req.params.id)) as SenderProfile | undefined; if (old) clearEmailPause(old); }
  db.prepare(`UPDATE sender_profiles SET ${SENDER_COLS.map((c) => `${c}=?`).join(",")}, tel_required_only=?, reply_check=?, tls_insecure=?, inbox_sort=?${pass ? ", smtp_pass=?" : ""} WHERE id=?`).run(...vals, telReqOnly, req.body.reply_check ? 1 : 0, req.body.tls_insecure ? 1 : 0, req.body.inbox_sort ? 1 : 0, ...(pass ? [pass] : []), Number(req.params.id));
  redirectWith(res, "/senders", `保存しました${prefWarning(String(req.body.address ?? ""))}${await smtpCheckNote(Number(req.params.id))}`);
});
}
