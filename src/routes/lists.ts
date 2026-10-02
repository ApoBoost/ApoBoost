// 除外リスト・チーム共有・返信の確認
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
import { app, upload, db, redirectWith, takeFlash, me, appState, navUser, scope, fetchGoogleSheetCsv, suppImports, suppSyncKey, loadSuppSync, saveSuppSync, syncSuppressionsFor } from "../app/context.js";

/** この画面の経路を登録する。server.ts から、ログイン確認などの共通処理のあとに呼ばれる */
export function register(): void {
// 返信の自動確認を今すぐ実行（ふだんは15分ごとに裏で動く）
app.post("/replies/check", async (req, res) => {
  const back = /^\/campaigns\/\d+$/.test(String(req.body.back ?? "")) ? String(req.body.back) : "/";
  const r = await checkReplies().catch((e) => ({ recorded: 0, errors: [String((e as Error)?.message ?? e)] }));
  redirectWith(res, back, r.errors.length ? `返信の確認でエラー: ${r.errors.join(" / ")}` : `返信を確認しました（新しく記録した反応 ${r.recorded}件）`);
});

app.get("/suppressions", (req, res) => {
  const sc = scope(req);
  const rows = db.prepare(`SELECT * FROM form_suppressions WHERE ${sc.sql} ORDER BY id DESC LIMIT 1000`).all(...sc.args) as any[];
  const optouts = db.prepare(`SELECT * FROM email_optouts WHERE ${sc.sql} ORDER BY created_at DESC LIMIT 500`).all(...sc.args) as any[];
  const imported = suppImports.get(me(req).id);
  suppImports.delete(me(req).id);
  const sharedCount = (db.prepare("SELECT COUNT(*) n FROM shared_sent").get() as { n: number }).n;
  res.send(layout("除外リスト", suppressionsView(rows, optouts, imported, loadSuppSync(me(req).id), {
    industries: getSetting(S.excludedIndustries, ""),
    replyRules: loadReplyRules(),
    share: {
      sentPullUrl: getSetting(SHARE_KEY.sentPullUrl, ""),
      pushUrl: getSetting(SHARE_KEY.pushUrl, ""),
      member: getSetting(SHARE_KEY.member, ""),
      lastPull: getSetting(SHARE_KEY.lastPull, "") ? jst(getSetting(SHARE_KEY.lastPull, "").replace("T", " ").slice(0, 19)) : "",
      lastResult: getSetting(SHARE_KEY.lastResult, ""),
      sharedCount,
      configured: shareConfigured(),
      script: APPS_SCRIPT,
    },
  }), takeFlash(req), navUser(req), appState.updateReady));
});

/** 除外リストをCSVで書き出す。列は取り込みと同じなので、別PCの「CSVでまとめて追加」にそのまま読み込める
    （除外リストはPCごとに独立のため、チーム内での手動共有に使う） */
app.get("/suppressions/export.csv", (req, res) => {
  const sc = scope(req);
  const rows = db.prepare(`SELECT * FROM form_suppressions WHERE ${sc.sql} ORDER BY id`).all(...sc.args) as any[];
  const q = (s: unknown) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  const lines = ["会社名,ドメイン,メール,電話,理由,登録日時", ...rows.map((r) => [r.company_name, r.domain, r.email, r.tel, r.reason, jst(r.created_at)].map(q).join(","))];
  res.setHeader("content-type", "text/csv; charset=utf-8");
  res.setHeader("content-disposition", "attachment; filename=suppressions.csv");
  res.send("﻿" + lines.join("\n"));
});

// 共有リストのURLを保存する
app.post("/suppressions/sync-url", (req, res) => {
  const url = String(req.body.sheet_url ?? "").trim();
  const uid = me(req).id;
  if (!url) { db.prepare("DELETE FROM settings WHERE key=?").run(suppSyncKey(uid)); return redirectWith(res, "/suppressions", "共有リストの自動取り込みを解除しました"); }
  if (!/spreadsheets\/d\//.test(url)) return redirectWith(res, "/suppressions", "GoogleスプレッドシートのURL（/spreadsheets/d/… を含む）を貼ってください");
  saveSuppSync(uid, { url, userId: uid, ...(loadSuppSync(uid) ?? {}) , lastAt: loadSuppSync(uid)?.lastAt, lastResult: loadSuppSync(uid)?.lastResult });
  redirectWith(res, "/suppressions", "共有リストを登録しました。1日1回、自動で取り込みます（今すぐ取り込むこともできます）");
});

// チーム共有の設定（#78 #79）
app.post("/share/settings", (req, res) => {
  const pull = String(req.body.sent_pull_url ?? "").trim();
  const push = String(req.body.push_url ?? "").trim();
  if (pull && !/spreadsheets\/d\//.test(pull)) return redirectWith(res, "/suppressions", "①はGoogleスプレッドシートの共有URL（/spreadsheets/d/… を含む）を貼ってください");
  if (push && !/^https:\/\/script\.google\.com\//.test(push)) return redirectWith(res, "/suppressions", "②は Apps Script のウェブアプリURL（https://script.google.com/macros/s/…/exec）を貼ってください");
  saveSetting(SHARE_KEY.sentPullUrl, pull);
  saveSetting(SHARE_KEY.pushUrl, push);
  saveSetting(SHARE_KEY.member, String(req.body.member ?? "").trim().slice(0, 30));
  redirectWith(res, "/suppressions", pull || push ? "チーム共有の設定を保存しました（1日1回、自動で同期します）" : "チーム共有の設定を解除しました");
});

app.post("/share/sync-now", async (req, res) => {
  const msg = await syncShare();
  redirectWith(res, "/suppressions", msg ? `同期しました: ${msg}` : "共有の設定がありません");
});

// 送りたくない業種・キーワード（#87）// 送りたくない業種・キーワード（#87）
app.post("/suppressions/industries", (req, res) => {
  const words = String(req.body.industries ?? "").split(/[\n,、，]/).map((w) => w.trim()).filter((w) => w.length >= 2);
  saveSetting(S.excludedIndustries, words.join("\n"));
  redirectWith(res, "/suppressions", words.length ? `${words.length}件のキーワードを除外に設定しました（取り込み時と送信直前に確認します）` : "除外キーワードを解除しました");
});

// 返信の自動判定が覚えた言い回しを消す（#25）
app.post("/reply-rules/:id/delete", (req, res) => {
  db.prepare("DELETE FROM reply_rules WHERE id=?").run(Number(req.params.id));
  clearReplyRulesCache();
  redirectWith(res, "/suppressions", "覚えた言い回しを削除しました");
});

// 今すぐ取り込む
app.post("/suppressions/sync-now", async (req, res) => {
  const msg = await syncSuppressionsFor(me(req).id);
  redirectWith(res, "/suppressions", `共有リストから取り込みました: ${msg}`);
});

/** 除外リストをCSVでまとめて追加 */
app.post("/suppressions/import", upload.single("csv"), async (req, res) => {
  const pasted = String(req.body.pasted ?? "").trim();
  const sheetUrl = String(req.body.sheet_url ?? "").trim();
  try {
    let rows, src;
    if (req.file) { rows = parseSuppressionCsv(req.file.buffer); src = "CSV"; }
    else if (pasted) { rows = parseSuppressionText(pasted); src = "貼り付け"; }
    else if (sheetUrl) { rows = parseSuppressionText(await fetchGoogleSheetCsv(sheetUrl)); src = "スプレッドシート"; }
    else return redirectWith(res, "/suppressions", "貼り付け・スプレッドシートのURL・CSVファイルのいずれかを指定してください");
    if (!rows.length) return redirectWith(res, "/suppressions", "登録できる行がありませんでした（会社名・URL/ドメイン・メールのいずれかを1行1社で入れてください）");
    const r = importSuppressions(rows, me(req).id, String(req.body.reason ?? "").trim() || `${src}で一括登録`);
    suppImports.set(me(req).id, r);
    res.redirect("/suppressions");
  } catch (e) {
    redirectWith(res, "/suppressions", `取り込みエラー: ${String((e as Error).message)}`);
  }
});

app.post("/suppressions", (req, res) => {
  const raw = String(req.body.domain ?? "").trim();
  const company = String(req.body.company_name ?? "").trim();
  const reason = String(req.body.reason ?? "").trim() || "手動で追加";
  if (raw.includes("@")) {
    const email = raw.toLowerCase();
    optOut(email, company ? `${company}（${reason}）` : reason, me(req).id);
    db.prepare("INSERT INTO form_suppressions(company_name, domain, email, reason, owner_user_id) VALUES(?,NULL,?,?,?)").run(company, email, reason, me(req).id);
    return redirectWith(res, "/suppressions", `${company || email} を除外リストに追加しました`);
  }
  const domain = domainOf(raw) || raw.toLowerCase();
  if (!domain) return redirectWith(res, "/suppressions", "ドメインかメールアドレスを入れてください");
  const dup = db.prepare("SELECT 1 FROM form_suppressions WHERE domain=?").get(domain);
  if (dup) return redirectWith(res, "/suppressions", `${domain} はすでに登録されています`);
  db.prepare("INSERT INTO form_suppressions(company_name, domain, reason, owner_user_id) VALUES(?,?,?,?)").run(company, domain, reason, me(req).id);
  redirectWith(res, "/suppressions", `${company || domain} を除外リストに追加しました`);
});

app.post("/suppressions/:id/delete", (req, res) => {
  const sc = scope(req);
  db.prepare(`DELETE FROM form_suppressions WHERE id=? AND ${sc.sql}`).run(Number(req.params.id), ...sc.args);
  redirectWith(res, "/suppressions", "削除しました");
});
}
