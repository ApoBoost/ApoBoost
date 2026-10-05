// ホームとキャンペーン（作成・取り込み・事前チェック・送信・一覧）
// 管理画面（localhost）。
import express from "express";
import { S, setting, settingOn, settingNum, saveSettingValue } from "../settings.js";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { getDb, getSetting, setSetting as saveSetting, SCREENSHOT_DIR, MATERIAL_DIR, domainOf, jst, channelMode, STATUS_LABEL, OUTCOME_LABEL, sentTodaySql, type Campaign, type Job, type SenderProfile } from "../db.js";
import { parseCompanyCsv, parseCompanyXlsx, importRowsToCampaign, parseSuppressionCsv, parseSuppressionText, importSuppressions, type ImportSummary, type CompanyRow } from "../csv.js";
import { composeMessage, activeProvider, activeAiConfig, aiStatusLabel, testAiConnection, AI_MODELS, DEFAULT_TEMPLATE, loadNgWords, lintMessage, aiUsageThisMonth, aiMonthlyLimit } from "../message.js";
import { optOut, testSmtp, explainSmtpError, checkSmtpPassword, emailPause, clearEmailPause, senderEmailOk, buildEmailBody } from "../email.js";
import { logError, logInfo, recentLogs, clearLogs, logCounts } from "../applog.js";
import { jpError } from "../jp.js";
import { healthChecks, diagnosticsText } from "../health.js";
import { createBackup, listBackups, requestRestore, autoBackupIfDue, backupLabel, BACKUP_DIR } from "../backup.js";
import { autostartEnabled, autostartSupported, enableAutostart, disableAutostart, autostartPath } from "../autostart.js";
import { releaseAwakeAll, AWAKE_NOTE } from "../awake.js";
import { licenseStatus, setLicenseKey, licenseEnforced, cappedDailyLimit } from "../license.js";
import { syncShare, shareConfigured, APPS_SCRIPT, KEY as SHARE_KEY } from "../share.js";
import { drainForShutdown, clearStaleRuns, runCampaign, requestStop, isRunning, isScanning, scanCampaign, processJob, inSendWindow, sentToday, sentTodayBySender, warmupLimit, effectiveEmailLimit, nextWindowText } from "../worker.js";
import { launchBrowser, openAndFill } from "../engine.js";
import { checkReplies, isCheckingReplies, replyScanStatus, verifyInterruptedEmails, learnFromCorrection, loadReplyRules, clearReplyRulesCache } from "../replies.js";
import { notify, notifyEnabled } from "../notify.js";
import { checkUpdate, applyUpdate, requestRestart, currentVersion, updateChannel } from "../update.js";
import { errorPage } from "../ui/layout.js";
import { resultNote, templateProblems, templateCheck, normalizeTemplateBraces } from "../ui/parts.js";
import { llm, aiErrorKind, aiOverBudget } from "../message.js";
import { esc, layout, lawView, todoView, todoRunView, setupView, checklistView, reportView, campaignListView, sendersView, type SenderExtra, campaignForm, campaignView, jobView, suppressionsView, settingsView, loginPage, passwordView, usersView, updateView, testView, gameView, guideView, statsView, importPreviewView, logsView, healthView, errKind, type NavUser } from "../views.js";
import { authMiddleware, renameUser, requireAdmin, startSession, endSession, findUser, verifyPassword, createUser, setPassword, listUsers, ensureFirstAdmin, randomPassword, cleanupSessions, type AuthedRequest } from "../auth.js";
import { app, upload, db, setFlash, safeAsync, needsBrowser, redirectWith, takeFlash, me, appState, navUser, scope, ownedCampaign, ownedSender, notFound, forbidden, groupCandidates, applyGroupMembers, groupNames, retryTargetJobs, campaignRows, extraSenderIds, saveMaterial, removeMaterialFileIfUnused, loadCampaignFull, lastImports, pendingImports, previews, fetchGoogleSheetCsv, ReactionRow, jobFilter, CAMPAIGN_EXPORT_COLS, importHistory, recentUndo, deleteJobsWhere, setupState, setupProgress, todoCounts, lawKey, TODO_ANY, todoActive, campaignNumbers, CAMPAIGN_NUM_DEFAULTS, uploadSingle, campaignStall, AUTO_PAUSE_MARK } from "../app/context.js";

const TEMPLATE_KEYS = ["subject_text", "template_text", "subject_b", "template_b", "subject_alts"] as const;

/** 自動の一時停止で待機に戻した会社の結果の文（「…（キャンペーンを一時停止）: 理由」）を消す。
 *  開始・一時停止のあとまで残ると、次に止めたときに古い理由を「自動で止まった理由」として出してしまうため */
function clearAutoPauseMarks(campaignId: number) {
  db.prepare("UPDATE form_jobs SET result_text='' WHERE campaign_id=? AND is_test=0 AND status='queued' AND result_text LIKE ?").run(campaignId, `%${AUTO_PAUSE_MARK}%`);
}

/** 保存する前に文面をそろえる（全角の ｛｛会社名｝｝ を半角の {{会社名}} に）。
 *  全角のままだと差し込みにならず、波括弧ごと相手に送られていた。そろえたら true */
function tidyTemplates(b: Record<string, unknown>): boolean {
  let changed = false;
  for (const k of TEMPLATE_KEYS) {
    if (typeof b[k] !== "string") continue;
    const v = normalizeTemplateBraces(b[k] as string);
    if (v !== b[k]) { b[k] = v; changed = true; }
  }
  return changed;
}

/** 保存したときに出す、文面の注意（保存はできる。開始のときに同じ検査で止める）。
 *  警告（飾りの波括弧など）は開始を止めないが、意図せず相手に届くことがあるので保存のときに一度だけ知らせる */
function templateNote(b: Record<string, unknown>, fixed: boolean): string {
  const { errors, warnings } = templateCheck({ ...b, ab_enabled: b.ab_enabled === "1" || b.ab_enabled === 1 ? 1 : 0 } as Parameters<typeof templateCheck>[0]);
  const few = (list: string[]) => `${list.slice(0, 3).join("／")}${list.length > 3 ? `（ほか ${list.length - 3}件）` : ""}`;
  return [
    fixed ? "全角の ｛｛ ｝｝ を半角の {{ }} に直しました" : "",
    errors.length ? `このままでは開始できません。文面を直してください: ${few(errors)}` : "",
    warnings.length ? `文面の確認（このままでも開始できます）: ${few(warnings)}` : "",
  ].filter(Boolean).map((x) => `／${x}`).join("");
}

/** 全文AIのキャンペーンを開始する前に、AIで文面を作れるか1回だけ確かめる。作れない理由（利用者向けの文）か null を返す。
 *  文面の間違いは開始前に止まるが、AIの設定（キー・残高・モデル）は確かめておらず、自動の一時停止のあと「開始」を押すと
 *  ブラウザを起動して1社目でまた止まっていた。
 *  止めるのは設定の問題（aiErrorKind が config）だけ。混雑・回線断は送信側が数分待って自動で続けるので、開始は止めない */
export async function aiStartProblem(timeoutMs = 20_000): Promise<string | null> {
  if (activeProvider() === "none" || aiOverBudget()) return null; // AIを使わずテンプレートで送る（message.ts の composeMessage）
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      llm("テスト接続です。", "「OK」とだけ返してください。", 16),
      new Promise((_, rej) => { timer = setTimeout(() => rej(new Error("ETIMEDOUT AIの確認が終わりませんでした")), timeoutMs); }),
    ]);
    return null;
  } catch (e) {
    if (aiErrorKind(e)?.kind !== "config") return null;
    const msg = String((e as Error)?.message ?? e);
    if (/credit balance|billing|insufficient[_ ]quota/i.test(msg)) return "AIの残高か支払い設定に問題があるようです。AIの提供元の管理画面で残高・上限を確認してください";
    // aiErrorKind と同じ見分け方（404、または 400 でモデルのことを言っている）
    if (/^(?:anthropic|gemini) 404\b/.test(msg) || (/^(?:anthropic|gemini) 400\b/.test(msg) && /model/i.test(msg))) return "選んだAIのモデルが使えないようです。設定画面で別のモデルを選んでください";
    return "AIのAPIキーが正しくないか、使えなくなっています。設定画面でAPIキーを確認してください";
  } finally {
    clearTimeout(timer);
  }
}

