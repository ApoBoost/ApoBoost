// どの画面の経路からも使う共通の道具（アプリ本体・DB・権限チェック・お知らせ・集計の関数など）。
// もともと server.ts の先頭や途中に散らばっていたものを1か所に集めた（#139）。
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

export const app = express();

// ゲームの音声など静的アセット（src の1つ上の assets/ を配信）
// このファイルは src/app/ にあるので、2つ上がアプリのフォルダ
export const ASSETS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "assets");

export const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

export const db = getDb();

export const flashes = new Map<string, string>();

export function redirectWith(res: express.Response, to: string, msg: string) {
  flashes.set(to, msg);
  res.redirect(to);
}

export function takeFlash(req: express.Request) {
  const m = flashes.get(req.path) ?? "";
  flashes.delete(req.path);
  return m;
}

// ---- ログイン中のユーザー ----
export function me(req: express.Request) {
  const u = (req as AuthedRequest).user;
  if (!u) throw new Error("not authenticated");
  return u;
}

export const appState = { updateReady: false };

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
    await Promise.race([testSmtp(sd), new Promise((_, rej) => setTimeout(() => rej(new Error("ETIMEDOUT 接続の確認が10秒で終わりませんでした")), 10_000))]);
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
  const tel = g("tel");
  if (tel && !/^[0-9０-９\-ー－()（） 　]+$/.test(tel)) return "電話番号は数字とハイフンで入力してください";
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
  };
}

/** はじめの設定が何ステップ終わっているか（#137） */
export function setupProgress(st: import("../views.js").SetupState): { done: number; total: number } {
  const steps = [st.senderOk && st.addressOk, st.smtpOk, st.lawOk, st.campaignOk, st.listCount > 0, st.sentCount > 0];
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

/** 同じ原因をまとめる（#117）。原因1つ＝操作1回にする。key は一括操作のときの絞り込み条件に対応する */
export const TODO_GROUPS: { key: string; label: string; where: string; advice: string; action: "requeue" | "dismiss" | "to_email"; actionLabel: string; link?: string; linkLabel?: string }[] = [
  { key: "mailconfig", label: "メールの設定が原因で送れなかった", where: "j.status='failed' AND (j.result_text LIKE 'メール送信エラー:%2段階認証%' OR j.result_text LIKE 'メール送信エラー:%ログインを拒否%' OR j.result_text LIKE 'メール送信エラー:%アプリパスワード%')", advice: "送信者のアプリパスワードを直してから、まとめて送り直します。1社ずつ対応する必要はありません。", action: "requeue", actionLabel: "まとめて送り直す", link: "/senders", linkLabel: "送信者の設定を直す" },
  { key: "network", label: "通信が切れて送れなかった", where: "j.status='failed' AND (j.result_text LIKE '%EPIPE%' OR j.result_text LIKE '%ECONN%' OR j.result_text LIKE '%時間切れ%' OR j.result_text LIKE '%timeout%' OR j.result_text LIKE '%通信が途中で切れ%')", advice: "回線が不安定だったときの失敗です。そのまま送り直せます。", action: "requeue", actionLabel: "まとめて送り直す" },
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
        db.prepare("UPDATE form_jobs SET status='queued', dismissed_at=NULL, result_text='もう一度送ります（要対応から）', updated_at=datetime('now') WHERE id=?").run(id); n2++;
      } else if (action === "dismiss") {
        db.prepare("UPDATE form_jobs SET dismissed_at=datetime('now') WHERE id=?").run(id); n2++;
      } else if (action === "undismiss") {
        db.prepare("UPDATE form_jobs SET dismissed_at=NULL, updated_at=datetime('now') WHERE id=?").run(id); n2++;
      } else if (action === "mark_sent") {
        db.prepare("UPDATE form_jobs SET status='sent', dismissed_at=NULL, result_text='手動で送信済みにしました', sent_at=datetime('now'), updated_at=datetime('now') WHERE id=?").run(id); n2++;
      } else if (action === "to_email") {
        if (!j.email) continue;
        db.prepare("UPDATE form_jobs SET channel='email', status='queued', dismissed_at=NULL, result_text=?, updated_at=datetime('now') WHERE id=?").run(`メールで送ります（${j.email}）`, id); n2++;
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
  const form = one("SELECT COUNT(*) n FROM form_jobs WHERE is_test=0 AND status='sent' AND channel='form' AND date(sent_at,'+9 hours')=?");
  const mail = one("SELECT COUNT(*) n FROM form_jobs WHERE is_test=0 AND status='sent' AND channel='email' AND date(sent_at,'+9 hours')=?");
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
