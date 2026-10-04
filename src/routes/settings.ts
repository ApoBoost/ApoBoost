// 設定・アップデート・動作チェック・バックアップ
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
import { topHelpMisses } from "../support.js";
import { errorPage } from "../ui/layout.js";
import { esc, layout, lawView, todoView, todoRunView, setupView, checklistView, reportView, campaignListView, sendersView, type SenderExtra, campaignForm, campaignView, jobView, suppressionsView, settingsView, loginPage, passwordView, usersView, updateView, testView, gameView, guideView, statsView, importPreviewView, logsView, healthView, errKind, type NavUser } from "../views.js";
import { authMiddleware, renameUser, requireAdmin, startSession, endSession, findUser, verifyPassword, createUser, setPassword, listUsers, ensureFirstAdmin, randomPassword, cleanupSessions, type AuthedRequest } from "../auth.js";
import { app, db, redirectWith, takeFlash, me, appState, navUser, scope, SENDER_COLS, setSetting, updateResults } from "../app/context.js";

/** この画面の経路を登録する。server.ts から、ログイン確認などの共通処理のあとに呼ばれる */
export function register(): void {
// データのバックアップ書き出し（自分の送信者・キャンペーン・送信履歴をJSONで。復元機能は付けない）
// 認証情報（SMTPアプリパスワード・AIキー）は安全のため含めない
app.get("/backup.json", (req, res) => {
  const sc = scope(req);
  const senders = db.prepare(`SELECT id, ${SENDER_COLS.join(", ")} FROM sender_profiles WHERE ${sc.sql} ORDER BY id`).all(...sc.args);
  const campaigns = db.prepare(`SELECT * FROM form_campaigns WHERE ${sc.sql} ORDER BY id`).all(...sc.args);
  const jobs = db.prepare(`SELECT j.* FROM form_jobs j JOIN form_campaigns c ON c.id=j.campaign_id WHERE ${sc.sql.replace("owner_user_id", "c.owner_user_id")} AND j.is_test=0 ORDER BY j.id`).all(...sc.args);
  const out = { app: "apoboost", version: currentVersion(), exported_at: new Date().toISOString(), note: "バックアップ（閲覧用）。SMTPパスワード・AIキーは含みません。復元機能はありません。", senders, campaigns, jobs };
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("content-disposition", `attachment; filename=apoboost-backup-${stamp}.json`);
  res.send(JSON.stringify(out, null, 2));
});

// ミニゲーム（誰でも遊べる息抜き）。クレジットは「自分のキャンペーンでフォーム送信できた件数」から貯まる
// おまけのゲームの表示オン／オフ（管理者のみ）
app.post("/settings/notify", (req, res) => {
  db.prepare("INSERT INTO settings(key,value) VALUES('notify_desktop',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(req.body.notify_desktop === "1" ? "1" : "0");
  redirectWith(res, "/settings", req.body.notify_desktop === "1" ? "送信が止まったときにパソコンへ通知します" : "パソコンへの通知をオフにしました");
});

// 通知の見え方を確認する
app.post("/settings/notify-test", (req, res) => {
  notify("テスト通知", `この通知が出れば設定はOKです（${new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" })} に送信）`, `test:${Date.now()}`);
  redirectWith(res, "/settings", "テスト通知を送りました。数秒以内に、このページの右上と、パソコンの通知に出ます");
});

// 一覧と要対応の設定（#103 #115）
app.post("/settings/lists", requireAdmin, (req, res) => {
  saveSettingValue(S.todoHideDays, Math.min(365, Math.max(1, Math.round(Number(req.body.todo_hide_days) || 30))));
  saveSettingValue(S.listPageSize, [50, 100, 200].includes(Number(req.body.list_page_size)) ? Number(req.body.list_page_size) : 100);
  redirectWith(res, "/settings", "保存しました");
});

// キャラクターの表示（#135）
app.post("/settings/effects", requireAdmin, (req, res) => {
  saveSettingValue(S.effectsEnabled, req.body.effects_enabled === "1");
  redirectWith(res, "/settings", req.body.effects_enabled === "1" ? "キャラクターを表示します" : "キャラクターを非表示にしました");
});

// 通知の種類（#133 #134）
app.post("/settings/notify-kinds", (req, res) => {
  saveSettingValue(S.notifyReply, req.body.notify_reply === "1");
  saveSettingValue(S.dailySummary, req.body.daily_summary === "1");
  redirectWith(res, "/settings", "通知の設定を保存しました");
});

app.post("/settings/game", requireAdmin, (req, res) => {
  const on = req.body.game_enabled === "1";
  db.prepare("INSERT INTO settings(key,value) VALUES('game_enabled',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(on ? "1" : "0");
  redirectWith(res, "/settings", on ? "おまけのゲームを表示します（共有用URLでは表示されません）" : "おまけのゲームを非表示にしました");
});

// ---- 動作チェック・エラーログ・診断ファイル・バックアップ ----// ---- 動作チェック・エラーログ・診断ファイル・バックアップ ----
// 「動かない」の原因を、聞き出すやり取りなしで利用者自身が切り分けられるようにするための画面。
app.get("/health", (req, res) => {
  const checks = healthChecks();
  const backups = listBackups();
  const state = {
    autostart: { supported: autostartSupported(), enabled: autostartEnabled(), path: autostartPath() },
    autoUpdate: getSetting(S.autoUpdate, "0") === "1",
    awakeNote: AWAKE_NOTE,
    logs: logCounts(),
    backups: backups.slice(0, 10).map((b) => ({ file: b.file, label: backupLabel(b) })),
    backupDir: BACKUP_DIR,
    isAdmin: me(req).role === "admin",
  };
  res.send(layout("動作チェック", healthView(checks, state), takeFlash(req), navUser(req), appState.updateReady));
});

app.get("/logs", (req, res) => {
  const kind = ["error", "warn", "info"].includes(String(req.query.kind)) ? String(req.query.kind) : "";
  res.send(layout("エラーログ", logsView(recentLogs(200, kind), kind, logCounts(), topHelpMisses(20)), takeFlash(req), navUser(req), appState.updateReady));
});

app.post("/logs/clear", (req, res) => {
  const n = clearLogs();
  redirectWith(res, "/logs", `${n}件のログを消しました`);
});

// サポートに送ってもらう1ファイル（パスワード・APIキーは入っていない）
app.get("/diagnostics.txt", (req, res) => {
  const stamp = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 16).replace(/[:T]/g, "-");
  res.setHeader("content-type", "text/plain; charset=utf-8");
  res.setHeader("content-disposition", `attachment; filename=apoboost-shindan-${stamp}.txt`);
  res.send(diagnosticsText());
});

// 取り込み用CSVの見本（列名で迷わないように）
app.get("/template.csv", (req, res) => {
  const rows = [
    ["企業名", "企業URL", "問い合わせフォーム", "メール", "業界", "都道府県", "代表者名"],
    ["株式会社サンプル商事", "https://example.co.jp/", "https://example.co.jp/contact/", "info@example.co.jp", "製造", "東京都", "山田 太郎"],
    ["サンプル工業株式会社", "https://example2.co.jp/", "", "", "建設", "大阪府", ""],
  ];
  // Excelでそのまま開けるように BOM 付きUTF-8で返す
  const csv = "﻿" + rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\r\n") + "\r\n";
  res.setHeader("content-type", "text/csv; charset=utf-8");
  res.setHeader("content-disposition", "attachment; filename=apoboost-list-template.csv");
  res.send(csv);
});

app.post("/backup/create", async (req, res) => {
  try {
    const b = await createBackup("manual");
    redirectWith(res, "/health", `バックアップを作りました（${backupLabel(b)}）。保存先: ${BACKUP_DIR}`);
  } catch (e) {
    logError("backup", `手動バックアップに失敗: ${jpError(e)}`);
    redirectWith(res, "/health", `バックアップに失敗しました: ${jpError(e, 160)}`);
  }
});

// 復元は「予約 → 再起動時に入れ替え」。動いている最中にDBファイルを差し替えると壊れるため
app.post("/backup/restore", requireAdmin, async (req, res) => {
  const file = String(req.body.file ?? "");
  const r = requestRestore(file);
  if (!r.ok) return redirectWith(res, "/health", r.error ?? "復元できませんでした");
  logInfo("backup", `復元を予約: ${file}`);
  res.send(layout("復元します", `<div class="card"><h1>バックアップから復元します</h1>
    <p>「${esc(file)}」の内容に戻します。いまのデータは念のため <code>data/backups</code> に退避します。</p>
    <p class="muted">送信中の会社があれば、送り終わるのを待ってから再起動します（最大2分）。再起動後、この画面をもう一度開いてください。</p>
    <p><a class="btn" href="/">画面に戻る（30秒ほど待ってから）</a></p></div>`, "", navUser(req), appState.updateReady));
  await drainForShutdown();
  requestRestart();
});

app.post("/settings/autostart", requireAdmin, (req, res) => {
  const on = req.body.autostart === "1";
  const r = on ? enableAutostart() : disableAutostart();
  redirectWith(res, "/health", r.message);
});

app.post("/settings/auto-update", requireAdmin, (req, res) => {
  const on = req.body.auto_update === "1";
  saveSetting(S.autoUpdate, on ? "1" : "0");
  redirectWith(res, "/health", on ? "新しい版が出たら、起動時に自動で更新します（送信中は送り終わってから）" : "自動更新をオフにしました（「新しい版があります」を押して更新してください）");
});

app.get("/settings", requireAdmin, (req, res) => {
  // 設定は管理者のみ（全体を見られる）なので、件数は全体の合計を出す。集計するだけの追加表示
  const one = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  const stats = {
    senders: one("SELECT COUNT(*) n FROM sender_profiles"),
    campaigns: one("SELECT COUNT(*) n FROM form_campaigns"),
    // 会社（ドメイン）単位の重複を除いた実数＝「社」。ドメインが無い行はidで個別に数える
    companies: one("SELECT COUNT(DISTINCT COALESCE(NULLIF(domain,''), CAST(id AS TEXT))) n FROM form_jobs WHERE is_test=0"),
    sent: one("SELECT COUNT(DISTINCT COALESCE(NULLIF(domain,''), CAST(id AS TEXT))) n FROM form_jobs WHERE is_test=0 AND status='sent'"),
    suppressions: one("SELECT COUNT(*) n FROM form_suppressions"),
    optouts: one("SELECT COUNT(*) n FROM email_optouts"),
  };
  res.send(layout("設定", settingsView(loadNgWords(), activeAiConfig(), stats, getSetting(S.gameEnabled, "0") === "1", notifyEnabled(), { usage: aiUsageThisMonth(), limit: aiMonthlyLimit() }, { status: licenseStatus(), key: getSetting(S.licenseKey, ""), enforce: licenseEnforced() }, { effects: settingOn(S.effectsEnabled), notifyReply: settingOn(S.notifyReply), dailySummary: settingOn(S.dailySummary), todoHideDays: settingNum(S.todoHideDays, 1, 365), listPageSize: settingNum(S.listPageSize, 50, 200), sendPace: setting(S.sendPace) }), takeFlash(req), navUser(req), appState.updateReady));
});

app.post("/settings", requireAdmin, (req, res) => {
  const words = String(req.body.ng_words ?? "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  db.prepare("INSERT INTO settings(key,value) VALUES('ng_words',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(words));
  redirectWith(res, "/settings", "保存しました");
});

app.post("/settings/ai", requireAdmin, async (req, res) => {
  const provider = req.body.provider === "gemini" ? "gemini" : "anthropic";
  const model = String(req.body.model ?? "").trim();
  const key = String(req.body.api_key ?? "").trim();
  const validModel = AI_MODELS[provider].some((m) => m.id === model) ? model : AI_MODELS[provider][0].id;
  // キー欄が空のままなら、保存済みのキーを使い続ける（マスク表示のため毎回入力させない）
  const existing = (db.prepare("SELECT value FROM settings WHERE key='ai_api_key'").get() as { value: string } | undefined)?.value ?? "";
  const apiKey = key || existing;
  if (!apiKey) return redirectWith(res, "/settings", "APIキーを入力してください");
  setSetting.run("ai_provider", provider);
  setSetting.run("ai_model", validModel);
  setSetting.run("ai_api_key", apiKey);
  const err = await testAiConnection();
  if (err) {
    redirectWith(res, "/settings", `保存しましたが、接続テストに失敗しました: ${err}`);
  } else {
    redirectWith(res, "/settings", `接続テスト成功。AIが使えるようになりました（${provider} / ${validModel}）`);
  }
});

// ライセンス（#90）
app.post("/settings/license", requireAdmin, (req, res) => {
  const st = setLicenseKey(String(req.body.key ?? ""));
  redirectWith(res, "/settings", st.state === "valid" ? `ライセンスを登録しました: ${st.label}` : st.state === "none" ? "ライセンスキーを削除しました" : `ライセンスを保存しましたが、状態は「${st.label}」です`);
});

app.post("/settings/license-enforce", requireAdmin, (req, res) => {
  const on = req.body.enforce === "1";
  saveSetting(S.licenseEnforce, on ? "1" : "0");
  redirectWith(res, "/settings", on ? "ライセンスが無い・期限切れのときは、1日50件までに制限します" : "ライセンスによる制限をオフにしました（制限なく動きます）");
});

// AIの月の上限（#66）
app.post("/settings/ai-budget", requireAdmin, (req, res) => {
  const limit = Math.max(0, Math.round(Number(req.body.limit) || 0));
  saveSetting(S.aiMonthlyLimit, String(limit));
  redirectWith(res, "/settings", limit ? `今月のAI利用の上限を ${limit.toLocaleString("ja-JP")}円 にしました（超えたらテンプレートの文面で送り続けます）` : "AI利用の上限を解除しました");
});

app.post("/settings/ai/delete", requireAdmin, (req, res) => {
  db.prepare("DELETE FROM settings WHERE key IN ('ai_provider','ai_api_key','ai_model')").run();
  redirectWith(res, "/settings", "AI設定を削除しました。テンプレートのみで動きます（AI: none）");
});

// 更新チャネルの切り替え（#94）
app.post("/settings/update-channel", requireAdmin, async (req, res) => {
  const ch = req.body.channel === "beta" ? "beta" : "stable";
  saveSetting(S.updateChannel, ch);
  const st = await checkUpdate(true);
  appState.updateReady = st.available;
  redirectWith(res, "/update", ch === "beta" ? "先行版を受け取る設定にしました（新しい機能を先に試せますが、不具合が残っていることがあります）" : "安定版を受け取る設定にしました");
});

app.get("/update", requireAdmin, async (req, res) => {
  const st = await checkUpdate();
  appState.updateReady = st.available;
  const result = updateResults.get(me(req).id);
  updateResults.delete(me(req).id);
  res.send(layout("アップデート", updateView(st, result, updateChannel()), takeFlash(req), navUser(req), appState.updateReady));
});

app.post("/update/check", requireAdmin, async (req, res) => {
  const st = await checkUpdate(true);
  appState.updateReady = st.available;
  redirectWith(res, "/update", st.available ? `v${st.latest} が公開されています` : st.error ?? "最新版です");
});

app.post("/update", requireAdmin, async (req, res) => {
  const r = await applyUpdate();
  updateResults.set(me(req).id, r);
  if (r.ok) {
    appState.updateReady = false;
    await drainForShutdown(); // 送信中の会社を途中で切らない
    requestRestart();   // npm start で起動していれば自動で立ち上がり直す
  }
  res.redirect("/update");
});
}