/** この画面の経路を登録する。server.ts から、ログイン確認などの共通処理のあとに呼ばれる */
export function register(): void {
app.get("/", (req, res) => {
  const rows = campaignRows(req);
  const sc2 = scope(req);
  const senderRows = db.prepare(`SELECT * FROM sender_profiles WHERE ${sc2.sql} ORDER BY id`).all(...sc2.args) as SenderProfile[];
  // ホーム上部のまとめ（#49）。今日・今月の送信、反応、要対応、止まっている理由を1画面に
  const jobsWhere = `FROM form_jobs j JOIN form_campaigns c ON c.id=j.campaign_id WHERE j.is_test=0 AND ${sc2.sql.replace("owner_user_id", "c.owner_user_id")}`;
  const num = (sql: string, ...more: (string | number)[]) => (db.prepare(sql).get(...sc2.args, ...more) as { n: number }).n;
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const month = today.slice(0, 7);
  const counts = todoCounts(req);
  const setup = setupProgress(setupState(req));
  const openCampaigns = rows.filter((r) => r.status === "running");
  const home = {
    // 「今日」は上限の判定（worker）と同じ数え方（送信時刻で数える。戻りメールで失敗に変わった分も含む）
    todayForm: num(`SELECT COUNT(*) n ${jobsWhere} AND j.channel='form' AND ${sentTodaySql("j.")}`, today),
    todayEmail: num(`SELECT COUNT(*) n ${jobsWhere} AND j.channel='email' AND ${sentTodaySql("j.")}`, today),
    monthForm: num(`SELECT COUNT(*) n ${jobsWhere} AND j.status='sent' AND j.channel='form' AND strftime('%Y-%m', j.sent_at,'+9 hours')=?`, month),
    monthEmail: num(`SELECT COUNT(*) n ${jobsWhere} AND j.status='sent' AND j.channel='email' AND strftime('%Y-%m', j.sent_at,'+9 hours')=?`, month),
    appointments: num(`SELECT COUNT(*) n ${jobsWhere} AND j.outcome='appointment'`),
    replies: num(`SELECT COUNT(*) n ${jobsWhere} AND j.outcome='replied'`),
    declines: num(`SELECT COUNT(*) n ${jobsWhere} AND j.outcome='declined'`),
    queued: num(`SELECT COUNT(*) n ${jobsWhere} AND j.status='queued'`),
    runningNames: openCampaigns.filter((r) => isRunning(r.id)).map((r) => r.name),
    windowOk: openCampaigns.length ? openCampaigns.some((r) => inSendWindow(r)) : rows.length ? inSendWindow(rows[0]) : true,
    windowText: rows.length ? `${rows[0].send_window_start}〜${rows[0].send_window_end}時${rows[0].weekdays_only ? "・平日" : ""}` : "",
    todo: counts.all ?? 0,
    todoCaptcha: counts.captcha ?? 0,
    emailPaused: senderRows.map((sd) => { const p = emailPause(sd); return p ? { label: sd.label || sd.company, until: p.until, reason: p.reason } : null; }).filter(Boolean) as { label: string; until: number; reason: string }[],
    senders: senderRows.length,
    campaigns: rows.length,
    // 今日送れる上限（開始中のキャンペーンの合計）。進み具合のバーに使う（#108）
    capForm: openCampaigns.filter((r) => r.send_only !== "email").reduce((a, r) => a + cappedDailyLimit(r.daily_limit).limit, 0),
    capEmail: openCampaigns.filter((r) => r.send_only !== "form" && channelMode(r.channel) !== "form_only").reduce((a, r) => a + effectiveEmailLimit(r, r.sender_id).limit, 0),
    nextStart: (openCampaigns[0] ?? rows[0]) ? nextWindowText(openCampaigns[0] ?? rows[0]) : "",
    setupDone: setup.done,
    setupTotal: setup.total,
    perCampaign: [] as import("../ui/home.js").CampaignHome[],
    newAppointments: db.prepare(`SELECT j.id, j.company_name company, j.updated_at at ${jobsWhere} AND j.outcome='appointment' AND j.appo_seen_at IS NULL AND j.updated_at > datetime('now','-3 days') ORDER BY j.updated_at DESC LIMIT 3`).all(...sc2.args) as { id: number; company: string; at: string }[],
  };
  for (const r of rows) r.is_running = isRunning(r.id);
  // キャンペーンごとの進み具合と数字（ホームに1件ずつカードで出す）
  const per = new Map<number, Record<string, number>>();
  for (const r of db.prepare(`SELECT j.campaign_id id,
      SUM(j.channel='form' AND ${sentTodaySql("j.").replace("?", "@today")}) todayForm,
      SUM(j.channel='email' AND ${sentTodaySql("j.").replace("?", "@today")}) todayEmail,
      SUM(j.status='sent' AND j.channel='form' AND strftime('%Y-%m', j.sent_at,'+9 hours')=@month) monthForm,
      SUM(j.status='sent' AND j.channel='email' AND strftime('%Y-%m', j.sent_at,'+9 hours')=@month) monthEmail,
      SUM(j.outcome='appointment') appointments, SUM(j.outcome='replied') replies, SUM(j.outcome='declined') declines,
      SUM(j.status='queued') queued,
      SUM(j.status='queued' AND j.channel='form') queuedForm, SUM(j.status='queued' AND j.channel='email') queuedEmail,
      SUM(${TODO_ANY} AND ${todoActive()}) todo,
      SUM(j.status='skip_captcha' AND ${todoActive()}) todoCaptcha
    FROM form_jobs j WHERE j.is_test=0 GROUP BY j.campaign_id`).all({ today, month }) as (Record<string, number> & { id: number })[]) per.set(r.id, r);
  const senderById = new Map(senderRows.map((sd) => [sd.id, sd]));
  home.perCampaign = rows.map((r) => {
    const v = per.get(r.id) ?? {};
    const usesEmail = r.send_only !== "form" && channelMode(r.channel) !== "form_only";
    const usesForm = r.send_only !== "email" && channelMode(r.channel) !== "email_only";
    const sd = senderById.get(r.sender_id);
    const p = sd ? emailPause(sd) : null;
    const stall = campaignStall(r, { admin: me(req).role === "admin" });
    return {
      id: r.id, name: r.name, status: r.status, running: Boolean(r.is_running),
      todayForm: v.todayForm ?? 0, todayEmail: v.todayEmail ?? 0, monthForm: v.monthForm ?? 0, monthEmail: v.monthEmail ?? 0,
      appointments: v.appointments ?? 0, replies: v.replies ?? 0, declines: v.declines ?? 0,
      queued: v.queued ?? 0, todo: v.todo ?? 0, todoCaptcha: v.todoCaptcha ?? 0,
      queuedForm: r.send_only === "email" ? 0 : v.queuedForm ?? 0, queuedEmail: r.send_only === "form" ? 0 : v.queuedEmail ?? 0,
      capForm: usesForm ? cappedDailyLimit(r.daily_limit).limit : 0,
      capEmail: usesEmail ? effectiveEmailLimit(r, r.sender_id).limit : 0,
      windowOk: inSendWindow(r), nextStart: nextWindowText(r),
      // 進まない理由（キャンペーンの経路と同じ関数）。メールの一時停止もこちらで出す（追加の送信アカウントも含めて判断するため）
      stall: stall ? { text: stall.text, blocking: stall.blocking, kind: stall.kind, href: stall.href ?? "", action: stall.action ?? "", reason: stall.reason ?? "" } : null,
      paused: usesEmail && p && stall?.kind !== "email" ? `${p.reason.slice(0, 70)}（${new Date(p.until).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}に再開）` : "",
    };
  });
  res.send(layout("ホーム", campaignListView(rows, aiStatusLabel(), senderRows.map((x) => ({ id: x.id, label: x.label, company: x.company, person: x.person })), home), takeFlash(req), navUser(req), appState.updateReady));
});

app.get("/campaigns", (req, res) => {
  const sc = scope(req);
  const rows = campaignRows(req);
  for (const r of rows) r.is_running = isRunning(r.id);
  const senders = db.prepare(`SELECT id, label, company, person FROM sender_profiles WHERE ${sc.sql} ORDER BY id`).all(...sc.args) as { id: number; label: string; company: string; person: string }[];
  res.send(layout("キャンペーン", campaignListView(rows, aiStatusLabel(), senders), takeFlash(req), navUser(req), appState.updateReady));
});

app.get("/campaigns/new", (req, res) => {
  const sc = scope(req);
  const senders = db.prepare(`SELECT * FROM sender_profiles WHERE ${sc.sql} ORDER BY id`).all(...sc.args) as SenderProfile[];
  res.send(layout("新規キャンペーン", campaignForm(senders, { template_text: DEFAULT_TEMPLATE }, activeProvider(), undefined, groupNames(req), groupCandidates(req)), takeFlash(req), navUser(req), appState.updateReady));
});

app.post("/campaigns", uploadSingle("material_file", () => "/campaigns/new"), (req, res) => {
  const b = req.body;
  const channel = ["form_first", "email_first", "email_only", "form_only", "form", "email", "both"].includes(b.channel) ? b.channel : "form_first";
  if (!ownedSender(req, Number(b.sender_id))) return redirectWith(res, "/campaigns/new", "送信者を選び直してください");
  const tplFixed = tidyTemplates(b);
  const materialUrl = String(b.material_url ?? "").trim();
  const nums = campaignNumbers(b, CAMPAIGN_NUM_DEFAULTS);
  const r = db.prepare(`INSERT INTO form_campaigns(owner_user_id, name, sender_id, mode, subject_text, template_text, ai_instruction, daily_limit, send_window_start, send_window_end, weekdays_only, channel, email_daily_limit, resend_days, ignore_refusal, material_url, group_name, material_url_in_email, email_warmup, email_sender_ids, ab_enabled, template_b, subject_b, subject_alts)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(me(req).id, b.name, Number(b.sender_id), b.mode, b.subject_text ?? "", b.template_text ?? "", b.ai_instruction ?? "", nums.daily_limit, nums.send_window_start, nums.send_window_end, Number(b.weekdays_only) ? 1 : 0, channel, nums.email_daily_limit, nums.resend_days, Number(b.ignore_refusal) ? 1 : 0, materialUrl, String(b.group_name ?? "").trim(), b.material_url_in_email === "1" ? 1 : 0, b.email_warmup === "1" ? 1 : 0, extraSenderIds(req, b), b.ab_enabled === "1" ? 1 : 0, String(b.template_b ?? ""), String(b.subject_b ?? ""), String(b.subject_alts ?? ""));
  const cid = Number(r.lastInsertRowid);
  // 資料ファイル（メール添付用）を保存する
  const warn = req.file ? saveMaterial(cid, req.file) : "";
  applyGroupMembers(req, cid, "", b);
  redirectWith(res, `/campaigns/${cid}`, `キャンペーンを作成しました。CSVを取り込んでください。${warn ? `／${warn}` : ""}${nums.note ? `／${nums.note}` : ""}${templateNote(b, tplFixed)}`);
});

// ---- キャンペーン編集 ----
app.get("/campaigns/:id/edit", (req, res) => {
  const id = Number(req.params.id);
  const c = ownedCampaign(req, id);
  if (!c) return notFound(req, res);
  const sc = scope(req);
  const senders = db.prepare(`SELECT * FROM sender_profiles WHERE ${sc.sql} ORDER BY id`).all(...sc.args) as SenderProfile[];
  res.send(layout(`編集 | ${c.name}`, campaignForm(senders, c, activeProvider(), id, groupNames(req), groupCandidates(req)), takeFlash(req), navUser(req), appState.updateReady));
});

app.post("/campaigns/:id/edit", uploadSingle("material_file", (req) => `/campaigns/${Number(req.params.id)}/edit`), (req, res) => {
  const id = Number(req.params.id);
  const before = ownedCampaign(req, id);
  if (!before) return notFound(req, res);
  const prevGroupName = before.group_name || "";
  const b = req.body;
  const channel = ["form_first", "email_first", "email_only", "form_only", "form", "email", "both"].includes(b.channel) ? b.channel : "form_first";
  if (!ownedSender(req, Number(b.sender_id))) return redirectWith(res, `/campaigns/${id}/edit`, "送信者を選び直してください");
  const tplFixed = tidyTemplates(b);
  const nums = campaignNumbers(b, before);
  db.prepare(`UPDATE form_campaigns SET name=?, sender_id=?, mode=?, subject_text=?, template_text=?, ai_instruction=?, daily_limit=?, send_window_start=?, send_window_end=?, weekdays_only=?, channel=?, email_daily_limit=?, resend_days=?, ignore_refusal=?, material_url=?, group_name=?, material_url_in_email=?, email_warmup=?, email_sender_ids=?, ab_enabled=?, template_b=?, subject_b=?, subject_alts=? WHERE id=?`)
    .run(b.name, Number(b.sender_id), b.mode, b.subject_text ?? "", b.template_text ?? "", b.ai_instruction ?? "", nums.daily_limit, nums.send_window_start, nums.send_window_end, Number(b.weekdays_only) ? 1 : 0, channel, nums.email_daily_limit, nums.resend_days, Number(b.ignore_refusal) ? 1 : 0, String(b.material_url ?? "").trim(), String(b.group_name ?? "").trim(), b.material_url_in_email === "1" ? 1 : 0, b.email_warmup === "1" ? 1 : 0, extraSenderIds(req, b), b.ab_enabled === "1" ? 1 : 0, String(b.template_b ?? ""), String(b.subject_b ?? ""), String(b.subject_alts ?? ""), id);
  const attachWarn = req.file ? saveMaterial(id, req.file) : "";
  if (req.file) { /* 保存済み。注意文は下の完了メッセージに付ける */ }
  else if (b.remove_attach === "1" && before.attach_path) {
    // 添付を外す。複製したキャンペーンは同じファイルを指していることがあるので、他に使っていなければファイルも消す
    db.prepare("UPDATE form_campaigns SET attach_path='', attach_name='' WHERE id=?").run(id);
    removeMaterialFileIfUnused(before.attach_path);
    applyGroupMembers(req, id, prevGroupName, b);
    return redirectWith(res, `/campaigns/${id}/edit`, `添付ファイル「${before.attach_name}」を削除しました（メールは添付なしで送られます）${nums.note ? `／${nums.note}` : ""}${templateNote(b, tplFixed)}`);
  }
  applyGroupMembers(req, id, prevGroupName, b);
  redirectWith(res, `/campaigns/${id}`, `キャンペーンを保存しました${attachWarn ? `／${attachWarn}` : ""}${nums.note ? `／${nums.note}` : ""}${templateNote(b, tplFixed)}`);
});

app.get("/campaigns/:id", (req, res) => {
  const id = Number(req.params.id);
  const c = loadCampaignFull(req, id);
  if (!c) return notFound(req, res);
  const { statusFilter, qFilter, outcomeFilter, impFilter, sortKey, orderBy, sql: fSql, args: fArgs } = jobFilter(req.query as Record<string, unknown>);
  // ページ送り（#103）。以前は200件で打ち切りで、4,000社の中から探せなかった
  const pageSize = [50, 100, 200].includes(Number(req.query.size)) ? Number(req.query.size) : settingNum(S.listPageSize, 50, 200);
  const page = Math.max(1, Number(req.query.page) || 1);
  const jobs = db.prepare(`SELECT * FROM form_jobs WHERE campaign_id=? AND ${fSql} ORDER BY ${orderBy} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`).all(id, ...fArgs) as Job[];
  const rowTotal = (db.prepare(`SELECT COUNT(*) n FROM form_jobs WHERE campaign_id=? AND ${fSql}`).get(id, ...fArgs) as { n: number }).n;
  // 画面の数字は「社（同じ会社は1つ）」でそろえる（#125）。以前は「全件4,090社」と「一覧4,125件」が並んでいた
  const companyTotal = (db.prepare(`SELECT COUNT(DISTINCT COALESCE(NULLIF(domain,''), CAST(id AS TEXT))) n FROM form_jobs WHERE campaign_id=? AND is_test=0 AND ${fSql}`).get(id, ...fArgs) as { n: number }).n;
  // どのタブを開くか（#98）。指定が無ければ、状況に合うタブを選ぶ
  const q = req.query as Record<string, unknown>;
  const hasListQuery = ["status", "outcome", "q", "imp", "sort", "page", "size"].some((k) => typeof q[k] === "string" && q[k] !== "");
  const hasJobs = (db.prepare("SELECT COUNT(*) n FROM form_jobs WHERE campaign_id=? AND is_test=0").get(id) as { n: number }).n > 0;
  const queuedAny = (db.prepare("SELECT COUNT(*) n FROM form_jobs WHERE campaign_id=? AND is_test=0 AND status='queued'").get(id) as { n: number }).n > 0;
  const tabParam = String(q.tab ?? "");
  const tab: "prep" | "send" | "result" = tabParam === "prep" || tabParam === "send" || tabParam === "result" ? tabParam
    : hasListQuery ? "result"
    : previews.has(id) || lastImports.has(id) || !hasJobs || isScanning(id) ? "prep"
    : isRunning(id) || queuedAny ? "send" : "result";
  // 絞り込み条件に一致する件数（一覧は200件までしか出ないので、全件の数と送信済みの数を別に数える）
  const matched = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(status='sent'),0) sent FROM form_jobs WHERE campaign_id=? AND is_test=0 AND ${fSql}`).get(id, ...fArgs) as { n: number; sent: number };
  const counts: Record<string, number> = {};
  // 会社（ドメイン）単位で重複を除いた実数と、試行回数の合計を状態ごとに集計する
  const attempts: Record<string, number> = {};
  for (const r of db.prepare("SELECT status, COUNT(DISTINCT COALESCE(NULLIF(domain,''), CAST(id AS TEXT))) n, SUM(attempts) a FROM form_jobs WHERE campaign_id=? AND is_test=0 GROUP BY status").all(id) as { status: string; n: number; a: number }[]) { counts[r.status] = r.n; attempts[r.status] = r.a ?? 0; }
  // 画面上部の「進み具合」用: 1社を1つの状態だけで数える（足すと必ず「全体」と一致する）。
  // 状態ごとに数えると、送り直しで状態が複数ある会社（例: 画像認証で止まった後、メールで送れた）を両方で数えてしまい、
  // 枠を足しても全体と合わなかった。送れた会社は「送信済み」、まだ送る予定があれば「これから送る」を優先する
  const STATUS_RANK = ["sent", "sending", "queued", "failed", "skip_captcha", "skip_no_form", "skip_refused", "skip_suppressed", "skip_optout", "skip_duplicate", "skip_cancelled"];
  const rankSql = `CASE status ${STATUS_RANK.map((s, i) => `WHEN '${s}' THEN ${i}`).join(" ")} ELSE ${STATUS_RANK.length} END`;
  const companyCounts: Record<string, number> = {};
  for (const r of db.prepare(`SELECT r, COUNT(*) n FROM (SELECT MIN(${rankSql}) r FROM form_jobs WHERE campaign_id=? AND is_test=0 GROUP BY COALESCE(NULLIF(domain,''), CAST(id AS TEXT))) GROUP BY r`).all(id) as { r: number; n: number }[]) {
    companyCounts[STATUS_RANK[r.r] ?? "other"] = r.n;
  }
  const preview = previews.get(id) ?? null;
  previews.delete(id);
  const consumedImport = lastImports.get(id) ?? null;
  lastImports.delete(id);
  const outcomes: Record<string, number> = {};
  for (const r of db.prepare("SELECT outcome, COUNT(*) n FROM form_jobs WHERE campaign_id=? AND is_test=0 AND outcome != '' GROUP BY outcome").all(id) as { outcome: string; n: number }[]) outcomes[r.outcome] = r.n;
  const unscanned = (db.prepare("SELECT COUNT(*) n FROM form_jobs WHERE campaign_id=? AND status='queued' AND is_test=0 AND channel='form' AND scanned_at IS NULL").get(id) as { n: number }).n;
  const scanned = (db.prepare("SELECT COUNT(*) n FROM form_jobs WHERE campaign_id=? AND is_test=0 AND scanned_at IS NOT NULL").get(id) as { n: number }).n;
  // 「失敗した会社を再送信」の対象を一覧で見せる（どの会社が対象か分かるように）
  const retryTargets = retryTargetJobs(id);
  // 今日・今月の送信数（東京時間で数える）。キャンペーン画面でもすぐ分かるように
  const period = db.prepare(`SELECT
      COALESCE(SUM(strftime('%Y-%m',sent_at,'+9 hours')=strftime('%Y-%m','now','+9 hours') AND channel='form'),0) monthForm,
      COALESCE(SUM(strftime('%Y-%m',sent_at,'+9 hours')=strftime('%Y-%m','now','+9 hours') AND channel='email'),0) monthEmail
    FROM form_jobs WHERE campaign_id=? AND is_test=0 AND status='sent' AND sent_at IS NOT NULL`).get(id) as { todayForm: number; todayEmail: number; monthForm: number; monthEmail: number };
  // 「今日」は上限の判定と同じ数え方（worker の sentToday）。状態が「送信済み」の行だけ数えると、戻りメールで失敗に変わった分が
  // 抜けて、画面の「今日」と上限の判定が食い違っていた
  const sentTodayForm = sentToday(id, "form"), sentTodayEmail = sentToday(id, "email");
  period.todayForm = sentTodayForm;
  period.todayEmail = sentTodayEmail;
  // 事前チェックの対象外（メールで送る会社）の件数。事前チェック欄に「なぜ件数に入らないか」を出すため
  const emailQueued = (db.prepare("SELECT COUNT(*) n FROM form_jobs WHERE campaign_id=? AND is_test=0 AND status='queued' AND channel='email'").get(id) as { n: number }).n;
  // A/Bテストの結果（#64）
  const ab = db.prepare(`SELECT variant, COUNT(*) sent,
      SUM(CASE WHEN outcome IN ('replied','appointment') THEN 1 ELSE 0 END) replied,
      SUM(CASE WHEN outcome='appointment' THEN 1 ELSE 0 END) appo
    FROM form_jobs WHERE campaign_id=? AND is_test=0 AND status='sent' AND variant<>'' GROUP BY variant ORDER BY variant`).all(id) as { variant: string; sent: number; replied: number; appo: number }[];

  // 残り時間の目安（#55）。直近の送信ペースから、いつ終わりそうかを出す
  const pace = db.prepare(`SELECT (julianday(MAX(sent_at)) - julianday(MIN(sent_at))) * 86400 secs, COUNT(*) n
    FROM (SELECT sent_at FROM form_jobs WHERE campaign_id=? AND status='sent' AND is_test=0 AND sent_at IS NOT NULL ORDER BY sent_at DESC LIMIT 50)`).get(id) as { secs: number | null; n: number };
  const perJob = pace && pace.n >= 5 && pace.secs ? Math.max(1, pace.secs / (pace.n - 1)) : 10; // 実績が少ないうちは1社10秒とみなす
  const queuedNow = counts.queued ?? 0;
  let eta = "";
  if (queuedNow > 0) {
    // 今日あと何社送れるかは、チャネルごとに上限と比べてから足す（合計で比べると、フォームが上限でもメールの余りで「送れる」と出ていた）
    const qBy = db.prepare("SELECT COALESCE(SUM(channel='form'),0) f, COALESCE(SUM(channel='email'),0) e FROM form_jobs WHERE campaign_id=? AND is_test=0 AND status='queued'").get(id) as { f: number; e: number };
    const only = String(c.send_only ?? "");
    const leftForm = only === "email" ? 0 : Math.max(0, cappedDailyLimit(c.daily_limit).limit - sentTodayForm);
    const leftEmail = only === "form" || channelMode(c.channel) === "form_only" ? 0 : Math.max(0, effectiveEmailLimit(c, c.sender_id).limit - sentTodayEmail);
    const doable = Math.min(queuedNow, Math.min(qBy.f, leftForm) + Math.min(qBy.e, leftEmail));
    const minutes = Math.round((doable * perJob) / 60);
    const end = new Date(Date.now() + minutes * 60_000 + 9 * 3600_000).toISOString();
    // 秒・分の生の数字は出さない（「1社あたり約15869秒」「約2116分」と出ていた）。
    // 送信が何日かに分かれていると1社あたりの間隔が何時間にもなるので、その場合は終わりの時刻を言わない
    const reliable = perJob <= 600;
    const span = minutes < 60 ? `約${Math.max(1, minutes)}分` : `約${Math.floor(minutes / 60)}時間${minutes % 60 ? `${minutes % 60}分` : ""}`;
    eta = doable === 0
      ? `今日の上限に達しています。残り ${queuedNow}社は、次の送信時間帯に続きます`
      : `残り ${queuedNow}社${reliable ? `。${span}で送り終わる見込みです（${end.slice(11, 16)}ごろ）` : ""}${doable < queuedNow ? `。きょう送れるのは ${doable}社で、残りの ${queuedNow - doable}社は翌営業日に続きます` : ""}`;
  }
  res.send(layout(c.name, campaignView(c, jobs, counts, isRunning(id), aiStatusLabel(), { preview, windowOk: inSendWindow(c), sentToday: sentTodayForm, emailSentToday: sentTodayEmail, stall: campaignStall(c, { admin: me(req).role === "admin" }), templateCheck: templateCheck(c), scanning: isScanning(id), unscanned, scanned, statusFilter, qFilter, outcomeFilter, impFilter, sortKey, eta, ab, tab, page, pageSize, total: rowTotal, companyTotal, companyAll: (db.prepare("SELECT COUNT(DISTINCT COALESCE(NULLIF(domain,''), CAST(id AS TEXT))) n FROM form_jobs WHERE campaign_id=? AND is_test=0").get(id) as { n: number }).n, warmup: channelMode(c.channel) !== "form_only" ? { sent: sentTodayBySender(c.sender_id), ...effectiveEmailLimit(c, c.sender_id) } : null, undo: recentUndo(id, me(req).id), matched, attempts, companyCounts, outcomes, lastImport: consumedImport, retryTargets, emailQueued, period, emailPaused: emailPause(c.sender), imports: importHistory(id), reactions: db.prepare("SELECT id, company_name, domain, email, channel, outcome, outcome_note, updated_at FROM form_jobs WHERE campaign_id=? AND is_test=0 AND outcome<>'' ORDER BY updated_at DESC").all(id) as ReactionRow[], replyScan: { ...replyScanStatus(db.prepare("SELECT * FROM sender_profiles WHERE id=?").get(c.sender_id) as SenderProfile | undefined), checking: isCheckingReplies() } }), takeFlash(req), navUser(req), appState.updateReady));
});

// 実行中の画面が2.5秒ごとに見る進捗API。バーの更新と「終わったら自動でページ更新」に使う
app.get("/campaigns/:id/progress", (req, res) => {
  const id = Number(req.params.id);
  if (!ownedCampaign(req, id)) return res.status(403).json({ error: "denied" });
  const n = (sql: string) => (db.prepare(sql).get(id) as { n: number }).n;
  const unscanned = n("SELECT COUNT(*) n FROM form_jobs WHERE campaign_id=? AND status='queued' AND is_test=0 AND channel='form' AND scanned_at IS NULL");
  const scanDone = n("SELECT COUNT(*) n FROM form_jobs WHERE campaign_id=? AND is_test=0 AND scanned_at IS NOT NULL");
  const total = n("SELECT COUNT(*) n FROM form_jobs WHERE campaign_id=? AND is_test=0");
  const queued = n("SELECT COUNT(*) n FROM form_jobs WHERE campaign_id=? AND status='queued' AND is_test=0");
  res.json({ scanning: isScanning(id), running: isRunning(id), scanDone, scanTotal: scanDone + unscanned, total, processed: total - queued });
});

// テスト送信の専用ページ（入力と履歴をキャンペーン画面から分離）
app.get("/campaigns/:id/test", (req, res) => {
  const id = Number(req.params.id);
  const c = loadCampaignFull(req, id);
  if (!c) return notFound(req, res);
  const tests = db.prepare("SELECT * FROM form_jobs WHERE campaign_id=? AND is_test=1 ORDER BY id DESC LIMIT 20").all(id) as Job[];
  res.send(layout(`テスト送信 | ${c.name}`, testView(c, tests), takeFlash(req), navUser(req), appState.updateReady));
});

app.post("/campaigns/:id/import", uploadSingle("csv", (req) => `/campaigns/${Number(req.params.id)}`), safeAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!ownedCampaign(req, id)) return forbidden(req, res);
  const pasted = String(req.body.pasted ?? "").trim();
  const sheetUrl = String(req.body.sheet_url ?? "").trim();
  try {
    let rows;
    let srcLabel = "";
    if (req.file && /\.xlsx$/i.test(req.file.originalname)) {
      rows = await parseCompanyXlsx(req.file.buffer); srcLabel = "Excel";
    } else if (req.file) {
      rows = parseCompanyCsv(req.file.buffer); srcLabel = "CSV";
    } else if (pasted) {
      rows = parseCompanyCsv(pasted); srcLabel = "貼り付け";
    } else if (sheetUrl) {
      const csv = await fetchGoogleSheetCsv(sheetUrl); rows = parseCompanyCsv(csv); srcLabel = "スプレッドシート";
    } else {
      return redirectWith(res, `/campaigns/${id}`, "ファイル・貼り付け・スプレッドシートURLのいずれかを指定してください");
    }
    if (!rows.length) return redirectWith(res, `/campaigns/${id}`, "取り込める行がありませんでした。1行目に見出し（企業名・企業URL 等）があるか確認してください");
    // すぐには登録せず、まずプレビュー（先頭行・件数内訳）を見せて確定してもらう
    pendingImports.set(id, { rows, srcLabel });
    const dry = importRowsToCampaign(id, rows, { dryRun: true });
    const c = loadCampaignFull(req, id)!;
    res.send(layout(`取り込みプレビュー | ${c.name}`, importPreviewView(c, rows, dry, srcLabel), takeFlash(req), navUser(req), appState.updateReady));
  } catch (e) {
    redirectWith(res, `/campaigns/${id}`, `取り込みエラー: ${jpError(e, 200)}`);
  }
}, (req) => `/campaigns/${Number(req.params.id)}`));

