// 会社1社ごとの操作（詳細・再送信・削除の取り消し）
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
import { app, db, redirectWith, takeFlash, me, appState, navUser, scope, ownedJob, notFound, forbidden, loadCampaignFull, deleteJobsWhere, todoBack } from "../app/context.js";

/** この画面の経路を登録する。server.ts から、ログイン確認などの共通処理のあとに呼ばれる */
export function register(): void {
/** スクリーンショットは自分のジョブのものだけ見せる（ファイル名 job-<id>.png） */
app.get("/screenshots/:file", (req, res) => {
  const file = String(req.params.file);
  const m = /^job-(\d+)\.png$/.exec(file);
  if (!m || !ownedJob(req, Number(m[1]))) return notFound(req, res);
  res.sendFile(path.join(SCREENSHOT_DIR, file));
});

// アポを「確認した」にする／未確認に戻す。メニューの「アポ」の数字は未確認の数だけにする
// （確認しても数字が減らないと、新しいアポが来たのかどうか分からなかった）。並び順が変わらないよう updated_at は触らない
app.post("/jobs/:id/appo-seen", (req, res) => {
  const id = Number(req.params.id);
  if (!ownedJob(req, id)) return notFound(req, res);
  const seen = String(req.body.seen ?? "1") !== "0";
  db.prepare(`UPDATE form_jobs SET appo_seen_at=${seen ? "datetime('now')" : "NULL"} WHERE id=? AND outcome='appointment'`).run(id);
  redirectWith(res, "/appointments", seen ? "確認済みにしました" : "未確認に戻しました");
});

app.post("/jobs/:id/outcome", (req, res) => {
  const id = Number(req.params.id);
  const j = ownedJob(req, id);
  if (!j) return notFound(req, res);
  const outcome = ["", "replied", "appointment", "declined"].includes(req.body.outcome) ? req.body.outcome : j.outcome;
  // 自動判定を人が直したときは、その返信に出てきた言い回しを覚えて次から同じように振り分ける（#25）
  let learned = 0;
  if (outcome && outcome !== j.outcome && j.outcome_note.startsWith("自動判定")) {
    const body = (j.outcome_note.match(/本文「…([\s\S]*?)…」/)?.[1] ?? "").trim();
    if (body) learned = learnFromCorrection(body, outcome as "replied" | "appointment" | "declined", j.company_name);
  }
  // 反応が変わったら「確認済み」は外す（新しくアポになったものは、もう一度メニューの数字に出す）
  db.prepare(`UPDATE form_jobs SET outcome=?, outcome_note=?, ${outcome !== j.outcome ? "appo_seen_at=NULL, " : ""}updated_at=datetime('now') WHERE id=?`).run(outcome, String(req.body.note ?? "").slice(0, 300), id);
  if (outcome === "declined") {
    if (j.domain) db.prepare("INSERT OR IGNORE INTO form_suppressions(domain, reason) VALUES(?,?)").run(j.domain, `断り（${j.company_name}）`);
    if (j.email) optOut(j.email, `断り（${j.company_name}）`, me(req).id);
  }
  redirectWith(res, String(req.body.back ?? "") === "/appointments" ? "/appointments" : `/jobs/${id}`, `反応を記録しました${learned ? `／この返信の言い回し ${learned}件を覚えました（次から同じ言い回しは「${OUTCOME_LABEL[outcome] ?? outcome}」に振り分けます。設定画面で確認・削除できます）` : ""}`);
});

// ---- jobs ----
app.get("/jobs/:id", (req, res) => {
  const j = ownedJob(req, Number(req.params.id));
  if (!j) return notFound(req, res);
  const c = db.prepare("SELECT * FROM form_campaigns WHERE id=?").get(j.campaign_id) as Campaign;
  // この会社とのやり取りの履歴（#56）。ドメインが無い会社は社名で突き合わせる
  const sc = scope(req);
  const history = db.prepare(`SELECT j.id, c.name campaign_name, j.channel, j.status, j.result_text, j.sent_at, j.updated_at, j.outcome, j.outcome_note
    FROM form_jobs j JOIN form_campaigns c ON c.id=j.campaign_id
    WHERE j.is_test=0 AND ${sc.sql.replace("owner_user_id", "c.owner_user_id")} AND ${j.domain ? "j.domain=?" : "j.company_name=?"}
    ORDER BY COALESCE(j.sent_at, j.updated_at) DESC LIMIT 30`).all(...sc.args, j.domain || j.company_name) as import("../views.js").JobHistory[];
  res.send(layout(j.company_name, jobView(j, c, history), takeFlash(req), navUser(req), appState.updateReady));
});

// 待機中の1社をキャンセル（本送信の対象から外す）
app.post("/jobs/:id/cancel", (req, res) => {
  const id = Number(req.params.id);
  const j = ownedJob(req, id);
  if (!j) return notFound(req, res);
  if (j.status === "queued") db.prepare("UPDATE form_jobs SET status='skip_cancelled', result_text='キャンセルしました', updated_at=datetime('now') WHERE id=?").run(id);
  redirectWith(res, `/campaigns/${j.campaign_id}`, `${j.company_name} をキャンセルしました`);
});

// 削除を元に戻す（#60）
app.post("/undo/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM deleted_jobs WHERE id=? AND user_id=?").get(Number(req.params.id), me(req).id) as { id: number; campaign_id: number; payload: string; rows_count: number; label: string } | undefined;
  if (!row) return redirectWith(res, "/", "元に戻せる削除が見つかりませんでした（30分を過ぎたか、すでに戻しています）");
  let restored = 0;
  try {
    const rows = JSON.parse(row.payload) as Record<string, unknown>[];
    const cols = rows.length ? Object.keys(rows[0]) : [];
    const stmt = db.prepare(`INSERT OR IGNORE INTO form_jobs(${cols.join(",")}) VALUES(${cols.map((c) => `@${c}`).join(",")})`);
    db.transaction(() => { for (const r of rows) restored += stmt.run(r).changes; })();
  } catch (e) {
    logError("undo", `削除の取り消しに失敗: ${jpError(e)}`);
    return redirectWith(res, `/campaigns/${row.campaign_id}`, `元に戻せませんでした: ${jpError(e, 120)}`);
  }
  db.prepare("DELETE FROM deleted_jobs WHERE id=?").run(row.id);
  redirectWith(res, `/campaigns/${row.campaign_id}`, `${restored}件を元に戻しました（${row.label}）。スクリーンショットの画像は戻りません`);
});

