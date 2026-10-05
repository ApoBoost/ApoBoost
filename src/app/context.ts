// どの画面の経路からも使う共通の道具（アプリ本体・DB・権限チェック・お知らせ・集計の関数など）。
// もともと server.ts の先頭や途中に散らばっていたものを1か所に集めた（#139）。
// 管理画面（localhost）。
import express from "express";
import { S, setting, settingOn, settingNum, saveSettingValue, setupEmailSkippedFor } from "../settings.js";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { getDb, getSetting, setSetting as saveSetting, SCREENSHOT_DIR, MATERIAL_DIR, domainOf, jst, channelMode, STATUS_LABEL, OUTCOME_LABEL, sentTodaySql, todayJst, type Campaign, type Job, type SenderProfile } from "../db.js";
import { parseCompanyCsv, parseCompanyXlsx, importRowsToCampaign, parseSuppressionCsv, parseSuppressionText, importSuppressions, type ImportSummary, type CompanyRow } from "../csv.js";
import { composeMessage, activeProvider, activeAiConfig, aiStatusLabel, testAiConnection, AI_MODELS, DEFAULT_TEMPLATE, loadNgWords, lintMessage, aiUsageThisMonth, aiMonthlyLimit } from "../message.js";
import { optOut, testSmtp, explainSmtpError, checkSmtpPassword, emailPause, clearEmailPause, senderEmailOk, buildEmailBody } from "../email.js";
import { logError, logInfo, recentLogs, clearLogs, logCounts } from "../applog.js";
import { jpError } from "../jp.js";
import { healthChecks, diagnosticsText } from "../health.js";
import { createBackup, listBackups, requestRestore, autoBackupIfDue, backupLabel, BACKUP_DIR } from "../backup.js";
import { autostartEnabled, autostartSupported, enableAutostart, disableAutostart, autostartPath } from "../autostart.js";
import { releaseAwakeAll, AWAKE_NOTE } from "../awake.js";
import { licenseStatus, setLicenseKey, licenseEnforced, cappedDailyLimit, licenseBlock } from "../license.js";
import { syncShare, shareConfigured, APPS_SCRIPT, KEY as SHARE_KEY } from "../share.js";
import { drainForShutdown, clearStaleRuns, runCampaign, requestStop, isRunning, isScanning, scanCampaign, processJob, inSendWindow, sentToday, sentTodayBySender, warmupLimit, effectiveEmailLimit, nextWindowText, aiPause, emailSenderIds, pickEmailSender } from "../worker.js";
import { launchBrowser, openAndFill } from "../engine.js";
import { checkReplies, isCheckingReplies, replyScanStatus, verifyInterruptedEmails, learnFromCorrection, loadReplyRules, clearReplyRulesCache } from "../replies.js";
import { notify, notifyEnabled } from "../notify.js";
import { checkUpdate, applyUpdate, requestRestart, currentVersion, updateChannel, isDevCheckout } from "../update.js";
import { errorPage, n as fmtN } from "../ui/layout.js";
import { templateProblems } from "../ui/parts.js";
import { esc, layout, lawView, todoView, todoRunView, setupView, checklistView, reportView, campaignListView, sendersView, type SenderExtra, campaignForm, campaignView, jobView, suppressionsView, settingsView, loginPage, passwordView, usersView, updateView, testView, gameView, guideView, statsView, importPreviewView, logsView, healthView, errKind, type NavUser } from "../views.js";
import { authMiddleware, renameUser, requireAdmin, startSession, endSession, findUser, verifyPassword, createUser, setPassword, listUsers, ensureFirstAdmin, randomPassword, cleanupSessions, type AuthedRequest } from "../auth.js";

export const app = express();

// ゲームの音声など静的アセット（src の1つ上の assets/ を配信）
// このファイルは src/app/ にあるので、2つ上がアプリのフォルダ
// アプリのフォルダ（起動したフォルダ）から見る。配布版は src を1つのファイル（app/server.mjs）に固めるので、
// このファイルの場所から数えると、開発版と配布版で行き先がずれる
export const ASSETS_DIR = path.resolve(process.cwd(), "assets");

// fieldSize は貼り付け欄（文字）の上限。multer（busboy）の既定は1MBで、4,000社ほどのリストを貼ると超えて
// 理由の分からない500ページになっていた。ファイルと同じくらいまで受け付ける
export const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024, fieldSize: 20 * 1024 * 1024 } });

/** upload.single を包み、大きすぎる貼り付け・ファイルなどの読み取りの失敗を、元の画面に戻して日本語で知らせる。
 *  そのままだと共通のエラーページ（server.ts）に落ち、何が悪かったのか分からなかった */
export function uploadSingle(field: string, back: (req: express.Request) => string): express.RequestHandler {
  const mw = upload.single(field);
  return (req, res, next) => mw(req, res, (err?: unknown) => {
    if (!err) return next();
    const code = (err as { code?: string }).code ?? "";
    const msg = code === "LIMIT_FIELD_VALUE" ? "貼り付けが大きすぎます（20MBまで）。ファイルで取り込むか、何回かに分けて貼り付けてください"
      : code === "LIMIT_FILE_SIZE" ? "ファイルが大きすぎます（50MBまで）。ファイルを分けてから取り込んでください"
      : `送った内容を読み取れませんでした。もう一度お試しください（${jpError(err, 80)}）`;
    logError("page", `${req.method} ${req.path}: 送信内容の読み取りに失敗（${code || jpError(err, 120)}）`);
    redirectWith(res, back(req), msg);
  });
}

export const db = getDb();

export const flashes = new Map<string, string>();

/** お知らせを取り出すときの鍵＝「ユーザーID:パス」。
 *  行き先の文字列そのままを鍵にしていたころは、`/todo?kind=captcha` や `/jobs/5#fix` に送ると
 *  表示側（req.path は ? と # を含まない）と食い違って出なかった。ユーザー別にしないと、
 *  同じ画面を開いた別の人に他人のお知らせが出ることもあった。 */