// プレビューを確認して実際に取り込む
app.post("/campaigns/:id/import-confirm", (req, res) => {
  const id = Number(req.params.id);
  if (!ownedCampaign(req, id)) return forbidden(req, res);
  const pending = pendingImports.get(id);
  if (!pending) return redirectWith(res, `/campaigns/${id}`, "取り込みの確認中に内容が消えました（アプリが再起動したためです）。お手数ですが、もう一度取り込んでください");
  const importId = db.prepare("INSERT INTO form_imports(campaign_id, src_label, rows_count) VALUES(?,?,?)").run(id, pending.srcLabel, pending.rows.length).lastInsertRowid as number;
  const s = importRowsToCampaign(id, pending.rows, { importId });
  pendingImports.delete(id);
  lastImports.set(id, s);
  redirectWith(res, `/campaigns/${id}`, `${pending.srcLabel}から ${pending.rows.length}行を取り込みました`);
});

// プレビューを取り消す
app.post("/campaigns/:id/import-cancel", (req, res) => {
  const id = Number(req.params.id);
  // 他人のキャンペーンの取り込み待ちを消せないように
  if (!ownedCampaign(req, id)) return forbidden(req, res);
  pendingImports.delete(id);
  redirectWith(res, `/campaigns/${id}`, "取り込みを取り消しました");
});