app.post("/jobs/:id/delete", (req, res) => {
  const id = Number(req.params.id);
  const j = ownedJob(req, id);
  if (!j) return notFound(req, res);
  // 一覧では同じ会社（ドメイン）を1行にまとめているので、履歴もまとめて消す
  const n = j.domain
    ? deleteJobsWhere(j.campaign_id, "domain=?", [j.domain], { userId: me(req).id, label: `${j.company_name} の削除` })
    : deleteJobsWhere(j.campaign_id, "id=?", [id], { userId: me(req).id, label: `${j.company_name} の削除` });
  redirectWith(res, `/campaigns/${j.campaign_id}`, `${j.company_name} の記録 ${n} 件を送信一覧から削除しました（30分以内なら画面上部から元に戻せます）`);
});

app.post("/jobs/:id/mark-sent", (req, res) => {
  const id = Number(req.params.id);
  const j = ownedJob(req, id);
  if (!j) return notFound(req, res);
  db.prepare("UPDATE form_jobs SET status='sent', result_text='手動で送信済みにしました', sent_at=datetime('now'), updated_at=datetime('now') WHERE id=?").run(id);
  redirectWith(res, todoBack(req, `/jobs/${id}`), `${j.company_name} を「送信済み（手動）」にしました`);
});

// 失敗ジョブの宛先・会社名を直して、その場で送り直す（一覧・詳細の「修正して再送信」）
app.post("/jobs/:id/fix", async (req, res) => {
  const id = Number(req.params.id);
  const j = ownedJob(req, id);
  if (!j) return notFound(req, res);
  const formUrl = String(req.body.form_url ?? "").trim();
  const siteUrl = String(req.body.site_url ?? "").trim();
  const company = String(req.body.company_name ?? "").trim() || j.company_name;
  const email = String(req.body.email ?? "").trim().toLowerCase();
  // 「メールで送信」ボタンなら、フォームURLが入っていてもメールに切り替える
  const via = String(req.body.via ?? "");
  if (via === "email" && !email) return redirectWith(res, `/jobs/${id}#fix`, "メールアドレスを入れてから「メールで送信」を押してください");
  const channel = via === "email" ? "email" : !formUrl && email ? "email" : j.channel === "email" && formUrl ? "form" : j.channel;
  const domain = domainOf(formUrl || siteUrl) || (email ? email.split("@")[1] ?? j.domain : j.domain);
  // status は変えない（直前の失敗ステータスを processJob が履歴として拾えるようにするため）
  db.prepare("UPDATE form_jobs SET form_url=?, site_url=?, company_name=?, email=?, channel=?, domain=?, updated_at=datetime('now') WHERE id=?")
    .run(formUrl, siteUrl, company, email, channel, domain, id);
  // メール送信ではブラウザを使わないので起動しない（そのぶん速く、古いOSでも動く）
  const browser = channel === "email" ? null : await launchBrowser();
  try {
    const r = await processJob(browser as never, id);
    redirectWith(res, `/jobs/${id}`, `${channel === "email" ? "メールで送信した結果" : "修正して再送信した結果"}: ${STATUS_LABEL[r.status] ?? r.status}${r.result_text ? `（${r.result_text.split("\n")[0].slice(0, 60)}）` : ""}`);
  } catch (e) {
    redirectWith(res, `/jobs/${id}`, `再送信エラー: ${String((e as Error).message)}`);
  } finally {
    await browser?.close().catch(() => {});
  }
});