export function flashKey(userId: number | undefined, to: string): string {
  const p = String(to ?? "").split(/[?#]/)[0] || "/";
  return `${userId ?? 0}:${p}`;
}

/** お知らせを積む。取り出されないまま溜まり続けないよう、古いものから捨てる */
export function setFlash(req: express.Request, to: string, msg: string) {
  const key = flashKey((req as AuthedRequest).user?.id, to);
  flashes.delete(key); // 入れ直して「新しい」側に並べる
  flashes.set(key, msg);
  while (flashes.size > 1000) flashes.delete(flashes.keys().next().value as string);
}

export function redirectWith(res: express.Response, to: string, msg: string) {
  setFlash(res.req, to, msg);
  res.redirect(to);
}

export function takeFlash(req: express.Request) {
  const own = flashKey((req as AuthedRequest).user?.id, req.path);
  // ログイン前に積んだもの（ユーザー不明＝0）も拾う
  const anon = flashKey(undefined, req.path);
  const m = flashes.get(own) ?? flashes.get(anon) ?? "";
  flashes.delete(own);
  flashes.delete(anon);
  return m;
}

/** async の経路を包む。Express 4 は async 関数の失敗（reject）を拾わないため、
 *  途中で例外が出ると応答が返らず、画面が「読み込み中」のまま固まっていた。
 *  back を渡せばその画面に戻して日本語のお知らせを出し、無ければ共通のエラーページ（server.ts）に回す */
export function safeAsync(
  fn: (req: express.Request, res: express.Response, next: express.NextFunction) => unknown,
  back?: (req: express.Request) => string,
  label = "処理の途中でエラーが起きました",
): express.RequestHandler {
  return (req, res, next) => {
    Promise.resolve()
      .then(() => fn(req, res, next))
      .catch((e) => {
        if (res.headersSent) { logError("page", `${req.method} ${req.path}: ${jpError(e, 300)}`); return; }
        if (!back) return next(e);
        logError("page", `${req.method} ${req.path}: ${jpError(e, 300)}`);
        redirectWith(res, back(req), `${label}: ${jpError(e, 160)}`);
      });
  };
}

/** この送り方でブラウザが要るか。メールはブラウザを使わない（起動しないぶん速く、ブラウザが入っていないPCでも送れる）。
 *  ただし文面をAIで書くモードは、相手のHPを読むのにブラウザを使うのでメールでも起動する
 *  （起動しないと「文面生成エラー」になる。worker.ts の getSiteInfo と同じ条件） */
export function needsBrowser(channel: string, campaignId: number): boolean {
  if (channel !== "email") return true;
  const c = db.prepare("SELECT mode FROM form_campaigns WHERE id=?").get(campaignId) as { mode: string } | undefined;
  return (c?.mode === "ai" || c?.mode === "hybrid") && activeProvider() !== "none";
}

/** 全体に効く設定を、管理者だけが変えられるようにする。
 *  requireAdmin と違って行き止まりの403にせず、元の画面に戻して理由を出す
 *  （除外リストの画面などは一般ユーザーにもフォームが見えているため） */
export function adminOnly(back: string, msg = "この設定は全員に効くため、管理者だけが変更できます。管理者に依頼してください") {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if ((req as AuthedRequest).user?.role === "admin") return next();
    redirectWith(res, back, msg);
  };
}

/** キャンペーンの数値の入力を読む。
 *  以前は `Number(x) || 既定値` で、0（例: メールは送らない＝メール上限0、0時開始）が既定値に戻っていた。
 *  空欄・数字でないものは fallback（新規は既定値、編集は今の値）。範囲外は端に寄せる。
 *  開始≧終了の時間帯は送る時間が無くなるので保存せず、fallback の時間帯に戻して理由を返す。
 *  再送禁止期間は、空欄を「0＝制限なし」にしない（安全装置が知らないうちに外れないように） */
export function campaignNumbers(b: Record<string, unknown>, fb: { daily_limit: number; email_daily_limit: number; send_window_start: number; send_window_end: number; resend_days: number }) {
  const num = (v: unknown, def: number, min: number, max: number) => {
    const s = String(v ?? "").trim();
    const x = s === "" ? NaN : Number(s.normalize("NFKC"));
    return Number.isFinite(x) ? Math.min(max, Math.max(min, Math.round(x))) : def;
  };
  const out = {
    daily_limit: num(b.daily_limit, fb.daily_limit, 0, 100000),
    email_daily_limit: num(b.email_daily_limit, fb.email_daily_limit, 0, 100000),
    send_window_start: num(b.send_window_start, fb.send_window_start, 0, 23),
    send_window_end: num(b.send_window_end, fb.send_window_end, 1, 24),
    resend_days: num(b.resend_days, fb.resend_days, 0, 3650),
    note: "",
  };
  if (out.send_window_start >= out.send_window_end) {
    // 戻し先（今の値）まで壊れていたら既定の 9〜18時にする
    const ok = fb.send_window_start < fb.send_window_end;
    const s0 = ok ? fb.send_window_start : 9, e0 = ok ? fb.send_window_end : 18;
    out.note = `送信時間帯の開始（${out.send_window_start}時）が終了（${out.send_window_end}時）と同じか後になっていたため、${s0}〜${e0}時にしました。変えるときは「開始 < 終了」で入れ直してください`;
    out.send_window_start = s0;
    out.send_window_end = e0;
  }
  return out;
}

export const CAMPAIGN_NUM_DEFAULTS = { daily_limit: 300, email_daily_limit: 100, send_window_start: 9, send_window_end: 18, resend_days: 90 };

// ---- ログイン中のユーザー ----
export function me(req: express.Request) {
  const u = (req as AuthedRequest).user;
  if (!u) throw new Error("not authenticated");
  return u;
}

// stopping: 終了の合図を受けて、送信中の会社が終わるのを待っているあいだ true（/healthz で返す。server.ts の二重起動の判定に使う）
export const appState = { updateReady: false, stopping: false };

export function refreshUpdateFlag() {
  checkUpdate().then((st) => { appState.updateReady = st.available; }).catch(() => {});
}

// おまけゲームは「メインのポート」でだけ表示する。別ポート(=CLEAN_PORT)で開くとゲームが一切出ない
// ＝人に画面を見せるときはそちらのURLを使う（同じデータ・同じログイン）。
export const GAME_PORT = Number(process.env.PORT ?? 3210);

export const CLEAN_PORT = Number(process.env.CLEAN_PORT ?? GAME_PORT + 1);

export function gameOnFor(req: express.Request): boolean {
  // ゲームとキャラクターは使わないので、設定画面の項目ごと無くした。環境変数 GAME=1 を付けて起動したときだけ出す
  if (process.env.GAME !== "1") return false;
  if (getSetting(S.gameEnabled, "0") !== "1") return false; // 設定画面でオンにしたときだけ（新しく入れたPCは最初オフ）
  return req.socket.localPort !== CLEAN_PORT; // CLEAN_PORT 以外（＝メイン）ではON
}

export function navUser(req: express.Request): NavUser {
  const u = (req as AuthedRequest).user;
  if (!u) return null;
  // 上の帯に「要対応 N」を出す（対応が必要な会社があることに気づけるように）
  let todo = 0;
  try {
    const sc = scope(req);
    todo = (db.prepare(`SELECT COUNT(*) n FROM form_jobs j JOIN form_campaigns c ON c.id=j.campaign_id
      WHERE j.is_test=0 AND ${sc.sql.replace("owner_user_id", "c.owner_user_id")} AND ${TODO_ANY} AND ${todoActive()}`).get(...sc.args) as { n: number }).n;
  } catch { /* 起動直後など */ }
  // 上の帯に「アポ N」を出す
  let appo = 0;
  try {
    const sc = scope(req);
    appo = (db.prepare(`SELECT COUNT(*) n FROM form_jobs j JOIN form_campaigns c ON c.id=j.campaign_id
      WHERE j.is_test=0 AND j.outcome='appointment' AND j.appo_seen_at IS NULL AND ${sc.sql.replace("owner_user_id", "c.owner_user_id")}`).get(...sc.args) as { n: number }).n;
  } catch { /* 起動直後など */ }
  return { username: u.username, display_name: u.display_name, role: u.role, gameOn: gameOnFor(req), todo, appo, path: req.path, effects: process.env.GAME === "1" && settingOn(S.effectsEnabled) && req.socket.localPort !== CLEAN_PORT };
}

/** 管理者は全部、一般ユーザーは自分のものだけ */
export function scope(req: express.Request): { sql: string; args: number[] } {
  const u = me(req);
  return u.role === "admin" ? { sql: "1=1", args: [] } : { sql: "owner_user_id=?", args: [u.id] };
}

export function ownedCampaign(req: express.Request, id: number): Campaign | undefined {
  const sc = scope(req);
  return db.prepare(`SELECT * FROM form_campaigns WHERE id=? AND ${sc.sql}`).get(id, ...sc.args) as Campaign | undefined;
}

export function ownedSender(req: express.Request, id: number): SenderProfile | undefined {
  const sc = scope(req);
  return db.prepare(`SELECT * FROM sender_profiles WHERE id=? AND ${sc.sql}`).get(id, ...sc.args) as SenderProfile | undefined;
}

/** ジョブは所属キャンペーン経由で権限を見る */
export function ownedJob(req: express.Request, id: number): Job | undefined {
  const j = db.prepare("SELECT * FROM form_jobs WHERE id=?").get(id) as Job | undefined;
  if (!j) return undefined;
  return ownedCampaign(req, j.campaign_id) ? j : undefined;
}

export const TODO_WHERE: Record<string, string> = {
  captcha: "j.status='skip_captcha'",
  check: "j.status='failed' AND j.result_text LIKE '要確認%'",
  failed: "j.status='failed' AND j.result_text NOT LIKE '要確認%'",
  noform: "j.status='skip_no_form'",
};

export const TODO_ANY = `(${Object.values(TODO_WHERE).join(" OR ")})`;

/** いま手を打つべきもの＝見送っておらず、古すぎないもの（#115）。
 *  古い失敗が今日の失敗と同じ場所に並ぶと、要対応が「対応できない数」になる */
export function todoActive(): string {
  const days = settingNum(S.todoHideDays, 1, 3650);
  return `(j.dismissed_at IS NULL AND j.updated_at > datetime('now','-${days} days'))`;
}

export function todoDismissed(): string {
  const days = settingNum(S.todoHideDays, 1, 3650);
  return `(j.dismissed_at IS NOT NULL OR j.updated_at <= datetime('now','-${days} days'))`;
}

/** 要対応の中での優先度（#113）。送れそう度が高く、新しく、メールの逃げ道もあるものを上に */
export const TODO_PRIO = `((CASE WHEN j.scan_score >= 0 THEN j.scan_score ELSE 50 END)
  + (CASE WHEN j.updated_at > datetime('now','-3 days') THEN 25 WHEN j.updated_at > datetime('now','-7 days') THEN 10 ELSE 0 END)
  + (CASE WHEN j.status='skip_captcha' THEN 15 WHEN j.result_text LIKE '要確認%' THEN 20 WHEN j.result_text LIKE '%入力エラー%' THEN 10 ELSE 0 END)
  + (CASE WHEN j.email<>'' THEN 5 ELSE 0 END))`;

export const DENIED = "この画面を見る権限がありません";

/** 行き止まりにしないエラーページ（#105） */
export function notFound(req: express.Request, res: express.Response) { return res.status(404).send(errorPage(404, navUser(req))); }

export function forbidden(req: express.Request, res: express.Response) { return res.status(403).send(errorPage(403, navUser(req))); }

/** グループの選択肢に出すキャンペーン（昔のキャンペーンも含む全件） */
export function groupCandidates(req: express.Request): { id: number; name: string; group_name: string }[] {
  const sc = scope(req);
  return db.prepare(`SELECT id, name, group_name FROM form_campaigns WHERE ${sc.sql} ORDER BY id DESC`).all(...sc.args) as { id: number; name: string; group_name: string }[];
}

/** グループのメンバーを保存する。チェックしたキャンペーンを同じグループにし、
 *  以前このグループにいてチェックを外したキャンペーンはグループから外す。
 *  グループ名が空でチェックがあれば、チェックした中の既存グループ名 → このキャンペーン名 の順で決める */
export function applyGroupMembers(req: express.Request, selfId: number, prevGroup: string, body: Record<string, unknown>) {
  const raw = body.group_members;
  const own = new Map(groupCandidates(req).map((c) => [c.id, c]));
  const ids = (Array.isArray(raw) ? raw : raw != null ? [raw] : []).map((v) => Number(v)).filter((n) => n !== selfId && own.has(n));
  const self = own.get(selfId);
  let g = String(body.group_name ?? "").trim();
  if (!g && ids.length) g = ids.map((i) => own.get(i)!.group_name).find((x) => x) || self?.name || "";
  db.prepare("UPDATE form_campaigns SET group_name=? WHERE id=?").run(g, selfId);
  for (const i of ids) db.prepare("UPDATE form_campaigns SET group_name=? WHERE id=?").run(g, i);
  if (prevGroup) {
    for (const c of own.values()) {
      if (c.id !== selfId && !ids.includes(c.id) && c.group_name === prevGroup) db.prepare("UPDATE form_campaigns SET group_name='' WHERE id=?").run(c.id);
    }
  }
}

/** 既存のキャンペーングループ名（入力候補用） */
export function groupNames(req: express.Request): string[] {
  const sc = scope(req);
  return (db.prepare(`SELECT DISTINCT group_name FROM form_campaigns WHERE group_name<>'' AND ${sc.sql} ORDER BY group_name`).all(...sc.args) as { group_name: string }[]).map((r) => r.group_name);
}

/** 「失敗した会社を再送信」の対象＝会社（ドメイン）ごとに最新のジョブが 失敗／フォーム無し のもの。
 *  同じ会社の古い試行（その後に成功・別状態になった行）は含めない。一覧・件数・再送信の3か所で共通に使う。 */
export function retryTargetJobs(campaignId: number): { id: number; company_name: string; status: string; result_text: string }[] {
  return db.prepare(`SELECT j.id, j.company_name, j.status, j.result_text FROM form_jobs j
    WHERE j.campaign_id=? AND j.is_test=0
      AND j.id = (SELECT x.id FROM form_jobs x WHERE x.campaign_id=j.campaign_id AND x.is_test=0
                  AND COALESCE(NULLIF(x.domain,''),CAST(x.id AS TEXT)) = COALESCE(NULLIF(j.domain,''),CAST(j.id AS TEXT))
                  ORDER BY x.updated_at DESC, x.id DESC LIMIT 1)
      AND j.status IN ('failed','skip_no_form')
    ORDER BY j.company_name`).all(campaignId) as { id: number; company_name: string; status: string; result_text: string }[];
}

// ---- 「開始したのに進まない／勝手に止まった」理由（#2周目-5）----
// 以前はどの理由でも「時間待ち」としか出ず、自動の一時停止の理由は、待機に戻した1社の結果欄と通知にしか無かった

/** 進まない理由。blocking=false は「片方だけ止まっていて、もう片方は送っている」もの */
export type CampaignStall = {
  kind: "auto" | "email" | "ai" | "retry" | "limit" | "window"; text: string; blocking: boolean; href?: string; action?: string;
  /** 自動の一時停止の理由だけ（「自動で一時停止しました。」を付けない形）。ホームで「「X」を自動で止めました。理由」と言うため */
  reason?: string;
};

/** 日時（ミリ秒、または DB の世界標準時の文字列）を「10/5 14:30」の形にする（今日なら時刻だけ） */
function whenJst(t: number | string | null | undefined): string {
  const ms = typeof t === "number" ? t : Date.parse(String(t ?? "").replace(" ", "T") + "Z");
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms + 9 * 3600_000);
  const hm = `${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  return d.toISOString().slice(0, 10) === todayJst() ? hm : `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${hm}`;
}

/** 自動で一時停止した理由（空＝自動の一時停止ではない）。
 *  pause_reason は worker が書く。まだ書かない版でも分かるよう、待機に戻した会社の結果の文（「…（キャンペーンを一時停止）: 理由」）からも拾う。
 *  「開始」「一時停止」を押すと両方とも消す（routes/campaigns.ts）ので、古い理由が残って出続けることはない */
export function autoPauseReason(c: Pick<Campaign, "id" | "status"> & { pause_reason?: string | null }): string {
  if (c.status !== "paused") return "";
  if (String(c.pause_reason ?? "").trim()) return String(c.pause_reason).trim();
  const r = db.prepare(`SELECT result_text FROM form_jobs WHERE campaign_id=? AND is_test=0 AND status='queued' AND result_text LIKE ? ORDER BY updated_at DESC LIMIT 1`)
    .get(c.id, `%${AUTO_PAUSE_MARK}%`) as { result_text: string } | undefined;
  // 「文面に直す所があるため待機に戻しました（キャンペーンを一時停止）: …」→「文面に直す所があるため: …」。
  // worker が pause_reason に書く形とそろえる（以前は「自動で一時停止しました」に置き換えていて、
  // 画面で「自動で一時停止しました。文面に直す所があるため自動で一時停止しました: …」と二重になっていた）
  return r ? r.result_text.split("\n")[0].replace(`待機に戻しました${AUTO_PAUSE_MARK}`, "").slice(0, 200) : "";
}
/** worker が自動の一時停止のとき結果の文に入れる印 */
export const AUTO_PAUSE_MARK = "（キャンペーンを一時停止）";

/** メールの一時停止の理由が「送信者の設定を直せば解ける」ものか（住所・会社名の未登録、アカウント未設定、ログイン拒否、差出人の拒否）。
 *  これらは時間が経っても直らないので、「詳しく見る」ではなく送信者の画面へ案内する */
export const SENDER_FIX_RE = /未登録|未設定|ログインを拒否|差出人/;

/** いま送りが進まない理由を1つ決める。優先順: 自動の一時停止 → メールの一時停止 → AIの一時停止 → 再送待ち → 上限 → 時間帯の外。
 *  理由が無い（送っている・送る会社が無い・準備中や手動の一時停止）ときは null。
 *  admin は見ている人が管理者か。AIの設定（/settings）は管理者しか開けないので、一般の人には開けないボタンを出さない */
export function campaignStall(c: Campaign, opts: { admin?: boolean } = {}): CampaignStall | null {
  // ライセンス（お試し期間が終わった・期限切れ）で止まっているなら、まずそれを出す（ほかの理由を直しても送れないため）
  const lic = licenseBlock();
  if (lic) return opts.admin ? { kind: "auto", blocking: true, reason: lic, text: lic, href: "/settings#s-license", action: "ライセンスキーを登録する" } : { kind: "auto", blocking: true, reason: lic, text: `${lic}（管理者に依頼してください）` };
  const auto = autoPauseReason(c);
  if (auto) {
    const reason = auto.replace(/^自動で一時停止しました[:：。]?\s*/, "");
    const text = `自動で一時停止しました。${reason.replace(/[。.]$/, "")}`;
    // AIの設定の問題か（文頭で見る。文面の間違いの説明に「{{AI冒頭}}」のように AI の文字が入っていても、AIの設定へ案内しない）
    if (/^AIで/.test(reason)) {
      return opts.admin
        ? { kind: "auto", blocking: true, reason, text, href: "/settings#s-ai", action: "AIの設定を確認する" }
        : { kind: "auto", blocking: true, reason, text: `${text}。管理者に AI の設定（APIキー・残高・モデル）の確認を依頼してください` };
    }
    // 文面の問題。直したあとも「文面を直す」と出し続けると、どこが悪いのか分からなくなるので、直っていれば開始を促す
    if (!templateProblems(c).length) {
      return { kind: "auto", blocking: true, reason, text: `${text}。文面は直っています。「開始する」を押すと続きから送ります` };
    }
    return { kind: "auto", blocking: true, reason, text, href: `/campaigns/${c.id}/edit#tpl`, action: "文面を直す" };
  }
  if (c.status !== "running") return null;
  const only = String(c.send_only ?? "");
  const READY = "(retry_after IS NULL OR retry_after <= datetime('now'))";
  const q = db.prepare(`SELECT COALESCE(SUM(channel='form'),0) form, COALESCE(SUM(channel='email'),0) email,
      COALESCE(SUM(channel='form' AND ${READY}),0) formReady, COALESCE(SUM(channel='email' AND ${READY}),0) emailReady,
      MIN(CASE WHEN NOT ${READY} THEN retry_after END) nextRetry
    FROM form_jobs WHERE campaign_id=? AND is_test=0 AND status='queued'`).get(c.id) as { form: number; email: number; formReady: number; emailReady: number; nextRetry: string | null };
  const qForm = only === "email" ? 0 : q.form, qEmail = only === "form" ? 0 : q.email;
  if (!qForm && !qEmail) return null;
  const readyForm = only === "email" ? 0 : q.formReady, readyEmail = only === "form" ? 0 : q.emailReady;
  // メール: 追加の送信アカウントも含め、使えるアカウントが全部止まっているときだけ（1つでも使えれば切り替えて送る）
  if (qEmail > 0) {
    const senders = emailSenderIds(c).map((id) => db.prepare("SELECT * FROM sender_profiles WHERE id=?").get(id) as SenderProfile | undefined).filter(Boolean) as SenderProfile[];
    const pauses = senders.map((s) => emailPause(s)).filter(Boolean) as { until: number; reason: string }[];
    if (senders.length && pauses.length === senders.length) {
      const p = pauses.reduce((a, b) => (b.until < a.until ? b : a));
      // 送信者の設定不備は、時間が経っても直らない（自動で再開しても同じ理由でまた止まる）。直す先へ案内する
      const fix = SENDER_FIX_RE.test(p.reason);
      return { kind: "email", blocking: !readyForm, text: `メール送信を一時停止中です（${whenJst(p.until)}に自動で再開${fix ? "しますが、送信者の設定を直さないとまた止まります" : ""}）: ${p.reason.slice(0, 80)}${readyForm ? "。フォームの会社は続けて送ります" : ""}`, href: fix ? "/senders" : `/campaigns/${c.id}?tab=send`, action: fix ? "送信者の設定を直す" : "詳しく見る" };
    }
  }
  if (c.mode === "ai") {
    const ap = aiPause();
    if (ap) return { kind: "ai", blocking: true, text: `AIが混み合っているため、送信を少し止めています。${whenJst(ap.until)}に自動で再開します` };
  }
  if (!readyForm && !readyEmail) {
    return { kind: "retry", blocking: true, text: `相手のメールサーバーの一時的なエラーで、${fmtN(qForm + qEmail)}社が再送待ちです（早いものは ${whenJst(q.nextRetry)}ごろに送り直します）` };
  }
  // 上限はチャネルごとに比べる（フォームとメールの合計で比べると、片方が残っていても「上限」と出ていた）
  const formCap = cappedDailyLimit(c.daily_limit).limit;
  const formFull = readyForm > 0 && sentToday(c.id, "form") >= formCap;
  const primary = db.prepare("SELECT * FROM sender_profiles WHERE id=?").get(c.sender_id) as SenderProfile | undefined;
  const emailFull = readyEmail > 0 && !pickEmailSender(c, primary);
  if ((formFull || !readyForm) && (emailFull || !readyEmail)) {
    return { kind: "limit", blocking: true, text: `今日の上限（${[readyForm ? `フォーム ${fmtN(formCap)}社` : "", readyEmail ? `メール ${fmtN(effectiveEmailLimit(c, c.sender_id).limit)}通` : ""].filter(Boolean).join("・")}）に達しました。残りは次の送信時間帯に続きます` };
  }
  if (!inSendWindow(c)) {
    return { kind: "window", blocking: true, text: `いまは送信時間帯（${c.send_window_start}〜${c.send_window_end}時${c.weekdays_only ? "・平日" : ""}）の外です。${nextWindowText(c)}` };
  }
  if (formFull) return { kind: "limit", blocking: false, text: `フォームは今日の上限（${fmtN(formCap)}社）に達しました。フォームの残り ${fmtN(qForm)}社は次の送信時間帯に送ります（メールは続けて送ります）` };
  if (emailFull) return { kind: "limit", blocking: false, text: `メールは今日の上限に達しました。メールの残り ${fmtN(qEmail)}社は次の送信時間帯に送ります（フォームは続けて送ります）` };
  return null;
}