app.post("/campaigns/:id/preview", safeAsync(async (req, res) => {
  const id = Number(req.params.id);
  const c = loadCampaignFull(req, id);
  if (!c) return notFound(req, res);
  const job = db.prepare("SELECT * FROM form_jobs WHERE campaign_id=? AND status='queued' AND is_test=0 ORDER BY id LIMIT 1").get(id) as Job | undefined;
  if (!job) return redirectWith(res, `/campaigns/${id}`, "待機中の会社がありません。先にCSVを取り込んでください");
  try {
    let site = { title: "", text: "" };
    if ((c.mode === "ai" || c.mode === "hybrid") && activeProvider() !== "none") {
      const cached = db.prepare("SELECT title,text FROM site_cache WHERE domain=?").get(job.domain) as any;
      if (cached) site = cached;
      else {
        const { fetchSiteText } = await import("../engine.js");
        const browser = await launchBrowser();
        try { site = await fetchSiteText(browser, job.site_url || job.form_url); } finally { await browser.close(); }
        db.prepare("INSERT OR REPLACE INTO site_cache(domain,title,text) VALUES(?,?,?)").run(job.domain, site.title, site.text);
      }
    }
    const composed = await composeMessage(job, c.sender, c, site);
    // メールでの見え方（#70）も作っておく（実際に送る本文と同じ関数で組み立てる）
    const emailHtml = channelMode(c.channel) !== "form_only" ? buildEmailBody(composed.message, c.sender, job.email).html : "";
    previews.set(id, { job, ...composed, lint: lintMessage(composed.message, composed.subject, c.channel), emailHtml });
    res.redirect(`/campaigns/${id}`);
  } catch (e) {
    redirectWith(res, `/campaigns/${id}`, `プレビュー生成エラー: ${jpError(e, 160)}`);
  }
}, (req) => `/campaigns/${Number(req.params.id)}`));

