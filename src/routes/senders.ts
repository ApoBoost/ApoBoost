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

/** 送られてきたフォームの値を、編集フォームにもう一度入れられる形にする（チェックボックスは 0/1）。
 *  サーバー側のチェックで弾いたときに、入力した内容を消さずに画面へ戻すために使う */
function draftFrom(body: Record<string, unknown>, id = 0): Partial<SenderProfile> {
  const d: Record<string, unknown> = {};
  for (const k of SENDER_COLS) d[k] = String(body[k] ?? "");
  for (const k of ["tel_required_only", "reply_check", "tls_insecure", "inbox_sort"]) d[k] = body[k] ? 1 : 0;
  if (id) d.id = id;
  return d as Partial<SenderProfile>;
}

/** 入力に問題があったとき、入力した値のまま送信者の画面を出し直す。
 *  以前はリダイレクトしていたため、保存ボタンを押した時点で消える下書き（layout.ts）と合わせて、入力が全部消えていた */
function renderWithError(req: express.Request, res: express.Response, err: string, draft: { id: number; values: Partial<SenderProfile> }) {
  const sc = scope(req);
  const list = db.prepare(`SELECT * FROM sender_profiles WHERE ${sc.sql} ORDER BY id`).all(...sc.args) as SenderProfile[];
  const usage: Record<number, number> = {};
  for (const r of db.prepare(`SELECT sender_id, COUNT(*) n FROM form_campaigns WHERE ${sc.sql} GROUP BY sender_id`).all(...sc.args) as { sender_id: number; n: number }[]) usage[r.sender_id] = r.n;
  // パスワード欄は画面に書き戻さない（HTMLに平文で残さないため）。入れていた場合だけ、入れ直しを頼む
  const passNote = String(req.body?.smtp_pass ?? "").trim() ? "（アプリパスワードはもう一度入れてください）" : "";
  res.status(400).send(layout("送信者", sendersView(list, usage, senderExtras(list), draft.id, draft), `${err}${passNote}`, navUser(req), appState.updateReady));
}

/** 編集した内容を保存する。入力に問題があればその説明を返す（保存しない） */
function updateSender(req: express.Request, id: number): string | null {
  const verr = validateSender(req.body);
  if (verr) return verr;
  const vals = SENDER_COLS.map((k) => String(req.body[k] ?? "").trim());
  const pass = String(req.body.smtp_pass ?? "").trim();
  const telReqOnly = req.body.tel_required_only ? 1 : 0;
  // 設定を直したら、メール送信の一時停止は解除する（直したのに止まったままにならないように）
  { const old = db.prepare("SELECT * FROM sender_profiles WHERE id=?").get(id) as SenderProfile | undefined; if (old) clearEmailPause(old); }
  db.prepare(`UPDATE sender_profiles SET ${SENDER_COLS.map((c) => `${c}=?`).join(",")}, tel_required_only=?, reply_check=?, tls_insecure=?, inbox_sort=?${pass ? ", smtp_pass=?" : ""} WHERE id=?`).run(...vals, telReqOnly, req.body.reply_check ? 1 : 0, req.body.tls_insecure ? 1 : 0, req.body.inbox_sort ? 1 : 0, ...(pass ? [pass] : []), id);
  return null;
}

/** この画面の経路を登録する。server.ts から、ログイン確認などの共通処理のあとに呼ばれる */
export function register(): void {
app.post("/senders/:id/test", async (req, res) => {
  const id = Number(req.params.id);
  let s = ownedSender(req, id);
  if (!s) return notFound(req, res);
  // 編集フォームの中の「メール設定を確認」から来たときは、入力中の値を先に保存してから試す。
  // 以前は入力中の値を捨てて保存済みの値で試していたため、直したのに「接続できない」と出ていた
  if (req.body && typeof req.body === "object" && "company" in req.body) {
    const err = updateSender(req, id);
    if (err) return renderWithError(req, res, err, { id, values: draftFrom(req.body, id) });
    s = ownedSender(req, id) ?? s;
  }
  try {
    if (!s.smtp_user || !s.smtp_pass) throw new Error("送信用メールアカウントが未設定です");
    const bad = checkSmtpPassword(s);
    if (bad) throw new Error(bad);
    await testSmtp(s, 10_000); // つながらないサーバーで画面が何分も固まらないよう10秒で打ち切る
    clearEmailPause(s);
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
  if (err) return renderWithError(req, res, err, { id: 0, values: draftFrom(req.body) });
  const vals = SENDER_COLS.map((k) => String(req.body[k] ?? "").trim());
  // チェックボックスは未チェックだと送られてこないので、値の有無で 0/1 にする
  const telReqOnly = req.body.tel_required_only ? 1 : 0;
  const replyCheck = req.body.reply_check ? 1 : 0;
  const created = db.prepare(`INSERT INTO sender_profiles(owner_user_id, ${SENDER_COLS.join(",")}, smtp_pass, tel_required_only, reply_check, tls_insecure, inbox_sort) VALUES(?, ${SENDER_COLS.map(() => "?").join(",")}, ?, ?, ?, ?, ?)`).run(me(req).id, ...vals, String(req.body.smtp_pass ?? "").trim(), telReqOnly, replyCheck, req.body.tls_insecure ? 1 : 0, req.body.inbox_sort ? 1 : 0);
  redirectWith(res, "/senders", `送信者を追加しました${prefWarning(String(req.body.address ?? ""))}${await smtpCheckNote(Number(created.lastInsertRowid))}`);
});

app.post("/senders/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!ownedSender(req, id)) return forbidden(req, res);
  const verr = updateSender(req, id);
  if (verr) return renderWithError(req, res, verr, { id, values: draftFrom(req.body, id) });
  redirectWith(res, "/senders", `保存しました${prefWarning(String(req.body.address ?? ""))}${await smtpCheckNote(id)}`);
});
}