// ログインの失敗回数制限。同じWi-Fi等にいる人が、他のPCから開けるURLでパスワードを何度も試せないようにする。
// 同じ接続元から15分に5回（どのIDでも合計10回）間違えたら、15分ログインを受け付けない。PCの中だけで数える（再起動でリセット）
export const loginFails = new Map<string, number[]>();

export const LOGIN_WINDOW = 15 * 60_000;

export function recentFails(key: string): number[] {
  const now = Date.now();
  const list = (loginFails.get(key) ?? []).filter((t) => now - t < LOGIN_WINDOW);
  if (list.length) loginFails.set(key, list); else loginFails.delete(key);
  return list;
}

// ---- ユーザー管理（管理者のみ）----
export const issuedOnce = new Map<number, { username: string; password: string }>();

// ---- campaigns ----
/** 他のPC（同じWi-Fi・社内LAN）から開くためのURL。
 *  画面のアドレス欄の http://localhost:… は「自分のPC」の意味なので、そのまま人に送ると相手のPCでは「サーバーに接続できません」になる。
 *  このPCの名前（.local）とIPアドレスでのURLを出す。IPはWi-Fiにつなぎ直すと変わることがあるので、名前のURLを先に出す */
export function shareUrls(): string[] {
  const port = process.env.GAME !== "0" && process.env.GAME !== "off" && CLEAN_PORT !== Number(process.env.PORT ?? 3210) ? CLEAN_PORT : Number(process.env.PORT ?? 3210);
  const urls: string[] = [];
  const host = os.hostname();
  if (/\.local$/i.test(host)) urls.push(`http://${host}:${port}`);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family === "IPv4" && !a.internal && !a.address.startsWith("169.254.")) urls.push(`http://${a.address}:${port}`);
    }
  }
  return urls;
}