app.post("/campaigns/:id/test", safeAsync(async (req, res) => {
  const id = Number(req.params.id);
  if (!ownedCampaign(req, id)) return forbidden(req, res);
  const url = String(req.body.url ?? "").trim();
  const email = String(req.body.email ?? "").trim().toLowerCase();
  const dry = req.body.dry === "1";
  const company = String(req.body.company || "テスト株式会社");
  if (!url && !email) return redirectWith(res, `/campaigns/${id}/test`, "テスト先のフォームURLか、自分のメールアドレスを入れてください");
  const r = email
    ? db.prepare("INSERT INTO form_jobs(campaign_id, company_name, form_url, site_url, industry, domain, is_test, channel, email) VALUES(?,?,?,?,?,?,1,'email',?)").run(id, company, "", "", "テスト業種", email.split("@")[1] ?? "", email)
    : db.prepare("INSERT INTO form_jobs(campaign_id, company_name, form_url, site_url, industry, domain, is_test) VALUES(?,?,?,?,?,?,1)").run(id, company, url, url, "テスト業種", domainOf(url));
  // メールのテストはブラウザを使わない（ブラウザが入っていないPCでもメールは試せるように）。
  // 起動の失敗も画面に出せるよう try の中で起動する（外で失敗すると応答が返らず、画面が固まっていた）
  let browser: Awaited<ReturnType<typeof launchBrowser>> | null = null;
  try {
    if (needsBrowser(email ? "email" : "form", id)) browser = await launchBrowser();
    const j = await processJob(browser as never, Number(r.lastInsertRowid), { dryRun: dry });
    redirectWith(res, `/jobs/${j.id}`, dry ? "入力テストが終わりました。スクリーンショットで入力内容を確認してください" : `テスト送信の結果: ${resultNote(j)}`);
  } catch (e) {
    redirectWith(res, `/campaigns/${id}/test`, `テスト送信できませんでした: ${jpError(e, 160)}`);
  } finally {
    await browser?.close().catch(() => {});
  }
}, (req) => `/campaigns/${Number(req.params.id)}/test`));

