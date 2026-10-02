// 要対応
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
import { app, db, redirectWith, takeFlash, appState, navUser, ownedJob, todoActive, TODO_PRIO, notFound, todoBase, todoCounts, todoWhere, TODO_GROUPS, applyTodoAction, TODO_ACTION_LABEL, todoBack } from "../app/context.js";

/** この画面の経路を登録する。server.ts から、ログイン確認などの共通処理のあとに呼ばれる */
export function register(): void {
app.get("/todo", (req, res) => {
  const kind = (["captcha", "check", "failed", "noform", "dismissed"].includes(String(req.query.kind)) ? String(req.query.kind) : "") as import("../views.js").TodoKind;
  const { from, args } = todoBase(req);
  const pageSize = 50;
  const page = Math.max(1, Number(req.query.page) || 1);
  const where = todoWhere(kind);
  const total = (db.prepare(`SELECT COUNT(*) n ${from} AND ${where}`).get(...args) as { n: number }).n;
  const rows = db.prepare(`SELECT j.*, c.name campaign_name, ${TODO_PRIO} prio ${from} AND ${where}
    ORDER BY ${kind === "dismissed" ? "j.updated_at DESC" : "prio DESC, j.updated_at DESC"} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`).all(...args) as import("../views.js").TodoRow[];
  // 今日やる10件: 人が動けば送れる見込みが高いもの（画像認証・回答待ち・入力エラー）から、優先度の高い順
  const today = kind === "" ? db.prepare(`SELECT j.*, c.name campaign_name, ${TODO_PRIO} prio ${from} AND ${todoActive()}
      AND (j.status='skip_captcha' OR (j.status='failed' AND (j.result_text LIKE '要確認%' OR j.result_text LIKE '%入力エラー%' OR j.result_text LIKE '%送信ボタンが有効になりません%')))
    ORDER BY prio DESC, j.updated_at DESC LIMIT 10`).all(...args) as import("../views.js").TodoRow[] : [];
  const groups = kind === "" ? TODO_GROUPS.map((g) => ({ ...g, n: (db.prepare(`SELECT COUNT(*) n ${from} AND ${todoActive()} AND ${g.where}`).get(...args) as { n: number }).n })).filter((g) => g.n >= 3) : [];
  res.send(layout("要対応", todoView(rows, kind, todoCounts(req), { today, groups, hideDays: settingNum(S.todoHideDays, 1, 3650), page, pageSize, total }), takeFlash(req), navUser(req), appState.updateReady));
});

// まとめて操作（#114）。チェックした会社、またはそのタブの全件
app.post("/todo/bulk", (req, res) => {
  const action = String(req.body.action ?? "");
  if (!(action in TODO_ACTION_LABEL)) return redirectWith(res, "/todo", "操作を選んでください");
  let ids: number[];
  if (req.body.all === "1") {
    const { from, args } = todoBase(req);
    ids = (db.prepare(`SELECT j.id ${from} AND ${todoWhere(String(req.body.kind ?? ""))} LIMIT 5000`).all(...args) as { id: number }[]).map((r) => r.id);
  } else {
    const raw = req.body.ids;
    ids = (Array.isArray(raw) ? raw : raw != null ? [raw] : []).map((v: unknown) => Number(v)).filter((x: number) => Number.isInteger(x) && x > 0);
  }
  const done = applyTodoAction(req, action, ids);
  logInfo("todo", `要対応の一括操作: ${action} ${done}件`);
  redirectWith(res, todoBack(req, "/todo"), `${done}社を${TODO_ACTION_LABEL[action]}`);
});

// 同じ原因のまとめを、1回の操作で片づける（#117）
app.post("/todo/group", (req, res) => {
  const g = TODO_GROUPS.find((x) => x.key === String(req.body.key ?? ""));
  if (!g) return redirectWith(res, "/todo", "対象が見つかりませんでした");
  const { from, args } = todoBase(req);
  const ids = (db.prepare(`SELECT j.id ${from} AND ${todoActive()} AND ${g.where} LIMIT 5000`).all(...args) as { id: number }[]).map((r) => r.id);
  const done = applyTodoAction(req, g.action, ids);
  logInfo("todo", `原因ごとの一括操作: ${g.key} → ${g.action} ${done}件`);
  redirectWith(res, "/todo", `「${g.label}」の ${done}社を${TODO_ACTION_LABEL[g.action]}`);
});

// 1社ずつ続けて処理する（#118）
app.get("/todo/run", (req, res) => {
  const kind = String(req.query.kind ?? "captcha");
  const skipRaw = String(req.query.skip ?? "");
  const skip = skipRaw.split(",").map((x) => Number(x)).filter((x) => Number.isInteger(x) && x > 0).slice(-200);
  const { from, args } = todoBase(req);
  const where = `${todoWhere(kind)}${skip.length ? ` AND j.id NOT IN (${skip.join(",")})` : ""}`;
  const left = (db.prepare(`SELECT COUNT(*) n ${from} AND ${where}`).get(...args) as { n: number }).n;
  const j = db.prepare(`SELECT j.*, c.name campaign_name, ${TODO_PRIO} prio ${from} AND ${where} ORDER BY prio DESC, j.updated_at DESC LIMIT 1`).get(...args) as import("../views.js").TodoRow | undefined;
  res.send(layout("続けて処理する", todoRunView(j ?? null, kind, left, skip.join(",")), takeFlash(req), navUser(req), appState.updateReady));
});

// 1社の操作（見送る・戻す・メールで送る）
for (const [route, action] of [["dismiss", "dismiss"], ["undismiss", "undismiss"], ["to-email", "to_email"]] as const) {
  app.post(`/jobs/:id/${route}`, (req, res) => {
    const id = Number(req.params.id);
    const j = ownedJob(req, id);
    if (!j) return notFound(req, res);
    const done = applyTodoAction(req, action, [id]);
    redirectWith(res, todoBack(req, `/jobs/${id}`), done ? `${j.company_name} を${TODO_ACTION_LABEL[action]}` : `${j.company_name} にはメールアドレスがありません`);
  });
}
}
