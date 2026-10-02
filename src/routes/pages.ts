// 成果・ガイド・はじめの設定などの画面
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
import { notify, notifyEnabled, pollEvents } from "../notify.js";
import { checkUpdate, applyUpdate, requestRestart, currentVersion, updateChannel } from "../update.js";
import { errorPage } from "../ui/layout.js";
import { esc, layout, lawView, todoView, todoRunView, setupView, checklistView, reportView, campaignListView, sendersView, type SenderExtra, campaignForm, campaignView, jobView, suppressionsView, settingsView, loginPage, passwordView, usersView, updateView, testView, gameView, guideView, statsView, importPreviewView, logsView, healthView, errKind, type NavUser, appointmentsView } from "../views.js";
import { authMiddleware, renameUser, requireAdmin, startSession, endSession, findUser, verifyPassword, createUser, setPassword, listUsers, ensureFirstAdmin, randomPassword, cleanupSessions, type AuthedRequest } from "../auth.js";
import { app, db, redirectWith, takeFlash, me, appState, gameOnFor, navUser, scope, setupState, lawKey } from "../app/context.js";

/** この画面の経路を登録する。server.ts から、ログイン確認などの共通処理のあとに呼ばれる */
export function register(): void {
// アポだけの画面。返信の一覧や送信一覧に混ざると、大事なアポを見落とすため
app.get("/appointments", (req, res) => {
  const sc = scope(req);
  const campaignId = Number(req.query.campaign) || 0;
  const where = `j.is_test=0 AND ${sc.sql.replace("owner_user_id", "c.owner_user_id")}${campaignId ? " AND c.id=?" : ""}`;
  const args = [...sc.args, ...(campaignId ? [campaignId] : [])];
  const cols = `j.id, j.company_name, j.domain, j.email, j.channel, j.outcome, j.outcome_note, j.updated_at, j.sent_at, j.appo_seen_at, c.id campaign_id, c.name campaign_name, lower(s.smtp_user) mailbox`;
  const from = `FROM form_jobs j JOIN form_campaigns c ON c.id=j.campaign_id JOIN sender_profiles s ON s.id=c.sender_id`;
  const appos = db.prepare(`SELECT ${cols} ${from} WHERE ${where} AND j.outcome='appointment' ORDER BY j.updated_at DESC`).all(...args) as import("../views.js").AppoRow[];
  const replies = db.prepare(`SELECT ${cols} ${from} WHERE ${where} AND j.outcome='replied' ORDER BY j.updated_at DESC LIMIT 50`).all(...args) as import("../views.js").AppoRow[];
  const campaigns = db.prepare(`SELECT id, name FROM form_campaigns c WHERE ${sc.sql.replace("owner_user_id", "c.owner_user_id")} ORDER BY id DESC`).all(...sc.args) as { id: number; name: string }[];
  res.send(layout("アポ", appointmentsView(appos, replies, campaigns, campaignId), takeFlash(req), navUser(req), appState.updateReady));
});

// 開いているページが、新しいお知らせを取りに来る（数秒ごと）。通知はページ側が出す
app.get("/events", (req, res) => {
  res.setHeader("cache-control", "no-store");
  res.json(pollEvents(Number(req.query.since) || 0));
});

app.get("/setup", (req, res) => {
  res.send(layout("はじめの設定", setupView(setupState(req)), takeFlash(req), navUser(req), appState.updateReady));
});

// 導入チェックリスト（#138）。印刷して渡せる1枚。ブラウザの印刷から「PDFとして保存」もできる
app.get("/checklist", (req, res) => {
  res.send(layout("導入チェックリスト", checklistView(setupState(req), currentVersion()), takeFlash(req), navUser(req), appState.updateReady));
});

app.get("/law", (req, res) => {
  const sc = scope(req);
  const senders = db.prepare(`SELECT * FROM sender_profiles WHERE ${sc.sql} ORDER BY id`).all(...sc.args) as SenderProfile[];
  const acked = getSetting(lawKey(me(req).id), "");
  res.send(layout("営業メールの決まり", lawView(senders, acked ? jst(acked) : "", senders.some((s) => s.unsubscribe_url)), takeFlash(req), navUser(req), appState.updateReady));
});

app.post("/law/ack", (req, res) => {
  if (!req.body.ack) return redirectWith(res, "/law", "チェックを入れてから進んでください");
  saveSetting(lawKey(me(req).id), new Date().toISOString().replace("T", " ").slice(0, 19));
  redirectWith(res, "/", "確認ありがとうございます。キャンペーンから送信を開始できます");
});

// ---- 送信数（日別・月別） ----
// 「今日は何件送ったか」「今月はどれくらいか」を見るための画面。日時は東京時間で数える（DBは世界標準時）
app.get("/stats", (req, res) => {
  const mode = String(req.query.mode) === "month" ? "month" : "day";
  const campaignId = Number(req.query.campaign) || 0;
  const sc = scope(req);
  const where = [`j.is_test=0`, `j.sent_at IS NOT NULL`, `j.status='sent'`, sc.sql.replace("owner_user_id", "c.owner_user_id")];
  const args: (string | number)[] = [...sc.args];
  if (campaignId) { where.push("c.id=?"); args.push(campaignId); }
  const bucket = mode === "month" ? "strftime('%Y-%m', j.sent_at, '+9 hours')" : "date(j.sent_at, '+9 hours')";
  const limit = mode === "month" ? 12 : 30;
  const rows = db.prepare(`SELECT ${bucket} period, SUM(j.channel='form') form, SUM(j.channel='email') email, COUNT(*) total
    FROM form_jobs j JOIN form_campaigns c ON c.id=j.campaign_id WHERE ${where.join(" AND ")}
    GROUP BY period ORDER BY period DESC LIMIT ${limit}`).all(...args) as { period: string; form: number; email: number; total: number }[];
  const campaigns = db.prepare(`SELECT id, name FROM form_campaigns c WHERE ${sc.sql.replace("owner_user_id", "c.owner_user_id")} ORDER BY id DESC`).all(...sc.args) as { id: number; name: string }[];
  // 合計は「いま表示している期間（直近30日／12か月）」の合計にする（全期間と混ざらないように）
  const totals = rows.reduce((a, r) => ({ total: a.total + r.total, form: a.form + r.form, email: a.email + r.email }), { total: 0, form: 0, email: 0 });
  // ---- 分析（#71 #72 #73 #75）----
  const aWhere = [`j.is_test=0`, sc.sql.replace("owner_user_id", "c.owner_user_id")];
  const aArgs: (string | number)[] = [...sc.args];
  if (campaignId) { aWhere.push("c.id=?"); aArgs.push(campaignId); }
  const base = `FROM form_jobs j JOIN form_campaigns c ON c.id=j.campaign_id WHERE ${aWhere.join(" AND ")}`;
  const REACT = "SUM(CASE WHEN j.outcome IN ('replied','appointment') THEN 1 ELSE 0 END) replied, SUM(CASE WHEN j.outcome='appointment' THEN 1 ELSE 0 END) appo";
  const byIndustry = db.prepare(`SELECT COALESCE(NULLIF(j.sub_industry,''), j.industry) key, COUNT(*) sent, ${REACT} ${base} AND j.status='sent' GROUP BY key ORDER BY sent DESC LIMIT 15`).all(...aArgs) as { key: string; sent: number; replied: number; appo: number }[];
  const byPref = db.prepare(`SELECT j.prefecture key, COUNT(*) sent, ${REACT} ${base} AND j.status='sent' AND j.prefecture<>'' GROUP BY key ORDER BY sent DESC LIMIT 15`).all(...aArgs) as { key: string; sent: number; replied: number; appo: number }[];
  const byChannel = db.prepare(`SELECT j.channel, SUM(CASE WHEN j.status='sent' THEN 1 ELSE 0 END) sent,
      SUM(CASE WHEN j.status IN ('failed','skip_no_form','skip_captcha') THEN 1 ELSE 0 END) failed,
      SUM(CASE WHEN j.outcome IN ('replied','appointment') THEN 1 ELSE 0 END) replied,
      SUM(CASE WHEN j.outcome='appointment' THEN 1 ELSE 0 END) appo
    ${base} GROUP BY j.channel`).all(...aArgs) as { channel: string; sent: number; failed: number; replied: number; appo: number }[];
  const byHour = db.prepare(`SELECT strftime('%H', j.sent_at, '+9 hours') hour, COUNT(*) sent,
      SUM(CASE WHEN j.outcome IN ('replied','appointment') THEN 1 ELSE 0 END) replied
    ${base} AND j.status='sent' AND j.sent_at IS NOT NULL GROUP BY hour ORDER BY hour`).all(...aArgs) as { hour: string; sent: number; replied: number }[];

  // 送れなかった理由を数えて、打てる手を添える（#72）。これまで手で数えていたもの
  const failRows = db.prepare(`SELECT j.status, j.result_text ${base} AND j.status IN ('failed','skip_no_form','skip_captcha','skip_refused','skip_suppressed','skip_optout','skip_duplicate') LIMIT 5000`).all(...aArgs) as { status: string; result_text: string }[];
  const failBucket = new Map<string, { n: number; hint: string }>();
  const add = (label: string, hint: string) => { const cur = failBucket.get(label) ?? { n: 0, hint }; cur.n++; failBucket.set(label, cur); };
  for (const f of failRows) {
    const t = f.result_text || "";
    if (f.status === "skip_no_form") {
      if (/アクセスできない|接続|見つかりません|タイムアウト/.test(t)) add("サイトにアクセスできない", "URLの誤り・閉鎖の可能性。メール列があれば自動でメールに回ります（キャンペーンのチャネル設定）");
      else add("問い合わせフォームが見つからない", "「フォーム無しの会社をもう一度チェックする」で、強化した探し方で再チェックできます");
    } else if (f.status === "skip_captcha") add("画像認証（CAPTCHA）", "<a href='/todo?kind=captcha'>要対応</a>から、ブラウザを開いて人が送れます");
    else if (f.status === "skip_refused") add("営業お断りの表示", "送らないのが正解です（クレーム防止）");
    else if (f.status === "skip_suppressed") add("除外リスト・除外キーワード", "意図どおりなら対応不要です");
    else if (f.status === "skip_optout") add("配信停止済み", "対応不要です");
    else if (f.status === "skip_duplicate") add("すでに送信済み・重複", "対応不要です");
    else if (/メール送信エラー|SMTP|Gmail|ログインを拒否|2段階認証/.test(t)) add("メールの設定・送信エラー", "送信者の画面でアプリパスワードを入れ直し、開始前の接続テストで確認できます");
    else if (/要確認/.test(t)) add("回答を決められない質問がある", "<a href='/todo?kind=check'>要対応</a>で、質問に答えて再送信できます");
    else if (/入力エラー|必須/.test(t)) add("フォームの入力エラー（必須項目）", "自動で埋め直して1回だけ再送信します。残る分は要対応から手で送れます");
    else if (/タイムアウト|timeout|net::|接続/i.test(t)) add("通信エラー・時間切れ", "回線が不安定な可能性。要対応から「待機に戻す」で再送信できます");
    else if (/送信後の判定不能/.test(t)) add("送信後の判定不能", "送信ボタンは押せています。相手に届いていることが多いので、受付メールの有無を確認してください");
    else if (/送信ボタンが見つからない|本文欄/.test(t)) add("フォームの作りが特殊", "要対応から「開いて入力」で、人が送れます");
    else add("その他", "エラーログ・送信一覧の結果欄で内容を確認してください");
  }
  const failures = [...failBucket.entries()].map(([label, v]) => ({ label, n: v.n, hint: v.hint })).sort((a2, b2) => b2.n - a2.n);
  const totalTried = (db.prepare(`SELECT COUNT(*) n ${base}`).get(...aArgs) as { n: number }).n;

  res.send(layout("成果", statsView(rows.reverse(), mode, campaigns, campaignId, totals, { byIndustry, byPref, byChannel, byHour, failures, totalTried }), takeFlash(req), navUser(req), appState.updateReady));
});

// ---- 週次レポート（#74）----
// 週の振り返りを手で作っていたのをやめる。印刷してそのまま報告に使える
app.get("/report", (req, res) => {
  const sc = scope(req);
  const weeksAgo = Math.max(0, Math.min(12, Number(req.query.w) || 0));
  // 月曜はじまりの週（東京時間）
  const nowJst = new Date(Date.now() + 9 * 3600_000);
  const dow = (nowJst.getUTCDay() + 6) % 7; // 月曜=0
  const end = new Date(nowJst); end.setUTCDate(end.getUTCDate() - dow - weeksAgo * 7); // 今週の月曜
  const from = end.toISOString().slice(0, 10);
  const to = new Date(end.getTime() + 6 * 86400_000).toISOString().slice(0, 10);
  const prevFrom = new Date(end.getTime() - 7 * 86400_000).toISOString().slice(0, 10);
  const where = `FROM form_jobs j JOIN form_campaigns c ON c.id=j.campaign_id WHERE j.is_test=0 AND ${sc.sql.replace("owner_user_id", "c.owner_user_id")}`;
  const inWeek = `date(j.sent_at,'+9 hours') BETWEEN ? AND ?`;
  const n = (sql: string, ...extra: (string | number)[]) => (db.prepare(sql).get(...sc.args, ...extra) as { n: number }).n;
  const REACT = "SUM(CASE WHEN j.outcome IN ('replied','appointment') THEN 1 ELSE 0 END) replied, SUM(CASE WHEN j.outcome='appointment' THEN 1 ELSE 0 END) appo";
  const report = {
    from, to,
    sentForm: n(`SELECT COUNT(*) n ${where} AND j.status='sent' AND j.channel='form' AND ${inWeek}`, from, to),
    sentEmail: n(`SELECT COUNT(*) n ${where} AND j.status='sent' AND j.channel='email' AND ${inWeek}`, from, to),
    replied: n(`SELECT COUNT(*) n ${where} AND j.outcome='replied' AND ${inWeek}`, from, to),
    appo: n(`SELECT COUNT(*) n ${where} AND j.outcome='appointment' AND ${inWeek}`, from, to),
    declined: n(`SELECT COUNT(*) n ${where} AND j.outcome='declined' AND ${inWeek}`, from, to),
    failed: n(`SELECT COUNT(*) n ${where} AND j.status='failed' AND date(j.updated_at,'+9 hours') BETWEEN ? AND ?`, from, to),
    captcha: n(`SELECT COUNT(*) n ${where} AND j.status='skip_captcha' AND date(j.updated_at,'+9 hours') BETWEEN ? AND ?`, from, to),
    noForm: n(`SELECT COUNT(*) n ${where} AND j.status='skip_no_form' AND date(j.updated_at,'+9 hours') BETWEEN ? AND ?`, from, to),
    prevSent: n(`SELECT COUNT(*) n ${where} AND j.status='sent' AND date(j.sent_at,'+9 hours') BETWEEN ? AND ?`, prevFrom, from),
    topIndustries: db.prepare(`SELECT COALESCE(NULLIF(j.sub_industry,''), j.industry) key, COUNT(*) sent, ${REACT} ${where} AND j.status='sent' AND ${inWeek} GROUP BY key ORDER BY sent DESC LIMIT 8`).all(...sc.args, from, to) as { key: string; sent: number; replied: number; appo: number }[],
    campaigns: db.prepare(`SELECT c.name, COUNT(*) sent, ${REACT} ${where} AND j.status='sent' AND ${inWeek} GROUP BY c.id ORDER BY sent DESC LIMIT 10`).all(...sc.args, from, to) as { name: string; sent: number; replied: number; appo: number }[],
    appointments: (db.prepare(`SELECT j.company_name company, j.updated_at at, j.outcome_note note ${where} AND j.outcome='appointment' AND date(j.updated_at,'+9 hours') BETWEEN ? AND ? ORDER BY j.updated_at DESC LIMIT 20`).all(...sc.args, from, to) as { company: string; at: string; note: string }[]).map((a) => ({ ...a, at: jst(a.at) })),
  };
  res.send(layout("週次レポート", reportView(report), takeFlash(req), navUser(req), appState.updateReady));
});

app.get("/guide", (req, res) => {
  res.send(layout("ご利用ガイド", guideView(me(req).role === "admin"), takeFlash(req), navUser(req), appState.updateReady));
});

app.get("/game", (req, res) => {
  if (!gameOnFor(req)) return res.redirect("/"); // 非表示ポートでは遊べない（人に見せる用のURL）
  const sc = scope(req);
  const sent = (db.prepare(`SELECT COUNT(*) n FROM form_jobs j JOIN form_campaigns c ON c.id=j.campaign_id WHERE j.status='sent' AND j.is_test=0 AND ${sc.sql.replace("owner_user_id", "c.owner_user_id")}`).get(...sc.args) as { n: number }).n;
  res.send(layout("アポスロット", gameView(sent), takeFlash(req), navUser(req), appState.updateReady));
});
}