app.post("/campaigns/:id/start", safeAsync(async (req, res) => {
  const id = Number(req.params.id);
  const camp = ownedCampaign(req, id);
  if (!camp) return forbidden(req, res);
  if (isRunning(id)) return redirectWith(res, `/campaigns/${id}`, "すでに実行中です");
  const only = ["email", "form"].includes(String(req.body.only)) ? String(req.body.only) : "";

  // 文面に【ここに…】や差し込み名の間違いが残っていたら開始しない。
  // 以前はそのまま走り出し、送る直前の文面チェックで待機中の全社が1社ずつ「失敗」になっていた（初期値の件名「【ここに件名】のご案内」のままでも同じ）
  const probs = templateProblems(camp);
  if (probs.length) {
    logInfo("start", `文面の未記入・差し込みの間違いのため開始しませんでした（${probs.length}件）`);
    return redirectWith(res, `/campaigns/${id}`, `文面に直すところがあるため開始していません: ${probs.slice(0, 3).join("／")}${probs.length > 3 ? `（ほか ${probs.length - 3}件）` : ""}。画面上の「文面を直す」から直してください`);
  }

  // 全文AIなら、AIで文面を作れるかも先に確かめる（キー・残高・モデルの問題は、何社送っても同じく止まる）。
  // 送る会社が無いときは確かめない（AIの利用料がかかるため）
  const queuedNow = (db.prepare("SELECT COUNT(*) n FROM form_jobs WHERE campaign_id=? AND is_test=0 AND status='queued'").get(id) as { n: number }).n;
  if (camp.mode === "ai" && queuedNow > 0) {
    const aiWhy = await aiStartProblem();
    if (aiWhy) {
      logError("start", `開始前のAIの確認で中止: ${aiWhy}`);
      // AIの設定（/settings）は管理者しか開けない。一般の人には誰に頼めばよいかを言う
      const who = me(req).role === "admin" ? "" : "（AIの設定は管理者だけが変えられます。管理者に確認を依頼してください）";
      return redirectWith(res, `/campaigns/${id}`, `AIで文面を作れない状態のため開始していません: ${aiWhy}${who}`);
    }
  }

  // 開始前に、送信用メールの設定を1回だけ確かめる。
  // 以前は設定不備のまま走り出し、メールの会社を次々と失敗にしていた（実例: 「2段階認証が必要」で180件が失敗）。
  // フォームだけ送る場合と、いまメールで送る会社が1社も無い場合は確かめない（フォームだけで使う人が、メールの設定が無いために開始できなかった）。
  // 送る途中でフォーム無し→メールに切り替わった会社は、送信側（worker）で設定を確かめ、足りなければメールだけ一時停止して知らせ、
  // 会社は待機のまま残す（失敗にはしない）ので、ここで止めなくても安全側のまま
  const emailQueuedNow = (db.prepare("SELECT COUNT(*) n FROM form_jobs WHERE campaign_id=? AND is_test=0 AND status='queued' AND channel='email'").get(id) as { n: number }).n;
  const willSendEmail = only !== "form" && channelMode(camp.channel) !== "form_only" && emailQueuedNow > 0;
  // 営業メールの表示義務の確認を、最初の1回だけ見てもらう（#85）
  if (willSendEmail && !getSetting(lawKey(me(req).id), "")) {
    setFlash(req, "/law", "営業メールを送る前に、法律で必要な表示（名称・住所・配信停止の連絡先）をご確認ください。確認は最初の1回だけです");
    return res.redirect("/law");
  }
  if (willSendEmail) {
    const sender = db.prepare("SELECT * FROM sender_profiles WHERE id=?").get(camp.sender_id) as SenderProfile | undefined;
    if (!sender) return redirectWith(res, `/campaigns/${id}`, "送信者が見つかりません");
    const chk = senderEmailOk(sender);
    if (!chk.ok) {
      logError("start", `開始前チェックで中止: ${chk.reason}`);
      return redirectWith(res, `/campaigns/${id}`, `メールの設定が足りないため開始していません: ${chk.reason}／「送信者」の画面で登録してから開始してください（フォームだけ送るなら「対象: フォームの会社だけ」で開始できます）`);
    }
    try {
      // 返ってこない環境で画面が固まらないよう20秒で見切る
      await Promise.race([
        testSmtp(sender),
        new Promise((_, rej) => setTimeout(() => rej(new Error("ETIMEDOUT 接続の確認が20秒で終わりませんでした")), 20_000)),
      ]);
      clearEmailPause(sender); // 設定し直して通ったのなら、前の一時停止は解除する
    } catch (e) {
      const why = explainSmtpError(e, sender);
      const hint = checkSmtpPassword(sender);
      logError("start", `開始前のメール接続テストに失敗: ${why}`);
      return redirectWith(res, `/campaigns/${id}`, `メールを送れない状態のため開始していません: ${why}${hint ? `／${hint}` : ""}（フォームだけ送るなら「対象: フォームの会社だけ」で開始できます）`);
    }
  }
  db.prepare("UPDATE form_campaigns SET status='running', send_only=?, pause_reason='' WHERE id=?").run(only, id);
  clearAutoPauseMarks(id);
  const ignoreWindow = req.body.ignore_window === "1";
  runCampaign(id, { ignoreWindow }).then((r) => console.log(`[campaign ${id}] ${r.processed}件処理 (${r.reason})`)).catch((e) => { console.error(e); logError("worker", `送信を開始できませんでした: ${jpError(e)}`); });
  const onlyLabel = only === "email" ? "メールの会社だけ" : only === "form" ? "フォームの会社だけ" : "すべて";
  redirectWith(res, `/campaigns/${id}`, `送信を開始しました（対象: ${onlyLabel}${ignoreWindow ? "・時間帯を無視" : ""}）${ignoreWindow ? "" : "。送信時間帯外の場合は時間になると自動で始まります"}`);
}, (req) => `/campaigns/${Number(req.params.id)}`, "開始できませんでした"));

app.post("/campaigns/:id/scan", (req, res) => {
  const id = Number(req.params.id);
  if (!ownedCampaign(req, id)) return forbidden(req, res);
  if (isRunning(id) || isScanning(id)) return redirectWith(res, `/campaigns/${id}`, "実行中です");
  scanCampaign(id).then((r) => console.log(`[scan ${id}] ${r.scanned}件 (${r.reason})`)).catch((e) => { console.error(e); logError("scan", `事前チェックを開始できませんでした: ${jpError(e)}`); });
  redirectWith(res, `/campaigns/${id}`, "事前チェックを始めました（1社5〜10秒）");
});

// 「フォーム無し」になった会社を、もう一度 事前チェックの対象に戻す（#8）。
// フォームの探し方（サイトマップ・フッター・会社概要経由・外部フォームサービス・URLの言い換え）を強化したので、
// 以前の判定をやり直せるようにする
app.post("/campaigns/:id/rescan-noform", (req, res) => {
  const id = Number(req.params.id);
  if (!ownedCampaign(req, id)) return forbidden(req, res);
  if (isRunning(id) || isScanning(id)) return redirectWith(res, `/campaigns/${id}`, "実行中です。先に止めてください");
  const n = db.prepare(`UPDATE form_jobs SET status='queued', channel='form', scanned_at=NULL, scan_score=-1,
      result_text='フォームをもう一度探します（探し方を強化した版で再チェック）'
    WHERE campaign_id=? AND is_test=0 AND status='skip_no_form'`).run(id).changes;
  logInfo("scan", `フォーム無しの ${n}件を再チェック対象に戻しました`);
  redirectWith(res, `/campaigns/${id}`, `${n}社を再チェックの対象に戻しました。「事前チェックを実行」を押してください`);
});

app.post("/campaigns/:id/stop-scan", (req, res) => {
  const id = Number(req.params.id);
  if (!ownedCampaign(req, id)) return forbidden(req, res);
  requestStop(-id);
  redirectWith(res, `/campaigns/${id}`, "事前チェックを止めます");
});

// 反応の一覧から、判定（返信あり・アポ・断り）を取り消す。会社そのもの・送信記録は消さない。
// 自動判定の「断り」で自動登録した除外リスト・配信停止も一緒に外す（手で登録した分は残す）
app.post("/campaigns/:id/outcomes/clear", (req, res) => {
  const id = Number(req.params.id);
  if (!ownedCampaign(req, id)) return forbidden(req, res);
  const raw = req.body.ids;
  const ids = (Array.isArray(raw) ? raw : raw != null ? [raw] : []).map((v: unknown) => Number(v)).filter((n: number) => Number.isInteger(n) && n > 0);
  if (!ids.length) return redirectWith(res, `/campaigns/${id}#reactions`, "取り消す会社が選択されていません");
  const rows = db.prepare(`SELECT id, company_name, domain, email, outcome, outcome_note FROM form_jobs WHERE campaign_id=? AND is_test=0 AND outcome<>'' AND id IN (${ids.map(() => "?").join(",")})`).all(id, ...ids) as ReactionRow[];
  db.transaction(() => {
    for (const r of rows) {
      db.prepare("UPDATE form_jobs SET outcome='', outcome_note='', updated_at=datetime('now') WHERE id=?").run(r.id);
      if (r.outcome === "declined" && r.outcome_note.startsWith("自動判定")) {
        const reason = `断り・返信から自動判定（${r.company_name}）`;
        if (r.domain) db.prepare("DELETE FROM form_suppressions WHERE domain=? AND reason=?").run(r.domain, reason);
        if (r.email) db.prepare("DELETE FROM email_optouts WHERE email=? AND reason=?").run(r.email.trim().toLowerCase(), reason);
      }
    }
  })();
  redirectWith(res, `/campaigns/${id}#reactions`, `${rows.length}社の反応の判定を取り消しました`);
});