// 要確認の質問に画面で回答して、その回答でその場で送り直す
app.post("/jobs/:id/answer", async (req, res) => {
  const id = Number(req.params.id);
  const j = ownedJob(req, id);
  if (!j) return notFound(req, res);
  const answers: { label: string; answer: string }[] = [];
  for (let i = 0; i < 30; i++) {
    const label = String(req.body[`q_label_${i}`] ?? "").trim();
    if (!label) continue;
    const raw = req.body[`q_ans_${i}`];
    const answer = (Array.isArray(raw) ? raw.map(String) : raw !== undefined ? [String(raw)] : []).map((s) => s.trim()).filter(Boolean).join("／");
    if (answer) answers.push({ label: label.slice(0, 80), answer: answer.slice(0, 200) });
  }
  if (!answers.length) return redirectWith(res, `/jobs/${id}`, "回答が選ばれていません");
  db.prepare("UPDATE form_jobs SET manual_answers=?, updated_at=datetime('now') WHERE id=?").run(JSON.stringify(answers), id);
  const browser = await launchBrowser();
  try {
    const r = await processJob(browser, id);
    redirectWith(res, `/jobs/${id}`, `回答を反映して再送信した結果: ${STATUS_LABEL[r.status] ?? r.status}`);
  } catch (e) {
    redirectWith(res, `/jobs/${id}`, `再送信エラー: ${String((e as Error).message)}`);
  } finally {
    await browser.close().catch(() => {});
  }
});

// 画面にブラウザを開いてフォームを入力した状態で止める（送信はしない）。人が確認して送るための補助
app.post("/jobs/:id/assist", async (req, res) => {
  const id = Number(req.params.id);
  const j = ownedJob(req, id);
  if (!j) return forbidden(req, res);
  const c = loadCampaignFull(req, j.campaign_id);
  if (!c) return notFound(req, res);
  try {
    // 文面は一度作ったもの（message_used）を優先。無ければ作る（HP本文はキャッシュがあれば使う）
    const site = (db.prepare("SELECT title, text FROM site_cache WHERE domain=?").get(j.domain) as { title: string; text: string } | undefined) ?? { title: "", text: "" };
    const comp = await composeMessage(j, c.sender, c, site);
    const message = j.message_used || comp.message;
    const r = await openAndFill({ formUrl: j.form_url, siteUrl: j.site_url, sender: c.sender, subject: comp.subject, message });
    redirectWith(res, todoBack(req, `/jobs/${id}`), r.ok
      ? `ブラウザを開いて${r.detail}。送信したら「送信済みにする」を押してください`
      : `ブラウザを開きました：${r.detail}`);
  } catch (e) {
    redirectWith(res, todoBack(req, `/jobs/${id}`), `ブラウザを開けませんでした: ${jpError(e, 150)}`);
  }
});

app.post("/jobs/:id/retry", async (req, res) => {
  const id = Number(req.params.id);
  if (!ownedJob(req, id)) return forbidden(req, res);
  const browser = await launchBrowser();
  try {
    const j = await processJob(browser, id);
    redirectWith(res, `/jobs/${id}`, `再試行の結果: ${j.status}`);
  } finally {
    await browser.close().catch(() => {});
  }
});

// 1社だけ待機に戻す（もう一度自動で送る）
app.post("/jobs/:id/requeue", (req, res) => {
  const id = Number(req.params.id);
  const j = ownedJob(req, id);
  if (!j) return notFound(req, res);
  db.prepare("UPDATE form_jobs SET status='queued', result_text='待機に戻しました（手動）', updated_at=datetime('now') WHERE id=?").run(id);
  db.prepare("UPDATE form_jobs SET dismissed_at=NULL WHERE id=?").run(id);
  redirectWith(res, todoBack(req, `/jobs/${id}`), `${j.company_name} を待機中に戻しました（キャンペーンを開始すると送信します）`);
});

// この会社を除外リストに入れる（今後すべてのキャンペーンで送らない）
app.post("/jobs/:id/suppress", (req, res) => {
  const id = Number(req.params.id);
  const j = ownedJob(req, id);
  if (!j) return notFound(req, res);
  if (j.domain) db.prepare("INSERT OR IGNORE INTO form_suppressions(company_name, domain, reason, owner_user_id) VALUES(?,?,?,?)").run(j.company_name, j.domain, "要対応の画面から除外", me(req).id);
  if (j.email) optOut(j.email, `除外（${j.company_name}）`, me(req).id);
  db.prepare("UPDATE form_jobs SET status='skip_suppressed', result_text='除外リストに追加（手動）', updated_at=datetime(\'now\') WHERE id=?").run(id);
  redirectWith(res, todoBack(req, `/jobs/${id}`), `${j.company_name} を除外リストに追加しました`);
});
}