export function campaignRows(req: express.Request): any[] {
  return db.prepare(`SELECT c.*, s.label sender_label,
      (SELECT COUNT(*) FROM form_jobs j WHERE j.campaign_id=c.id AND j.is_test=0) total,
      (SELECT COUNT(*) FROM form_jobs j WHERE j.campaign_id=c.id AND j.is_test=0 AND j.status='sent') sent,
      (SELECT COUNT(*) FROM form_jobs j WHERE j.campaign_id=c.id AND j.is_test=0 AND j.status='queued') queued,
      (SELECT COUNT(*) FROM form_jobs j WHERE j.campaign_id=c.id AND j.is_test=0 AND j.outcome IN ('replied','appointment')) reactions,
      (SELECT MAX(sent_at) FROM form_jobs j WHERE j.campaign_id=c.id AND j.is_test=0 AND j.status='sent') last_sent
    FROM form_campaigns c JOIN sender_profiles s ON s.id=c.sender_id WHERE ${scope(req).sql.replace("owner_user_id", "c.owner_user_id")} ORDER BY c.group_name='' , c.group_name, c.id DESC`).all(...scope(req).args) as any[];
}

/** メールで使う追加の送信アカウント（#24）。自分が使えるアカウントだけを受け付ける */
export function extraSenderIds(req: express.Request, b: Record<string, unknown>): string {
  const raw = b.email_sender_ids;
  const ids = (Array.isArray(raw) ? raw : raw === undefined ? [] : [raw]).map((x) => Number(x)).filter((n) => n > 0);
  return ids.filter((id) => ownedSender(req, id)).join(",");
}

// 添付ファイルの大きさの目安。重い添付はGmail側で止まる（実例: 13MBの添付で送信が止まった）
export const ATTACH_WARN_MB = 5;

export const ATTACH_MAX_MB = 10;

// 資料ファイルを DATA_DIR/materials に保存し、キャンペーンに紐づける。
// 戻り値は利用者に見せる注意文（問題なければ空文字）
export function saveMaterial(campaignId: number, file: Express.Multer.File): string {
  const mb = file.size / 1024 / 1024;
  if (mb > ATTACH_MAX_MB) {
    return `添付ファイル（${mb.toFixed(1)}MB）が大きすぎるため登録しませんでした。${ATTACH_MAX_MB}MB以下にしてください（重い添付はメールが送れなくなります）。資料は公開リンクで送る方法もおすすめです`;
  }
  const safeExt = path.extname(file.originalname).replace(/[^.\w]/g, "").slice(0, 10) || ".pdf";
  const dest = path.join(MATERIAL_DIR, `campaign-${campaignId}${safeExt}`);
  fs.writeFileSync(dest, file.buffer);
  const name = Buffer.from(file.originalname, "latin1").toString("utf8"); // multer は元名を latin1 で持つ
  db.prepare("UPDATE form_campaigns SET attach_path=?, attach_name=? WHERE id=?").run(dest, name || `資料${safeExt}`, campaignId);
  return mb > ATTACH_WARN_MB
    ? `添付ファイルは ${mb.toFixed(1)}MB です。${ATTACH_WARN_MB}MBを超える添付は届かないことがあるため、できれば圧縮するか、公開リンクで送ることをおすすめします`
    : "";
}

/** 資料ファイルを、どのキャンペーンからも使われていなければ消す（アプリの資料フォルダ内のものだけ） */
export function removeMaterialFileIfUnused(p: string) {
  if (!p || !path.resolve(p).startsWith(path.resolve(MATERIAL_DIR))) return;
  const used = db.prepare("SELECT 1 FROM form_campaigns WHERE attach_path=? LIMIT 1").get(p);
  if (!used) fs.rmSync(p, { force: true });
}