app.post("/campaigns/:id/pause", (req, res) => {
  const id = Number(req.params.id);
  if (!ownedCampaign(req, id)) return forbidden(req, res);
  requestStop(id);
  // 手で止めたときは、前の自動停止の理由は出さない（「自動で一時停止しました」と食い違うため）
  db.prepare("UPDATE form_campaigns SET status='paused', pause_reason='' WHERE id=?").run(id);
  clearAutoPauseMarks(id);
  redirectWith(res, `/campaigns/${id}`, "一時停止を要求しました（処理中の1件が終わってから止まります）");
});

app.get("/campaigns/:id/export.csv", (req, res) => {
  const id = Number(req.params.id);
  if (!ownedCampaign(req, id)) return forbidden(req, res);
  const jobs = db.prepare("SELECT * FROM form_jobs WHERE campaign_id=? AND is_test=0 ORDER BY id").all(id) as Job[];
  const q = (s: unknown) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  // 社内の管理表にそのまま貼れるように、反応の種類・判定の根拠・A/B・送信アカウント・都道府県も出す（#127）
  const senderLabel = new Map((db.prepare("SELECT id, label FROM sender_profiles").all() as { id: number; label: string }[]).map((r) => [r.id, r.label]));
  const said = (note: string) => (note.match(/本文「…?([\s\S]*?)…?」/)?.[1] ?? "").replace(/\s+/g, " ").trim();
  const lines = ["企業名,企業URL,送り方,送信先,業種,都道府県,状態,結果,反応,反応の判定,相手の言葉,メモ,文面(A/B),送信アカウント,試行回数,送信日時,更新日時",
    ...jobs.map((j) => [j.company_name, j.site_url, j.channel === "email" ? "メール" : "フォーム", j.channel === "email" ? j.email : j.form_url, j.sub_industry || j.industry, j.prefecture,
      STATUS_LABEL[j.status] ?? j.status, (j.result_text || "").split("\n")[0], OUTCOME_LABEL[j.outcome] ?? "", j.outcome ? (j.outcome_note.startsWith("自動判定") ? "自動" : "手動") : "", said(j.outcome_note), j.outcome_note,
      j.variant, senderLabel.get((j as Job & { sent_by_sender?: number }).sent_by_sender ?? -1) ?? "", j.attempts, jst(j.sent_at), jst(j.updated_at)].map(q).join(","))];
  res.setHeader("content-type", "text/csv; charset=utf-8");
  res.setHeader("content-disposition", `attachment; filename=campaign-${id}.csv`);
  res.send("﻿" + lines.join("\n"));
});

/** 手動送信リスト: CAPTCHA等で自動送信できなかった会社を、人が送るためのURL＋文面つきで書き出す */
app.get("/campaigns/:id/manual.csv", safeAsync(async (req, res) => {
  const id = Number(req.params.id);
  const c = loadCampaignFull(req, id);
  if (!c) return notFound(req, res);
  const jobs = db.prepare("SELECT * FROM form_jobs WHERE campaign_id=? AND is_test=0 AND status IN ('skip_captcha','failed','skip_no_form') ORDER BY id").all(id) as Job[];
  const q = (s: unknown) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  const lines = ["企業名,理由,フォームURL,企業URL,メール,件名,本文"];
  for (const j of jobs) {
    let message = j.message_used, subject = c.subject_text;
    if (!message) {
      try { const comp = await composeMessage(j, c.sender, { ...c, mode: "template" }, { title: "", text: "" }); message = comp.message; subject = comp.subject; } catch { message = ""; }
    }
    lines.push([j.company_name, (errKind(j) ? errKind(j) + ": " : "") + (j.result_text || "").split("\n")[0], j.form_url, j.site_url, j.email, subject, message].map(q).join(","));
  }
  res.setHeader("content-type", "text/csv; charset=utf-8");
  res.setHeader("content-disposition", `attachment; filename=manual-${id}.csv`);
  res.send("\ufeff" + lines.join("\n"));
}));

// キャンペーンを複製（設定・文面をコピー。会社リストや送信履歴はコピーしない）
// キャンペーンを削除（取り込んだ会社・送信履歴・スクリーンショット・添付資料も）。除外リストは共通なので残す。
// 送信中・事前チェック中は、途中の処理と食い違わないよう削除させない
app.post("/campaigns/:id/delete", (req, res) => {
  const id = Number(req.params.id);
  const c = ownedCampaign(req, id);
  if (!c) return notFound(req, res);
  if (isRunning(id) || isScanning(id)) return redirectWith(res, `/campaigns/${id}`, "送信中・事前チェック中のキャンペーンは削除できません。先に止めてから削除してください");
  const jobIds = (db.prepare("SELECT id FROM form_jobs WHERE campaign_id=?").all(id) as { id: number }[]).map((r) => r.id);
  db.transaction(() => {
    db.prepare("DELETE FROM form_jobs WHERE campaign_id=?").run(id);
    db.prepare("DELETE FROM form_campaigns WHERE id=?").run(id);
  })();
  for (const jid of jobIds) fs.rmSync(path.join(SCREENSHOT_DIR, `job-${jid}.png`), { force: true });
  if (c.attach_path) removeMaterialFileIfUnused(c.attach_path); // 複製したキャンペーンが同じファイルを使っていれば残す
  pendingImports.delete(id);
  lastImports.delete(id);
  redirectWith(res, "/", `キャンペーン「${c.name}」を削除しました（取り込んだ会社 ${jobIds.length} 件の記録も削除）`);
});

app.post("/campaigns/:id/duplicate", (req, res) => {
  const id = Number(req.params.id);
  const c = ownedCampaign(req, id);
  if (!c) return notFound(req, res);
  const r = db.prepare(`INSERT INTO form_campaigns(owner_user_id, name, sender_id, mode, subject_text, template_text, ai_instruction, daily_limit, send_window_start, send_window_end, weekdays_only, channel, email_daily_limit, resend_days, ignore_refusal, material_url, attach_path, attach_name, status, group_name, material_url_in_email)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'draft',?,?)`).run(me(req).id, c.name + " のコピー", c.sender_id, c.mode, c.subject_text, c.template_text, c.ai_instruction, c.daily_limit, c.send_window_start, c.send_window_end, c.weekdays_only, c.channel, c.email_daily_limit, c.resend_days, c.ignore_refusal, c.material_url, c.attach_path, c.attach_name, c.group_name, c.material_url_in_email ?? 0); // 複製は同じグループのまま
  redirectWith(res, `/campaigns/${Number(r.lastInsertRowid)}`, "キャンペーンを複製しました。会社リストは空なので、CSVを取り込んでください");
});

// 失敗した会社をまとめて「待機中」に戻す（このあと「開始」で再送信）
app.post("/campaigns/:id/requeue-failed", (req, res) => {
  const id = Number(req.params.id);
  if (!ownedCampaign(req, id)) return forbidden(req, res);
  // 会社単位・最新の結果が失敗のものだけを戻す（古い失敗行まで戻すと同じ会社に何度も送ってしまうため）
  const targets = retryTargetJobs(id);
  if (!targets.length) return redirectWith(res, `/campaigns/${id}`, "再送信の対象がありません");
  const ph = targets.map(() => "?").join(",");
  const r = db.prepare(`UPDATE form_jobs SET status='queued', result_text='', retry_after=NULL, temp_tries=0, updated_at=datetime('now') WHERE id IN (${ph}) AND status NOT IN ('sending','sent')`).run(...targets.map((t) => t.id));
  redirectWith(res, `/campaigns/${id}`, `失敗していた ${r.changes} 社を待機中に戻しました。「開始」で再送信できます`);
});