export function loadCampaignFull(req: express.Request, id: number) {
  const c = ownedCampaign(req, id);
  if (!c) return null;
  const sender = db.prepare("SELECT * FROM sender_profiles WHERE id=?").get(c.sender_id) as SenderProfile;
  return { ...c, sender };
}

export const lastImports = new Map<number, ImportSummary>();

export const pendingImports = new Map<number, { rows: CompanyRow[]; srcLabel: string }>();

export const previews = new Map<number, { job: Job; subject: string; message: string; aiUsed: boolean; lint?: import("../message.js").Lint[]; emailHtml?: string }>();

// GoogleスプレッドシートのURLをCSVで取得する（共有＝リンクを知っている全員が閲覧可、が前提）。
// Googleはサーバーからの素の要求（User-Agent無し）を400で弾くことがあるためUAを付け、
// export で失敗しても gviz 方式にフォールバックする（一部シートで export が400/HTMLを返すため）。
export async function fetchGoogleSheetCsv(url: string): Promise<string> {
  const m = url.match(/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!m) throw new Error("GoogleスプレッドシートのURLではありません。ブラウザのアドレスバーのURL（/spreadsheets/d/… を含む）を貼ってください");
  const id = m[1];
  const gid = (url.match(/[#&?]gid=(\d+)/) ?? [])[1];
  const headers = { "User-Agent": "Mozilla/5.0 (compatible; apoboost/1.0)", Accept: "text/csv,*/*" };
  // 実測: export は「存在しないgid」だと400を返す（URLに #gid= が無いとき gid=0 を決め打ちすると、
  // 先頭タブのgidが0でないシートで400になる）。gid不明なら gid を付けずに先頭シートを取る。
  const base = `https://docs.google.com/spreadsheets/d/${id}`;
  const candidates = gid
    ? [`${base}/export?format=csv&gid=${gid}`, `${base}/gviz/tq?tqx=out:csv&gid=${gid}`, `${base}/export?format=csv`, `${base}/gviz/tq?tqx=out:csv`]
    : [`${base}/export?format=csv`, `${base}/gviz/tq?tqx=out:csv`];
  let lastStatus = 0, sawLogin = false;
  for (const u of candidates) {
    let r: Response;
    try { r = await fetch(u, { redirect: "follow", headers }); } catch { continue; }
    const finalUrl = (r as any).url || "";
    if (/accounts\.google\.com|ServiceLogin/i.test(finalUrl)) { sawLogin = true; continue; }
    if (!r.ok) { lastStatus = r.status; continue; }
    const text = await r.text();
    if (/^\s*<(!doctype|html)/i.test(text.slice(0, 200))) { sawLogin = true; continue; } // ログイン/エラーHTML
    if (text.trim()) return text;
  }
  if (sawLogin) throw new Error("スプレッドシートが非公開のようです。共有を「リンクを知っている全員（閲覧可）」にしてから、対象タブを開いた状態のURL（末尾に #gid=… が付きます）を貼ってください");
  throw new Error(`スプレッドシートを取得できません（${lastStatus || "不明"}）。共有を「リンクを知っている全員（閲覧可）」にし、対象タブを開いた状態のURL（末尾 #gid=… 付き）を貼ってください。うまくいかない場合はCSV書き出し（ファイル→ダウンロード→CSV）でも取り込めます`);
}

export type ReactionRow = { id: number; company_name: string; domain: string; email: string; channel: string; outcome: string; outcome_note: string; updated_at: string };

// 手動で送れた会社を「送信済み（手動）」にする（手動送信リストの消し込み用）
// 間違って取り込んだ会社などを送信一覧から完全に消す（記録ごと削除。送信済みを消すとその会社への再送防止は効かなくなる）
/** 送信一覧の絞り込み条件（状態・反応・会社名・取り込み）。一覧の表示と「条件に一致する全件を削除」で同じ条件を使う */
export function jobFilter(q: Record<string, unknown>) {
  const statusFilter = typeof q.status === "string" && q.status in STATUS_LABEL ? q.status : "";
  const qFilter = typeof q.q === "string" ? q.q.trim().slice(0, 60) : "";
  const outcomeFilter = ["replied", "appointment", "declined", "none"].includes(String(q.outcome)) ? String(q.outcome) : "";
  const impRaw = String(q.imp ?? "");
  const impFilter = /^(i\d+|r\d+-\d+)$/.test(impRaw) ? impRaw : "";
  const where: string[] = ["1=1"];
  const args: (string | number)[] = [];
  if (statusFilter) { where.push("status=?"); args.push(statusFilter); }
  if (qFilter) { where.push("(company_name LIKE ? OR domain LIKE ?)"); args.push(`%${qFilter}%`, `%${qFilter}%`); }
  if (outcomeFilter === "none") where.push("outcome=''");
  else if (outcomeFilter) { where.push("outcome=?"); args.push(outcomeFilter); }
  let m: RegExpMatchArray | null;
  if ((m = impFilter.match(/^i(\d+)$/))) { where.push("import_id=?"); args.push(Number(m[1])); }
  else if ((m = impFilter.match(/^r(\d+)-(\d+)$/))) { where.push("import_id IS NULL AND id BETWEEN ? AND ?"); args.push(Number(m[1]), Number(m[2])); }
  // 並び替え（#51）。件数が増えると目的の会社を探しにくいので、列の見出しから切り替えられるようにする
  const SORTS: Record<string, string> = {
    "": "updated_at DESC, id DESC",
    updated: "updated_at DESC, id DESC",
    updated_asc: "updated_at ASC, id ASC",
    company: "company_name COLLATE NOCASE ASC, id DESC",
    company_desc: "company_name COLLATE NOCASE DESC, id DESC",
    status: "status ASC, updated_at DESC",
    score: "scan_score DESC, updated_at DESC",
    id: "id ASC",
  };
  const sortKey = typeof q.sort === "string" && q.sort in SORTS ? q.sort : "";
  return { statusFilter, qFilter, outcomeFilter, impFilter, sortKey, orderBy: SORTS[sortKey], sql: where.join(" AND "), args };
}

// ---- キャンペーンの設定をファイルで渡す ----
// 別のPCのApoBoostに同じ文面・設定を用意するための書き出し／読み込み。
// 会社リスト・送信履歴・送信者（メールのパスワード）は含めない（設定と文面だけ）
export const CAMPAIGN_EXPORT_COLS = ["name", "mode", "subject_text", "template_text", "ai_instruction", "channel", "daily_limit", "email_daily_limit", "send_window_start", "send_window_end", "weekdays_only", "resend_days", "ignore_refusal", "material_url", "material_url_in_email", "group_name"] as const;

// ---- 取り込み履歴と、取り込み単位・全件の削除 ----
// 一覧は200件までしか出ないため、2000件などを間違えて取り込むと「選択して削除」では消しきれなかった。
export type ImportBatch = { key: string; label: string; at: string; total: number; sent: number; queued: number };

/** このキャンペーンの取り込み履歴（新しい順）。取り込み記録がある分は1回ずつ、
 *  記録の無い昔の分は、登録時刻が2分以内に続いている会社を1回ぶんとしてまとめる */
export function importHistory(campaignId: number): ImportBatch[] {
  const out: ImportBatch[] = [];
  for (const r of db.prepare(`SELECT i.id, i.src_label, i.created_at, COUNT(j.id) total, COALESCE(SUM(j.status='sent'),0) sent, COALESCE(SUM(j.status='queued'),0) queued
    FROM form_imports i JOIN form_jobs j ON j.import_id=i.id AND j.is_test=0 WHERE i.campaign_id=? GROUP BY i.id`).all(campaignId) as { id: number; src_label: string; created_at: string; total: number; sent: number; queued: number }[]) {
    out.push({ key: `i${r.id}`, label: r.src_label || "取り込み", at: r.created_at, total: r.total, sent: r.sent, queued: r.queued });
  }
  const legacy = db.prepare("SELECT id, status, created_at FROM form_jobs WHERE campaign_id=? AND is_test=0 AND import_id IS NULL ORDER BY id").all(campaignId) as { id: number; status: string; created_at: string }[];
  let cur: { from: number; to: number; at: string; last: number; total: number; sent: number; queued: number } | null = null;
  const flush = () => { if (cur) out.push({ key: `r${cur.from}-${cur.to}`, label: "取り込み（記録前）", at: cur.at, total: cur.total, sent: cur.sent, queued: cur.queued }); };
  for (const j of legacy) {
    const t = Date.parse(String(j.created_at).replace(" ", "T") + "Z");
    if (!cur || !(t - cur.last <= 120_000)) { flush(); cur = { from: j.id, to: j.id, at: j.created_at, last: t, total: 0, sent: 0, queued: 0 }; }
    cur.to = j.id; cur.last = t; cur.total++;
    if (j.status === "sent") cur.sent++;
    if (j.status === "queued") cur.queued++;
  }
  flush();
  return out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

/** 削除する前に、消す行をそのまま控えておく（#60）。30分以内なら「元に戻す」で戻せる。
 *  誤って取り込み分や全件を消した事故があったため、取り返しがつくようにする（スクリーンショットは戻らない） */
export function snapshotJobs(campaignId: number, userId: number, label: string, rows: Record<string, unknown>[]): number {
  if (!rows.length) return 0;
  // 控えは直近5件だけ残す（古いものと、30分より前のものは消す）
  db.prepare("DELETE FROM deleted_jobs WHERE created_at < datetime('now','-1 day')").run();
  const r = db.prepare("INSERT INTO deleted_jobs(campaign_id, user_id, label, rows_count, payload) VALUES(?,?,?,?,?)")
    .run(campaignId, userId, label.slice(0, 80), rows.length, JSON.stringify(rows));
  return Number(r.lastInsertRowid);
}

/** いま「元に戻す」ボタンを出すべき削除（30分以内・このキャンペーン） */
export function recentUndo(campaignId: number, userId: number): { id: number; label: string; rows_count: number } | null {
  return (db.prepare(`SELECT id, label, rows_count FROM deleted_jobs
    WHERE campaign_id=? AND user_id=? AND created_at > datetime('now','-30 minutes') ORDER BY id DESC LIMIT 1`).get(campaignId, userId) as { id: number; label: string; rows_count: number } | undefined) ?? null;
}

export function deleteJobsWhere(campaignId: number, sql: string, args: (string | number)[], undo?: { userId: number; label: string }): number {
  const rows = db.prepare(`SELECT * FROM form_jobs WHERE campaign_id=? AND is_test=0 AND ${sql}`).all(campaignId, ...args) as Record<string, unknown>[];
  const ids = rows.map((r) => Number(r.id));
  if (!ids.length) return 0;
  if (undo) snapshotJobs(campaignId, undo.userId, undo.label, rows);
  db.transaction(() => { for (let i = 0; i < ids.length; i += 500) { const part = ids.slice(i, i + 500); db.prepare(`DELETE FROM form_jobs WHERE id IN (${part.map(() => "?").join(",")})`).run(...part); } })();
  for (const jid of ids) fs.rmSync(path.join(SCREENSHOT_DIR, `job-${jid}.png`), { force: true });
  return ids.length;
}

// 送信者ごとの「今日の残り通数」とウォームアップの状況（#130）
export function senderExtras(list: SenderProfile[]): Record<number, SenderExtra> {
  const out: Record<number, SenderExtra> = {};
  for (const sd of list) {
    const cfg = (db.prepare("SELECT MAX(email_daily_limit) m, MAX(email_warmup) w FROM form_campaigns WHERE sender_id=? OR (',' || email_sender_ids || ',') LIKE ?").get(sd.id, `%,${sd.id},%`) as { m: number | null; w: number | null });
    const configured = cfg.m ?? 100;
    const w = cfg.w === 0 ? { limit: configured, note: "" } : warmupLimit(sd.id, configured);
    const p = emailPause(sd);
    out[sd.id] = { sentToday: sentTodayBySender(sd.id), limit: w.limit, note: w.note, paused: p ? `メール送信を一時停止中: ${p.reason}（${new Date(p.until).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}に自動で再開）` : "" };
  }
  return out;
}

/** 保存した直後に、送信用メールへ実際につながるか確かめる（#129）。
 *  間違ったアプリパスワードに気づくのが「開始を押したとき」では遅いので、保存の瞬間に分かるようにする */
export async function smtpCheckNote(senderId: number): Promise<string> {
  const sd = db.prepare("SELECT * FROM sender_profiles WHERE id=?").get(senderId) as SenderProfile | undefined;
  if (!sd || !sd.smtp_user || !sd.smtp_pass) return "";
  const bad = checkSmtpPassword(sd);
  if (bad) return `／メールの設定を確認してください: ${bad}`;
  try {
    await testSmtp(sd, 10_000); // 10秒で打ち切る（保存のたびに画面が固まらないように）
    clearEmailPause(sd);
    return `／メールの接続テストに成功しました（${sd.smtp_user}）`;
  } catch (e) {
    logError("sender", `保存時のメール接続テストに失敗: ${explainSmtpError(e, sd)}`);
    return `／メールに接続できませんでした: ${explainSmtpError(e, sd)}`;
  }
}

export const SENDER_COLS = ["label", "company", "industry", "person", "person_kana", "email", "reply_email", "tel", "postal", "address", "url", "from_email", "smtp_user", "smtp_host", "smtp_port", "unsubscribe_url"];

// 送信者フォームの簡易チェック。問題があれば日本語メッセージ、無ければ null
export const PREF_RE = /^(北海道|青森県|岩手県|宮城県|秋田県|山形県|福島県|茨城県|栃木県|群馬県|埼玉県|千葉県|東京都|神奈川県|新潟県|富山県|石川県|福井県|山梨県|長野県|岐阜県|静岡県|愛知県|三重県|滋賀県|京都府|大阪府|兵庫県|奈良県|和歌山県|鳥取県|島根県|岡山県|広島県|山口県|徳島県|香川県|愛媛県|高知県|福岡県|佐賀県|長崎県|熊本県|大分県|宮崎県|鹿児島県|沖縄県)/;

/** 住所が都道府県から始まっていないと、フォームの「都道府県」の選択肢を選べない（先頭の北海道のまま送られる事故があった） */
export function prefWarning(address: string): string {
  const a = (address ?? "").trim();
  return a && !PREF_RE.test(a) ? "　※ 住所は都道府県から入力してください（フォームの都道府県の選択肢が正しく選べません）" : "";
}

export function validateSender(body: Record<string, unknown>): string | null {
  const g = (k: string) => String(body[k] ?? "").trim();
  if (!g("company")) return "会社名を入力してください";
  if (!g("person")) return "担当者名を入力してください";
  const email = g("email");
  if (!email) return "メールを入力してください";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return "メールアドレスの形式が正しくありません（例: sales@example.co.jp）";
  const re = g("reply_email");
  if (re && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(re)) return "返信受付メールの形式が正しくありません";
  // 電話番号は、全角数字・全角括弧や、見た目がハイフンの別の文字（‐ ‑ – — ― − ー ｰ －）で入力されることが多い。
  // 弾かずに半角の数字とハイフンにそろえてから確かめ、そろえた値を保存する（フォームの数字だけの欄にもそのまま入れられるように）
  const tel = g("tel").normalize("NFKC").replace(/[\u2010-\u2015\u2212\u30fc\uff70\ufe63\uff0d]/g, "-").replace(/\s+/g, " ").trim();
  if ("tel" in body) body.tel = tel;
  if (tel && !/^\+?[0-9\-() ]+$/.test(tel)) return "電話番号は数字とハイフンで入力してください（例: 03-1234-5678）";
  // メール送信の設定。全角で入れた・前後に空白が付いた・ポートに文字が入った、を保存の時点で止める
  // （以前はそのまま保存され、送る段階で「ログインを拒否」「接続できない」と分かりにくい形で出ていた）
  const addrRe = /^[a-z0-9!#$%&'*+=?^_`{|}~.-]+@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:[a-z]{2,}|xn--[a-z0-9-]+)$/i;
  const smtpUser = g("smtp_user").normalize("NFKC").trim();
  if ("smtp_user" in body) body.smtp_user = smtpUser;
  if (smtpUser && /\s/.test(smtpUser)) return "送信用メールアドレスに空白が入っています（例: sales@example.co.jp）";
  // プロバイダによってはユーザー名がアドレスの形でない（アカウントID）ので、@ を含むときだけアドレスとして確かめる
  if (smtpUser.includes("@") && !addrRe.test(smtpUser)) return "送信用メールアドレスの形式が正しくありません（例: sales@example.co.jp）";
  const fromEmail = g("from_email").normalize("NFKC").trim().toLowerCase();
  if ("from_email" in body) body.from_email = fromEmail;
  if (fromEmail && !addrRe.test(fromEmail)) return "差出人として表示するアドレスの形式が正しくありません（空にすると送信用メールアドレスで送ります）";
  const port = g("smtp_port").normalize("NFKC").trim();
  if ("smtp_port" in body) body.smtp_port = port;
  if (port && !(/^\d{1,5}$/.test(port) && Number(port) >= 1 && Number(port) <= 65535)) return "ポートは数字で入力してください（ふつうは 465。プロバイダの案内が 587 ならそちら）";
  return null;
}

// ---- suppressions / settings ----
export const suppImports = new Map<number, ReturnType<typeof importSuppressions>>();

// ---- 共有の除外リスト（スプレッドシート）を自動で取り込む ----
// チームで別々のPCに入れて使う場合、断りの会社を全員に行き渡らせる手段が無かった（PCごとに独立のため）。
// 1つのスプレッドシートを「共有NGリスト」にして、各自のApoBoostが1日1回そこから取り込む。
export type SuppSync = { url: string; userId: number; lastAt?: string; lastResult?: string };

export const suppSyncKey = (userId: number) => `supp_sync:${userId}`;

export function loadSuppSync(userId: number): SuppSync | null {
  try { const v = JSON.parse(getSetting(suppSyncKey(userId), "null")) as SuppSync | null; return v?.url ? v : null; } catch { return null; }
}

export function saveSuppSync(userId: number, v: SuppSync) { setSetting.run(suppSyncKey(userId), JSON.stringify(v)); }

/** 共有スプレッドシートから除外リストを取り込む。戻り値は画面に出す結果の文 */
export async function syncSuppressionsFor(userId: number): Promise<string> {
  const cfg = loadSuppSync(userId);
  if (!cfg) return "共有リストのURLが設定されていません";
  try {
    const rows = parseSuppressionText(await fetchGoogleSheetCsv(cfg.url));
    if (!rows.length) return "取り込める行がありませんでした（1行目の見出しと、会社名・URL/ドメイン・メールの列を確認してください）";
    const r = importSuppressions(rows, userId, "共有リストから自動取り込み");
    const msg = `追加 ${r.added}件 / すでに登録済み ${r.already}件${r.noKey ? ` / 判別できず ${r.noKey}件` : ""}`;
    saveSuppSync(userId, { ...cfg, lastAt: new Date().toISOString(), lastResult: msg });
    return msg;
  } catch (e) {
    const msg = `エラー: ${String((e as Error).message).slice(0, 120)}`;
    saveSuppSync(userId, { ...cfg, lastAt: new Date().toISOString(), lastResult: msg });
    return msg;
  }
}

/** 設定されている全員ぶんを取り込む（1日1回・起動2分後にも1回） */
export async function syncAllSuppressions() {
  const rows = db.prepare("SELECT key, value FROM settings WHERE key LIKE 'supp_sync:%'").all() as { key: string; value: string }[];
  for (const r of rows) {
    const userId = Number(r.key.split(":")[1]);
    if (!Number.isInteger(userId)) continue;
    const msg = await syncSuppressionsFor(userId);
    console.log(`[apoboost] 共有除外リストの取り込み（ユーザー${userId}）: ${msg}`);
  }
}

// ---- はじめの設定（#41）----
// 「どこから手を付ければいいか分からない」で止まるのを防ぐ、順番どおりの案内
export function setupState(req: express.Request): import("../views.js").SetupState {
  const sc = scope(req);
  const senders = db.prepare(`SELECT * FROM sender_profiles WHERE ${sc.sql} ORDER BY id`).all(...sc.args) as SenderProfile[];
  const sender = senders[0];
  const camp = db.prepare(`SELECT * FROM form_campaigns c WHERE ${sc.sql.replace("owner_user_id", "c.owner_user_id")} ORDER BY id DESC LIMIT 1`).get(...sc.args) as Campaign | undefined;
  const jobsWhere = `FROM form_jobs j JOIN form_campaigns c ON c.id=j.campaign_id WHERE j.is_test=0 AND ${sc.sql.replace("owner_user_id", "c.owner_user_id")}`;
  const cnt = (sql: string) => (db.prepare(sql).get(...sc.args) as { n: number }).n;
  return {
    senderOk: Boolean(sender?.company?.trim()),
    senderLabel: sender ? `${sender.label || sender.company}` : "",
    addressOk: Boolean(sender?.address?.trim()),
    smtpOk: Boolean(sender?.smtp_user && sender?.smtp_pass),
    smtpTested: Boolean(sender && !emailPause(sender)),
    lawOk: Boolean(getSetting(lawKey(me(req).id), "")),
    campaignOk: Boolean(camp),
    campaignId: camp?.id ?? 0,
    listCount: cnt(`SELECT COUNT(*) n ${jobsWhere}`),
    scannedOk: cnt(`SELECT COUNT(*) n ${jobsWhere} AND j.scanned_at IS NOT NULL`) > 0,
    sentCount: cnt(`SELECT COUNT(*) n ${jobsWhere} AND j.status='sent'`),
    emailSkipped: setupEmailSkippedFor(me(req)),
  };
}

/** はじめの設定が何ステップ終わっているか（#137） */
export function setupProgress(st: import("../views.js").SetupState): { done: number; total: number } {
  // 「フォームだけで使う」を選んだ人は、送信用メールの手順を済みとして数える（選んでいないと、ホームの帯がずっと「2番」で止まる）
  const steps = [st.senderOk && st.addressOk, st.smtpOk || st.emailSkipped, st.lawOk, st.campaignOk, st.listCount > 0, st.sentCount > 0];
  return { done: steps.filter(Boolean).length, total: steps.length };
}

// ---- 要対応（#50 #10）----// ---- 要対応（#50 #10）----
// 失敗・要確認・CAPTCHA・フォーム無しを1画面でさばけるようにする。取りこぼしが実際の送信に変わるところ
export function todoBase(req: express.Request): { from: string; args: number[] } {
  const sc = scope(req);
  return { from: `FROM form_jobs j JOIN form_campaigns c ON c.id=j.campaign_id WHERE j.is_test=0 AND ${sc.sql.replace("owner_user_id", "c.owner_user_id")}`, args: sc.args };
}

export function todoCounts(req: express.Request): Record<string, number> {
  const { from, args } = todoBase(req);
  const one = (w: string) => (db.prepare(`SELECT COUNT(*) n ${from} AND ${w}`).get(...args) as { n: number }).n;
  const out: Record<string, number> = { all: one(`${TODO_ANY} AND ${todoActive()}`), dismissed: one(`${TODO_ANY} AND ${todoDismissed()}`) };
  for (const [k, w] of Object.entries(TODO_WHERE)) out[k] = one(`(${w}) AND ${todoActive()}`);
  return out;
}

export function todoWhere(kind: string): string {
  if (kind === "dismissed") return `${TODO_ANY} AND ${todoDismissed()}`;
  return `(${TODO_WHERE[kind] ?? TODO_ANY}) AND ${todoActive()}`;
}

/** 結果の1行目（SQL）。2行目以降は操作の記録なので、原因の判定には使わない */
const TODO_FIRST_LINE = "substr(j.result_text, 1, instr(j.result_text || char(10), char(10)) - 1)";
/** 届いたか分からない会社を除く条件（SQL）。ui/todo.ts の UNSURE_RE と同じ言葉。まとめて送り直すと二重送信になり得る */
const TODO_NOT_UNSURE = "j.result_text NOT LIKE '%送信後の判定不能%' AND j.result_text NOT LIKE '%送信済みか不明%' AND j.result_text NOT LIKE '%送信済みか確認できませんでした%'";

/** 同じ原因をまとめる（#117）。原因1つ＝操作1回にする。key は一括操作のときの絞り込み条件に対応する */
export const TODO_GROUPS: { key: string; label: string; where: string; advice: string; action: "requeue" | "dismiss" | "to_email"; actionLabel: string; link?: string; linkLabel?: string }[] = [
  { key: "mailconfig", label: "メールの設定が原因で送れなかった", where: "j.status='failed' AND (j.result_text LIKE 'メール送信エラー:%2段階認証%' OR j.result_text LIKE 'メール送信エラー:%ログインを拒否%' OR j.result_text LIKE 'メール送信エラー:%アプリパスワード%')", advice: "送信者のアプリパスワードを直してから、まとめて送り直します。1社ずつ対応する必要はありません。", action: "requeue", actionLabel: "まとめて送り直す", link: "/senders", linkLabel: "送信者の設定を直す" },
  // 見るのは結果の1行目だけ（TODO_FIRST_LINE）。以前は全文で引いていたため、1行目が「送信後の判定不能」（送信ボタンは押し済み）でも
  // 2行目以降の操作の記録に timeout があるだけでここに入り、「まとめて送り直す」で同じ会社に2通届き得た。
  // 届いたか分からないもの（判定不能・送信済みか不明・確認できませんでした）は、1行目に何があっても除く
  { key: "network", label: "通信が切れて送れなかった", where: `j.status='failed' AND (${TODO_FIRST_LINE} LIKE '%EPIPE%' OR ${TODO_FIRST_LINE} LIKE '%ECONN%' OR ${TODO_FIRST_LINE} LIKE '%時間切れ%' OR ${TODO_FIRST_LINE} LIKE '%timeout%' OR ${TODO_FIRST_LINE} LIKE '%通信が途中で切れ%') AND ${TODO_NOT_UNSURE}`, advice: "回線が不安定だったときの失敗です。そのまま送り直せます。", action: "requeue", actionLabel: "まとめて送り直す" },
  // 送信ボタンを押す前に止まっていたもの（確認画面を抜けられない・入力エラーなど）。まだ送っていないので、まとめて送り直してよい。
  // 「送信後の判定不能」は届いている可能性があるので、ここには入れない（二重送信を防ぐ）
  { key: "notsent", label: "入力の不備などで、送る前に止まった", where: "j.status='failed' AND j.channel='form' AND (j.result_text LIKE '確認画面を抜けられない%' OR j.result_text LIKE '送信ボタンが見つからない%' OR j.result_text LIKE '入力エラー%' OR j.result_text LIKE '例外: page.evaluate%')", advice: "電話番号が必須なのに空だった、エラーの表示を読み取れなかった、などで止まった会社です。まだ送信していないので、そのまま送り直せます（必須の欄の読み取りを強化しました）。", action: "requeue", actionLabel: "まとめて送り直す" },
  { key: "blocked_email", label: "サイト側に断られたが、メールアドレスは分かっている", where: "j.status='failed' AND j.result_text LIKE 'サイト側で受け付けられませんでした%' AND j.email<>''", advice: "スパム判定などでフォームからは送れない会社です。メールで送れます。", action: "to_email", actionLabel: "まとめてメールで送る" },
  { key: "noform_email", label: "フォームは無いが、メールアドレスは分かっている", where: "j.status='skip_no_form' AND j.email<>''", advice: "フォームをあきらめて、メールで送れます。", action: "to_email", actionLabel: "まとめてメールで送る" },
  { key: "unreachable", label: "サイトを開けなかった（メールアドレスも無い）", where: "j.status='skip_no_form' AND j.email='' AND (j.result_text LIKE '%アクセスできない%' OR j.result_text LIKE '%見つかりません%')", advice: "サイトが閉鎖・移転している可能性が高い会社です。送る手段が無いので、見送るのが現実的です。", action: "dismiss", actionLabel: "まとめて見送る" },
];

/** 要対応の操作を、会社のIDの集まりに対して行う（1社・複数・原因ごと、で共通） */
export function applyTodoAction(req: express.Request, action: string, ids: number[]): number {
  if (!ids.length) return 0;
  let n2 = 0;
  const uid = me(req).id;
  const run = db.transaction(() => {
    for (const id of ids) {
      const j = ownedJob(req, id);
      if (!j) continue;
      if (action === "requeue") {
        // 送信中・送信済みの会社は戻さない（開いたままの古い画面から押されると、送信中の会社がもう一度送られ、2通出る）。
        // 宛先の一時エラーの待ち時間と回数は、人が戻すと決めたので数え直す（/jobs/:id/requeue と同じ）
        n2 += db.prepare("UPDATE form_jobs SET status='queued', dismissed_at=NULL, result_text='もう一度送ります（要対応から）', retry_after=NULL, temp_tries=0, updated_at=datetime('now') WHERE id=? AND status NOT IN ('sending','sent')").run(id).changes;
      } else if (action === "dismiss") {
        db.prepare("UPDATE form_jobs SET dismissed_at=datetime('now') WHERE id=?").run(id); n2++;
      } else if (action === "undismiss") {
        db.prepare("UPDATE form_jobs SET dismissed_at=NULL, updated_at=datetime('now') WHERE id=?").run(id); n2++;
      } else if (action === "mark_sent") {
        db.prepare("UPDATE form_jobs SET status='sent', dismissed_at=NULL, result_text='手動で送信済みにしました', sent_at=datetime('now'), updated_at=datetime('now') WHERE id=?").run(id); n2++;
      } else if (action === "to_email") {
        if (!j.email) continue;
        n2 += db.prepare("UPDATE form_jobs SET channel='email', status='queued', dismissed_at=NULL, result_text=?, retry_after=NULL, temp_tries=0, updated_at=datetime('now') WHERE id=? AND status NOT IN ('sending','sent')").run(`メールで送ります（${j.email}）`, id).changes;
      } else if (action === "suppress") {
        if (j.domain) db.prepare("INSERT OR IGNORE INTO form_suppressions(company_name, domain, reason, owner_user_id) VALUES(?,?,?,?)").run(j.company_name, j.domain, "要対応の画面から除外", uid);
        if (j.email) optOut(j.email, `除外（${j.company_name}）`, uid);
        db.prepare("UPDATE form_jobs SET status='skip_suppressed', result_text='除外リストに追加（手動）', updated_at=datetime('now') WHERE id=?").run(id); n2++;
      }
    }
  });
  run();
  return n2;
}

export const TODO_ACTION_LABEL: Record<string, string> = { requeue: "待機に戻しました（キャンペーンを開始すると送ります）", dismiss: "見送りにしました", undismiss: "要対応に戻しました", mark_sent: "送信済みにしました", to_email: "メール送信に切り替えました（キャンペーンを開始すると送ります）", suppress: "除外リストに入れました" };

export const todoBack = (req: express.Request, fallback: string) => { const b = String(req.body.back ?? ""); return /^\/todo(\/run)?(\?[\w=&,%-]*)?$/.test(b) ? b : fallback; };

// ---- 営業メールの法律チェック（#85）----// ---- 営業メールの法律チェック（#85）----
// 他社に渡すと、表示義務（名称・住所・配信停止の連絡先）を知らないまま送り始めてしまうため、最初の1回だけ確認してもらう
export const lawKey = (userId: number) => `law_ack:${userId}`;

// ---- AIモード設定（管理者のみ）。キーは data/ 内のDBに保存され、gitには載らない ----
export const setSetting = db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");

// ---- アップデート（管理者のみ）----
export const updateResults = new Map<number, Awaited<ReturnType<typeof applyUpdate>>>();

// ---- 自動更新（設定でオンにしたときだけ）----
// 起動から3分後と、以後6時間ごとに確認する。更新前にバックアップを取り、送信中の会社は送り終わってから再起動する
export async function autoUpdateIfEnabled() {
  if (getSetting(S.autoUpdate, "0") !== "1") return;
  // 開発フォルダ（git）は git pull で受け取る。配布版で上書きしない（失敗の通知も出さない）
  if (isDevCheckout()) return;
  try {
    const st = await checkUpdate(true);
    if (!st.available) return;
    logInfo("update", `自動更新を開始: v${st.current} → v${st.latest}`);
    await autoBackupIfDue();
    const r = await applyUpdate();
    if (!r.ok) {
      logError("update", `自動更新に失敗: ${r.error ?? "原因不明"}`);
      notify("自動更新に失敗しました", `${r.error ?? "原因不明"}（アプリはそのまま使えます。画面右上の「新しい版があります」から手動で更新できます）`, "autoupdate-fail");
      return;
    }
    notify("新しい版に更新しました", `v${r.version} に更新し、再起動します`, `autoupdate:${r.version}`);
    logInfo("update", `自動更新 完了: v${r.version}`);
    await drainForShutdown();
    requestRestart();
  } catch (e) {
    logError("update", `自動更新の確認に失敗: ${jpError(e)}`);
  }
}

// ---- 1日の終わりのまとめ（#133）----
// 送信時間帯が終わったら、その日の結果を1回だけ知らせる。毎日画面を見に来なくても状況が分かるように
export function dailySummaryIfDue() {
  if (!settingOn(S.dailySummary)) return;
  const nowJ = new Date(Date.now() + 9 * 3600_000);
  const today = nowJ.toISOString().slice(0, 10);
  if (getSetting("daily_summary_last", "") === today) return;
  const end = (db.prepare("SELECT MAX(send_window_end) e FROM form_campaigns WHERE status IN ('running','paused','done')").get() as { e: number | null }).e ?? 18;
  if (nowJ.getUTCHours() < end) return;
  const one = (sql: string) => (db.prepare(sql).get(today) as { n: number }).n;
  // 「今日送った数」は上限の判定と同じ数え方にする（戻りメールで失敗に変わった分も、送ったことに変わりない）
  const form = one(`SELECT COUNT(*) n FROM form_jobs WHERE is_test=0 AND channel='form' AND ${sentTodaySql()}`);
  const mail = one(`SELECT COUNT(*) n FROM form_jobs WHERE is_test=0 AND channel='email' AND ${sentTodaySql()}`);
  saveSetting("daily_summary_last", today);
  if (form + mail === 0) return; // 何も送っていない日は知らせない
  const appo = one("SELECT COUNT(*) n FROM form_jobs WHERE is_test=0 AND outcome='appointment' AND date(updated_at,'+9 hours')=?");
  const reply = one("SELECT COUNT(*) n FROM form_jobs WHERE is_test=0 AND outcome='replied' AND date(updated_at,'+9 hours')=?");
  const todo = one("SELECT COUNT(*) n FROM form_jobs WHERE is_test=0 AND status IN ('failed','skip_captcha') AND date(updated_at,'+9 hours')=?");
  const msg = `送信 ${form + mail}件（フォーム${form}・メール${mail}）／アポ ${appo}・返信 ${reply}／要対応 +${todo}`;
  notify("今日のまとめ", msg, `summary:${today}`);
  logInfo("summary", `今日のまとめ: ${msg}`);
}

// ---- 返信の自動確認: 送信用メールの受信箱を15分ごとに見て、反応（返信／アポ／断り）を記録 ----
export const onReplyErr = (e: unknown) => { console.error("[replies]", e); logError("replies", `受信箱の読み取りに失敗: ${jpError(e)}`); };

// ---- チーム共有（送信済み・除外の双方向）を1日1回同期する（#78 #79）----
export const onShareErr = (e: unknown) => { console.error("[share]", e); logError("share", `チーム共有の同期に失敗: ${jpError(e)}`); };

// ---- 共有の除外リスト（スプレッドシート）を1日1回取り込む ----
export const onSuppErr = (e: unknown) => { console.error("[supp-sync]", e); logError("supp-sync", `共有の除外リストの取り込みに失敗: ${jpError(e)}`); };