app.get("/campaigns/:id/export.json", (req, res) => {
  const c = ownedCampaign(req, Number(req.params.id));
  if (!c) return notFound(req, res);
  const settings: Record<string, unknown> = {};
  for (const k of CAMPAIGN_EXPORT_COLS) settings[k] = (c as unknown as Record<string, unknown>)[k];
  const out = { app: "apoboost", type: "campaign", version: currentVersion(), exported_at: new Date().toISOString(), note: "キャンペーンの設定と文面だけです（会社リスト・送信履歴・送信者は含みません）", campaign: settings };
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="campaign-${c.id}.json"`);
  res.send(JSON.stringify(out, null, 2));
});

app.post("/campaigns/import", uploadSingle("file", () => "/campaigns"), (req, res) => {
  try {
    const raw = req.file ? req.file.buffer.toString("utf8") : String(req.body.pasted ?? "");
    if (!raw.trim()) return redirectWith(res, "/campaigns", "キャンペーンのファイル（.json）を選ぶか、中身を貼り付けてください");
    const data = JSON.parse(raw) as { app?: string; type?: string; campaign?: Record<string, unknown> };
    const c = data.campaign;
    if (data.app !== "apoboost" || data.type !== "campaign" || !c) return redirectWith(res, "/campaigns", "ApoBoostのキャンペーン設定ファイルではありません");
    const senderId = Number(req.body.sender_id);
    if (!ownedSender(req, senderId)) return redirectWith(res, "/campaigns", "送信者を選んでください（読み込んだ設定は、自分の送信者に結び付けます）");
    // 文面は画面での保存と同じく、全角の ｛｛ ｝｝ を半角にそろえる
    const tplFixed = tidyTemplates(c);
    const str = (k: string, fb = "") => String(c[k] ?? fb);
    // 画面での作成・編集と同じ読み方（範囲・開始＜終了）にそろえる
    const nums = campaignNumbers(c, CAMPAIGN_NUM_DEFAULTS);
    const channel = ["form_first", "email_first", "email_only", "form_only"].includes(str("channel")) ? str("channel") : "form_first";
    const mode = ["template", "tpl_ai", "hybrid", "ai"].includes(str("mode")) ? str("mode") : "template";
    const r = db.prepare(`INSERT INTO form_campaigns(owner_user_id, name, sender_id, mode, subject_text, template_text, ai_instruction, daily_limit, send_window_start, send_window_end, weekdays_only, channel, email_daily_limit, resend_days, ignore_refusal, material_url, group_name, material_url_in_email, status)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'draft')`)
      .run(me(req).id, str("name", "読み込んだキャンペーン"), senderId, mode, str("subject_text"), str("template_text"), str("ai_instruction"),
        nums.daily_limit, nums.send_window_start, nums.send_window_end, Number(c.weekdays_only) ? 1 : 0, channel,
        nums.email_daily_limit, nums.resend_days, Number(c.ignore_refusal) ? 1 : 0, str("material_url"), str("group_name"), Number(c.material_url_in_email) ? 1 : 0);
    redirectWith(res, `/campaigns/${r.lastInsertRowid}`, `キャンペーンの設定を読み込みました。会社リストを取り込んで開始してください${templateNote({ ...c, ab_enabled: 0 }, tplFixed)}`);
  } catch (e) {
    redirectWith(res, "/campaigns", `読み込みエラー: ${e instanceof SyntaxError ? "ファイルの中身が壊れているか、キャンペーンの設定ファイル（.json）ではありません" : jpError(e, 120)}`);
  }
});

// 取り込み1回ぶんを全件削除
app.post("/campaigns/:id/imports/delete", (req, res) => {
  const id = Number(req.params.id);
  if (!ownedCampaign(req, id)) return forbidden(req, res);
  if (isRunning(id) || isScanning(id)) return redirectWith(res, `/campaigns/${id}`, "送信中・事前チェック中は削除できません。先に止めてから削除してください");
  const key = String(req.body.key ?? "");
  let n = 0;
  let m: RegExpMatchArray | null;
  if ((m = key.match(/^i(\d+)$/))) {
    n = deleteJobsWhere(id, "import_id=?", [Number(m[1])], { userId: me(req).id, label: "取り込み1回ぶんの削除" });
    db.prepare("DELETE FROM form_imports WHERE id=? AND campaign_id=?").run(Number(m[1]), id);
  } else if ((m = key.match(/^r(\d+)-(\d+)$/))) {
    n = deleteJobsWhere(id, "import_id IS NULL AND id BETWEEN ? AND ?", [Number(m[1]), Number(m[2])], { userId: me(req).id, label: "取り込み1回ぶんの削除" });
  } else return redirectWith(res, `/campaigns/${id}`, "削除する取り込みが分かりませんでした");
  lastImports.delete(id);
  redirectWith(res, `/campaigns/${id}`, `取り込んだ会社 ${n} 件を削除しました`);
});

// メール送信の一時停止を手動で解除する（Gmail の停止が解けた・パスワードを直した後など）
app.post("/campaigns/:id/email-resume", (req, res) => {
  const c = loadCampaignFull(req, Number(req.params.id));
  if (!c) return notFound(req, res);
  clearEmailPause(c.sender);
  redirectWith(res, `/campaigns/${c.id}`, "メール送信の一時停止を解除しました。実行中なら次の会社から送信を再開します");
});

// 送信一覧の絞り込み条件に一致する会社を全件削除（表示中の200件に限らない）。条件なしなら全件
app.post("/campaigns/:id/delete-filtered", (req, res) => {
  const id = Number(req.params.id);
  if (!ownedCampaign(req, id)) return forbidden(req, res);
  if (isRunning(id) || isScanning(id)) return redirectWith(res, `/campaigns/${id}`, "送信中・事前チェック中は削除できません。先に止めてから削除してください");
  const f = jobFilter(req.body as Record<string, unknown>);
  const n = deleteJobsWhere(id, f.sql, f.args, { userId: me(req).id, label: "絞り込みに一致する会社の削除" });
  // 中身が空になった取り込み記録は履歴から消す
  db.prepare("DELETE FROM form_imports WHERE campaign_id=? AND NOT EXISTS (SELECT 1 FROM form_jobs j WHERE j.import_id=form_imports.id)").run(id);
  lastImports.delete(id);
  redirectWith(res, `/campaigns/${id}`, `条件に一致した会社 ${n} 件を削除しました`);
});

// このキャンペーンの会社を全件削除（キャンペーン自体と設定・文面は残す）
app.post("/campaigns/:id/jobs/delete-all", (req, res) => {
  const id = Number(req.params.id);
  if (!ownedCampaign(req, id)) return forbidden(req, res);
  if (isRunning(id) || isScanning(id)) return redirectWith(res, `/campaigns/${id}`, "送信中・事前チェック中は削除できません。先に止めてから削除してください");
  const n = deleteJobsWhere(id, "1=1", [], { userId: me(req).id, label: "送信一覧の全件削除" });
  db.prepare("DELETE FROM form_imports WHERE campaign_id=?").run(id);
  lastImports.delete(id);
  redirectWith(res, `/campaigns/${id}`, `このキャンペーンの会社 ${n} 件をすべて削除しました（キャンペーンの設定・文面は残っています）`);
});

// 選択した会社をまとめて削除（記録ごと）。このキャンペーンに属するジョブだけを対象にする
app.post("/campaigns/:id/bulk-delete", (req, res) => {
  const id = Number(req.params.id);
  if (!ownedCampaign(req, id)) return forbidden(req, res);
  const raw = req.body.ids;
  const ids = (Array.isArray(raw) ? raw : raw != null ? [raw] : []).map((v: unknown) => Number(v)).filter((n: number) => Number.isInteger(n) && n > 0);
  if (!ids.length) return redirectWith(res, `/campaigns/${id}`, "削除する会社が選択されていません");
  const ph = ids.map(() => "?").join(",");
  // 選んだ行の会社（ドメイン）ごと、履歴も含めてまとめて消す
  const doms = (db.prepare(`SELECT DISTINCT domain FROM form_jobs WHERE campaign_id=? AND is_test=0 AND id IN (${ph}) AND domain<>''`).all(id, ...ids) as { domain: string }[]).map((r) => r.domain);
  let changes = 0;
  const undo = { userId: me(req).id, label: `選択した ${ids.length}社の削除` };
  if (doms.length) changes += deleteJobsWhere(id, `domain IN (${doms.map(() => "?").join(",")})`, doms, undo);
  changes += deleteJobsWhere(id, `id IN (${ph})`, ids, undo); // ドメインが無い行
  redirectWith(res, `/campaigns/${id}`, `${changes} 件を送信一覧から削除しました（30分以内なら画面上部から元に戻せます）`);
});

// 待機中の全社を一括キャンセル
app.post("/campaigns/:id/cancel-queued", (req, res) => {
  const id = Number(req.params.id);
  if (!ownedCampaign(req, id)) return forbidden(req, res);
  const r = db.prepare("UPDATE form_jobs SET status='skip_cancelled', result_text='一括キャンセル', updated_at=datetime('now') WHERE campaign_id=? AND status='queued' AND is_test=0").run(id);
  redirectWith(res, `/campaigns/${id}`, `待機中 ${r.changes} 件をキャンセルしました`);
});
}
