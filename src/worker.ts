// キューを回すワーカー。server.ts から同一プロセスで呼ぶことも、`npm run worker` で単独起動もできる。
// 本体組み込み時は Railway の別サービス（form-worker）としてこのファイルを動かし、DBだけ共有／APIで取りに行く。
import fs from "node:fs";
import { S, setting } from "./settings.js";
import type { Browser } from "playwright";
import { getDb, getSetting, setSetting, allowsEmailFallback, findGroupDuplicate, FREE_MAIL_DOMAINS, domainOf, isExcludedDomain, type Campaign, type Job, type SenderProfile, type JobStatus, SENT_TODAY_SQL } from "./db.js";
import { launchBrowser, submitToCompany, fetchSiteText, scanCompany } from "./engine.js";
import { notify } from "./notify.js";
import { keepAwake } from "./awake.js";
import { logError, logWarn, logInfo } from "./applog.js";
import { jpError } from "./jp.js";
import { composeMessage, findNgWords, activeProvider, lintMessage, aiErrorKind } from "./message.js";
import { matchExcludedKeyword } from "./csv.js";
import { sharedSentBy } from "./share.js";
import { cappedDailyLimit } from "./license.js";
import { hasEntity, extractLegalName, findLegalNameFromSite } from "./company.js";
import { buildEmailBody, isOptedOut, sendEmail, senderEmailOk, explainSmtpError, emailPause, setEmailPause, classifySmtpError, maybeAccountSide, normalizeEmail, emailDomain, domainSuppressed } from "./email.js";
import { verifyInterruptedEmails, CUT_PREFIX } from "./replies.js";

// 実行中のキャンペーン。lastActive は「最後に動いた時刻」で、固まったまま残った実行を見つけるために使う
const running = new Map<number, { stop: boolean; lastActive: number }>();

/** 要確認画面で選ばれた回答（JSON）を安全に読む */
function parseManualAnswers(json: string): { label: string; answer: string }[] {
  try { const a = JSON.parse(json || "[]"); return Array.isArray(a) ? a.filter((x) => x && typeof x.label === "string" && typeof x.answer === "string") : []; } catch { return []; }
}
const CONCURRENCY = Number(process.env.FO_CONCURRENCY ?? 2);
const MIN_WAIT = Number(process.env.FO_MIN_WAIT_MS ?? 8000);
const MAX_WAIT = Number(process.env.FO_MAX_WAIT_MS ?? 15000);

export function isRunning(campaignId: number) {
  return running.has(campaignId);
}

/** 固まったまま残った「実行中」を片付ける。送信中の会社が無く、15分以上なにも動いていない実行だけを対象にする。
 *  （念のための保険。これが無いと、何かの拍子に実行中のまま残ったキャンペーンが永久に再開されない） */
export function clearStaleRuns(): number[] {
  const cleared: number[] = [];
  if (inFlight > 0) return cleared;
  for (const [id, st] of running) {
    if (Date.now() - st.lastActive > 15 * 60_000) { running.delete(id); cleared.push(id); }
  }
  return cleared;
}
// 送信処理（1社分）の実行中の数。アプリを止めるときに、送信の途中で切らないよう待つために使う
let inFlight = 0;
let shuttingDown = false;

/** アプリ終了前に呼ぶ。新しい会社には手を付けず、いま送っている会社が終わるまで待つ（最大 timeoutMs）。
 *  以前は終了・再起動で送信の途中に切れて「送信中」のまま残り、送ったかどうか分からなくなっていた。
 *  キャンペーンの状態（実行中）は変えないので、次の起動で続きから再開する */
export async function drainForShutdown(timeoutMs = 120_000): Promise<boolean> {
  shuttingDown = true;
  for (const r of running.values()) r.stop = true;
  const until = Date.now() + timeoutMs;
  while (inFlight > 0 && Date.now() < until) await new Promise((r) => setTimeout(r, 300));
  return inFlight === 0;
}

export function requestStop(campaignId: number) {
  const r = running.get(campaignId);
  if (r) r.stop = true;
}

function nowJst(): Date {
  return new Date(Date.now() + 9 * 3600 * 1000);
}
export function inSendWindow(c: Campaign): boolean {
  const d = nowJst();
  const h = d.getUTCHours();
  const wd = d.getUTCDay();
  if (c.weekdays_only && (wd === 0 || wd === 6)) return false;
  return h >= c.send_window_start && h < c.send_window_end;
}
// 「今日送った」の数え方。送信済み（status='sent'）だけを数えると、戻りメールで「失敗」に書き換わった分
// （replies.ts の applyBounce。sent_at は残る）が今日の数から消え、上限を超えて送ってしまっていた。
// 実際に相手のサーバーへ送り出した数が上限の対象なので、今日の送信時刻（sent_at）が付いた行を状態に関係なく数える

// 送信アカウントを選んでから送り終わるまでの会社（job id → 送信者・キャンペーン）。今日の数に先に入れて枠を取っておく。
// 以前は送り終わってから数えていたため、並列の2本や画面の「再試行」が同時に「あと1通」を見て、上限を超えて送っていた。
// アプリは1つのプロセスで動くので、メモリに持てば足りる（DBに書くと、送信を始めたかどうかの目印 sent_by_sender と混ざる）
const reserved = new Map<number, { senderId: number; campaignId: number }>();

/** 送信用アカウント（送信者）ごとの、今日のメール送信数。アカウントを切り替えて送るときの上限管理に使う。
 *  いま送っている途中の会社（枠を取ったもの）も数える */
export function sentTodayBySender(senderId: number): number {
  const d = nowJst().toISOString().slice(0, 10);
  const r = getDb()
    .prepare(`SELECT COUNT(*) n FROM form_jobs WHERE is_test=0 AND channel='email' AND sent_by_sender=? AND ${SENT_TODAY_SQL}`)
    .get(senderId, d) as { n: number };
  let inFlightN = 0;
  for (const v of reserved.values()) if (v.senderId === senderId) inFlightN++;
  return r.n + inFlightN;
}

/** ウォームアップ（#18）。新しい送信用アカウントでいきなり大量に送るとGmailに止められるため、
 *  送り始めてからの日数に応じて1日の上限を少しずつ引き上げる。
 *  途中で「上限に達した／ログインを拒否された」が起きたら、1段階下げて様子を見る。 */
const WARMUP_STEPS = [30, 30, 50, 50, 80, 80, 80, 120, 120, 120, 180, 180, 180, 180]; // 1日目から14日目まで
export function warmupLimit(senderId: number, configured: number): { limit: number; note: string } {
  const db = getDb();
  // 起点は「このアカウントで最初にメールを送った日」。記録が無ければ今日が初日。
  // 以前は記録が無いと送信者を登録した日を起点にしていたため、登録から14日以上たってからメールを始めた
  // アカウントにはウォームアップがかからず、いきなり上限いっぱいで送っていた。
  // 切り替えの記録（sent_by_sender）ができる前の送信は、キャンペーンの送信者のアカウントで送っているので、それも数える。
  // 戻りメールで「失敗」になった分も送ったことには変わりないので、送信時刻（sent_at）があれば数える
  const first = db.prepare(`SELECT MIN(j.sent_at) t FROM form_jobs j JOIN form_campaigns c ON c.id=j.campaign_id
    WHERE j.is_test=0 AND j.channel='email' AND j.sent_at IS NOT NULL AND COALESCE(j.sent_by_sender, c.sender_id)=?`).get(senderId) as { t: string | null } | undefined;
  const start = first?.t ?? null;
  if (!start) return { limit: Math.min(configured, WARMUP_STEPS[0]), note: "ウォームアップ中（初日）" };
  const days = Math.floor((Date.now() - Date.parse(String(start).replace(" ", "T") + "Z")) / 86400_000);
  if (days >= WARMUP_STEPS.length) return { limit: configured, note: "" };
  // 直近で停止（上限・ログイン拒否）があった場合は1段下げる
  const penalty = getSetting(`warmup_penalty:${senderId}`, "");
  const back = penalty && Date.now() - Number(penalty) < 3 * 86400_000 ? 1 : 0;
  const step = WARMUP_STEPS[Math.max(0, days - back)] ?? WARMUP_STEPS[0];
  const limit = Math.min(configured, step);
  return { limit, note: `ウォームアップ中（送り始めて${days + 1}日目・今日は最大${limit}通）${back ? "／直近に送信が止まったため1段階下げています" : ""}` };
}

/** このキャンペーンで今日メールに使える上限（ウォームアップ設定を加味した実際の値） */
export function effectiveEmailLimit(campaign: Campaign, senderId: number): { limit: number; note: string } {
  const capped = cappedDailyLimit(campaign.email_daily_limit);
  if (!campaign.email_warmup) return capped;
  const w = warmupLimit(senderId, capped.limit);
  return { limit: w.limit, note: [capped.note, w.note].filter(Boolean).join("／") };
}

/** メールに使える送信者アカウントを選ぶ（#24）。
 *  本来の送信者が「1日の上限に達した／一時停止中」なら、キャンペーンに登録した別のアカウントへ切り替える。
 *  使えるアカウントが無ければ null（＝今日のメール送信は終わり）。 */
export function emailSenderIds(campaign: Campaign): number[] {
  const extra = String(campaign.email_sender_ids ?? "").split(",").map((n) => Number(n.trim())).filter((n) => n > 0);
  return [...new Set([campaign.sender_id, ...extra])];
}
export function pickEmailSender(campaign: Campaign, primary?: SenderProfile): { sender: SenderProfile; limit: number; note: string } | null {
  const db = getDb();
  for (const id of emailSenderIds(campaign)) {
    const sender = id === primary?.id ? primary : (db.prepare("SELECT * FROM sender_profiles WHERE id=?").get(id) as SenderProfile | undefined);
    if (!sender) continue;
    if (emailPause(sender)) continue;
    const { limit, note } = effectiveEmailLimit(campaign, sender.id);
    if (sentTodayBySender(sender.id) >= limit) continue;
    // 従来どおり、キャンペーン単位の上限も超えない（アカウントを増やしても1キャンペーンの合計は守る）
    if (sentToday(campaign.id, "email") >= campaign.email_daily_limit * emailSenderIds(campaign).length) continue;
    return { sender, limit, note };
  }
  return null;
}

/** 時間帯の外にいるとき、次に送信が始まる時刻を言葉にする（#132）。「止まっている」と誤解されないように */
export function nextWindowText(c: Pick<Campaign, "send_window_start" | "send_window_end" | "weekdays_only">): string {
  const now = nowJst();
  for (let add = 0; add < 8; add++) {
    const d = new Date(now.getTime() + add * 86400_000);
    const wd = d.getUTCDay();
    if (c.weekdays_only && (wd === 0 || wd === 6)) continue;
    if (add === 0 && now.getUTCHours() >= c.send_window_start) continue; // 今日の開始時刻は過ぎている
    const label = add === 0 ? "今日" : add === 1 ? "明日" : `${d.getUTCMonth() + 1}/${d.getUTCDate()}（${"日月火水木金土"[wd]}）`;
    return `次の送信は ${label} ${c.send_window_start}:00 に始まります`;
  }
  return "";
}

/** いま送れるものがあるか（時間帯の中・上限に達していない・待機の会社がある）。
 *  自動再開の前に安く確かめる。これが無いと、上限に達したあとも1分ごとにブラウザを立ち上げては閉じていた */
export function canSendNow(campaignId: number): boolean {
  try {
    const { campaign, sender } = loadCampaign(campaignId);
    if (!inSendWindow(campaign)) return false;
    const only = String(campaign.send_only ?? "");
    const db = getDb();
    // AIで文面を作るキャンペーンは、AIの一時停止中（混雑・回線断）は動かさない
    if (campaign.mode === "ai" && aiPause()) return false;
    const has = (ch: string) => Boolean(db.prepare(`SELECT 1 FROM form_jobs WHERE campaign_id=? AND status='queued' AND is_test=0 AND channel=? AND ${READY_SQL} LIMIT 1`).get(campaignId, ch));
    const formOk = only !== "email" && has("form") && sentToday(campaignId, "form") < cappedDailyLimit(campaign.daily_limit).limit;
    const emailOk = only !== "form" && has("email") && Boolean(pickEmailSender(campaign, sender));
    return formOk || emailOk;
  } catch { return false; }
}

export function sentToday(campaignId: number, channel?: "form" | "email"): number {
  const d = nowJst().toISOString().slice(0, 10);
  const r = getDb()
    .prepare(`SELECT COUNT(*) n FROM form_jobs WHERE campaign_id=? AND is_test=0 AND ${SENT_TODAY_SQL}${channel ? " AND channel=?" : ""}`)
    .get(...(channel ? [campaignId, d, channel] : [campaignId, d])) as { n: number };
  let inFlightN = 0;
  if (channel !== "form") for (const v of reserved.values()) if (v.campaignId === campaignId) inFlightN++;
  return r.n + inFlightN;
}

/** 待機のうち、いま送ってよいもの（宛先の一時エラーで「◯時まで待つ」にした会社を除く） */
const READY_SQL = "(retry_after IS NULL OR retry_after <= datetime('now'))";

// ---- AIの一時停止 ----
// 文面をAIで作るキャンペーン（mode=ai）で、AIが混雑・回線断のとき、待機中の会社を次々「失敗」にしないよう、
// 少しのあいだAIを使う送信を止めて待機に戻す（メールの一時停止と同じ考え方）。APIキーはアプリ全体で1つなので全キャンペーン共通
export type AiPause = { until: number; reason: string };
export function aiPause(): AiPause | null {
  try {
    const p = JSON.parse(getSetting("ai_pause", "null")) as AiPause | null;
    return p && p.until > Date.now() ? p : null;
  } catch { return null; }
}
function setAiPause(minutes: number, reason: string) {
  setSetting("ai_pause", JSON.stringify({ until: Date.now() + minutes * 60_000, reason }));
}

// 宛先側の一時エラー（4xx）で送り直す回数と間隔。相手の受信箱の一時的な不調（混雑・グレーリスト）は、時間を置けば通ることが多い
const TEMP_RETRY_MAX = 3; // 1回目＋送り直し2回まで
const TEMP_RETRY_WAIT_MIN = [30, 120];
export const isScanning = (campaignId: number) => running.has(-campaignId);

// ---- 送信用アカウント側の制限の見分け ----
// 接続先は自分の送信サーバーなので、RCPT/DATA の 4xx（421 以外の 451 4.7.500・452 4.5.3 等）や本文の段階の 5xx は、
// 多くが送信用アカウント側の制限や文面の問題。1周目は1社ずつ「宛先の一時エラー」にしたため、アカウントが制限されると
// 待機の全社が再送待ち → 約2.5時間で全社失敗、になっていた。別の宛先で3件続いたら、アカウントごと止めて待機に戻す
const ACCOUNT_STREAK = 3;
// 数えるのは直近2時間のものだけ。以前は時刻を持っていなかったため、何日も前の2件と今日の1件で「続けて起きた」とみなし、アカウントごと止めていた
const STREAK_WINDOW_MS = 2 * 3600_000;
type Streak = { emails: string[]; jobs: number[]; at?: number[] };
const streakKey = (s: SenderProfile) => `email_streak:${(s.smtp_user || `sender-${s.id}`).trim().toLowerCase()}`;
function loadStreak(s: SenderProfile): Streak {
  const empty = { emails: [], jobs: [], at: [] };
  try {
    const v = JSON.parse(getSetting(streakKey(s), "null")) as Streak | null;
    if (!v || !Array.isArray(v.emails) || !Array.isArray(v.jobs)) return empty;
    // 時刻の無い古い記録（前の版で書いたもの）は、いつのものか分からないので数えない
    const at = Array.isArray(v.at) ? v.at : [];
    const keep = v.emails.map((_, i) => i).filter((i) => Number(at[i]) > Date.now() - STREAK_WINDOW_MS);
    return { emails: keep.map((i) => v.emails[i]), jobs: keep.map((i) => v.jobs[i]), at: keep.map((i) => Number(at[i])) };
  } catch { return empty; }
}
/** 送れたら数え直す（「続けて」起きたときだけアカウントのせいとみなす） */
function resetStreak(s: SenderProfile) {
  getDb().prepare("DELETE FROM settings WHERE key=?").run(streakKey(s));
}
/** アカウント側かもしれないエラーを1件数える。別の宛先で ACCOUNT_STREAK 件続いたら、その会社たち（job id）を返す */
function bumpStreak(s: SenderProfile, email: string, jobId: number): number[] | null {
  const st = loadStreak(s);
  // 同じ宛先への送り直しで続いたのは、その宛先の都合かもしれないので数えない
  if (!st.emails.includes(email)) { st.emails.push(email); st.jobs.push(jobId); (st.at ??= []).push(Date.now()); }
  if (st.emails.length >= ACCOUNT_STREAK) { resetStreak(s); return st.jobs; }
  setSetting(streakKey(s), JSON.stringify(st));
  return null;
}
/** アカウントごと止める時間（分）。30分止めても同じことが24時間以内にまた起きたら、3時間止める
 *  （文面や添付が原因で断られている場合に、30分ごとに3通ずつ断られ続けて送信元の評価を下げないため） */
function streakPauseMinutes(s: SenderProfile): number {
  const key = `email_streak_pause:${(s.smtp_user || `sender-${s.id}`).trim().toLowerCase()}`;
  const last = Number(getSetting(key, "0"));
  setSetting(key, String(Date.now()));
  return last && Date.now() - last < 24 * 3600_000 ? 180 : 30;
}

// メールの送信（SMTP）は、アプリ全体で同時に1通だけにする。キャンペーンを2つ動かしたときや、画面の「再試行」が
// 送信と重なったときに、同じアカウントから同時に何通も出ると、Gmail 等に送りすぎと見なされやすい
let mailChain: Promise<void> = Promise.resolve();
async function oneMailAtATime<T>(fn: () => Promise<T>): Promise<T> {
  const prev = mailChain;
  let release!: () => void;
  mailChain = new Promise<void>((r) => { release = r; });
  await prev;
  try { return await fn(); } finally { release(); }
}

/** 画面から1社だけ送る（「再試行」「修正して再送信」）直前に呼ぶ。送信中でなければ「送信中」にして true。
 *  送信中の会社にもう一度押した・二度押しした、のときは false（以前は無条件に送り始め、同じ相手に2通出ることがあった）。
 *  直前の失敗は履歴（prev_status）に残し、宛先の一時エラーの回数は数え直す（人が送り直すと決めたため） */
export function claimJobForManual(jobId: number): boolean {
  const db = getDb();
  const j = db.prepare("SELECT status, result_text, prev_status, prev_result FROM form_jobs WHERE id=?").get(jobId) as { status: string; result_text: string; prev_status: string; prev_result: string } | undefined;
  // 送信済みも断る: 画面は「送信済みでない」ことを確かめてからブラウザを起動する（数秒かかる）ので、その間に自動の送信が
  // 終わった会社に、もう一度送り始めてしまう（二重送信）のを、ここで止める
  if (!j || j.status === "sending" || j.status === "sent") return false;
  const failLike = ["failed", "skip_no_form", "skip_captcha"].includes(j.status);
  // 「一時エラーで再送待ち（n/2回目…）」の文は、processJob が回数の読み取りに使う（temp_tries が無かった頃の行のため）。
  // 人が送り直すと決めたので回数は数え直す（temp_tries=0）が、文が残ると前の回数が復活するので、文も差し替える
  return db.prepare(`UPDATE form_jobs SET status='sending', prev_status=?, prev_result=?, temp_tries=0, retry_after=NULL,
      result_text=CASE WHEN result_text LIKE '一時エラーで再送待ち（%' THEN '手動で送り直し中' ELSE result_text END, updated_at=datetime('now') WHERE id=? AND status=?`)
    .run(failLike ? j.status : j.prev_status, failLike ? (j.result_text || "").split("\n")[0].slice(0, 80) : j.prev_result, jobId, j.status).changes > 0;
}

function loadCampaign(id: number): { campaign: Campaign; sender: SenderProfile } {
  const db = getDb();
  const campaign = db.prepare("SELECT * FROM form_campaigns WHERE id=?").get(id) as Campaign | undefined;
  if (!campaign) throw new Error("campaign not found");
  const sender = db.prepare("SELECT * FROM sender_profiles WHERE id=?").get(campaign.sender_id) as SenderProfile;
  return { campaign, sender };
}

async function getSiteInfo(browser: Browser, job: Job, needed: boolean): Promise<{ title: string; text: string }> {
  if (!needed || !job.domain) return { title: "", text: "" };
  const db = getDb();
  const cached = db.prepare("SELECT title, text FROM site_cache WHERE domain=? AND fetched_at > datetime('now','-180 days')").get(job.domain) as { title: string; text: string } | undefined;
  if (cached) return cached;
  const info = await fetchSiteText(browser, job.site_url || job.form_url);
  db.prepare("INSERT INTO site_cache(domain,title,text) VALUES(?,?,?) ON CONFLICT(domain) DO UPDATE SET title=excluded.title,text=excluded.text,fetched_at=datetime('now')").run(job.domain, info.title, info.text);
  return info;
}

/** 同じアドレス（表記ゆれをそろえて比べる）に、days 日以内に送信済み、またはいま送信中の別の会社があれば、その説明。無ければ null。
 *  以前は重複・再送禁止をドメインだけで見ていたため、サイトURLの違う会社に同じ共通アドレスが書かれていると2通届いていた。
 *  古い行は飾り付き（mailto: 等）のまま入っていることがあるので、含むものを拾ってからそろえて比べる */
export function sameAddressSent(email: string, excludeJobId: number, days: number): string | null {
  const n = normalizeEmail(email);
  if (!n) return null;
  const rows = getDb().prepare(`SELECT j.email, j.status, c.name FROM form_jobs j JOIN form_campaigns c ON c.id=j.campaign_id
    WHERE j.id<>? AND j.is_test=0 AND j.channel='email' AND instr(lower(j.email), ?) > 0
      AND (j.status='sending' OR (? > 0 AND j.status='sent' AND j.sent_at > datetime('now', ?)))
    ORDER BY j.status='sending' DESC LIMIT 50`).all(excludeJobId, n, days, `-${days} days`) as { email: string; status: string; name: string }[];
  const hit = rows.find((r) => normalizeEmail(r.email) === n);
  if (!hit) return null;
  return hit.status === "sending" ? `同じアドレス（${n}）に、いま別の会社として送信中（「${hit.name}」）` : `${days}日以内に同じアドレス（${n}）へ送信済み（「${hit.name}」）`;
}

/** 1ジョブを処理して結果をDBに保存 */
export async function processJob(browser: Browser, jobId: number, opts: { dryRun?: boolean } = {}): Promise<Job> {
  try {
    return await processJobInner(browser, jobId, opts);
  } catch (e) {
    // 途中の想定外のエラーで「送信中」のまま残すと、次の起動まで誰も触れなくなる（画面の再試行から呼んだ場合）。
    // メールは送信の前後で必ず catch しているので、ここに来るのは送信より前の失敗
    getDb().prepare("UPDATE form_jobs SET status='failed', result_text=?, updated_at=datetime('now') WHERE id=? AND status='sending'").run(`エラー: ${jpError(e, 150)}`, jobId);
    throw e;
  } finally {
    reserved.delete(jobId); // 送り終わった（または送らなかった）ので、取っておいた枠を返す。送れた分は sent_at で数える
  }
}

async function processJobInner(browser: Browser, jobId: number, opts: { dryRun?: boolean }): Promise<Job> {
  const db = getDb();
  const job = db.prepare("SELECT * FROM form_jobs WHERE id=?").get(jobId) as Job;
  const { campaign, sender: primarySender } = loadCampaign(job.campaign_id);
  // 宛先アドレスの表記ゆれ（mailto:・<>・全角・末尾の記号）をそろえる。配信停止・除外・再送禁止の照合と、
  // 返信・戻りメールの突き合わせが同じ形で引けるよう、そろえた形で保存し直す。
  // サイトURLが無い会社はドメインもメールから作っていたので（「a.jp>」のようになっていた）、合わせて直す
  if (job.email) {
    const ne = normalizeEmail(job.email);
    if (ne && ne !== job.email) {
      const dom = domainOf(job.form_url) || domainOf(job.site_url) ? job.domain : ne.split("@")[1];
      db.prepare("UPDATE form_jobs SET email=?, domain=? WHERE id=?").run(ne, dom, jobId);
      job.email = ne;
      job.domain = dom;
    }
  }
  // メールは、使えるアカウント（上限に達していない・停止中でない）を選ぶ（#24）。
  // 文面の署名・住所も、実際に送るアカウントのものを使う（法律上の表示を送信元と一致させるため）
  const picked = job.channel === "email" && !job.is_test ? pickEmailSender(campaign, primarySender) : null;
  // 選んだ時点で今日の数に入れておく（この後の文面作りなどで待つ間に、別の送信が同じ枠を使わないように）
  if (picked && !opts.dryRun) reserved.set(jobId, { senderId: picked.sender.id, campaignId: campaign.id });
  const sender = picked?.sender ?? primarySender;
  if (picked && picked.sender.id !== primarySender.id) logInfo("worker", `送信アカウントを切り替え: ${primarySender.label} → ${picked.sender.label}`, job.company_name);
  // 使えるアカウントが無い（どれも今日の上限）のに、本来の送信者で送ってしまっていた（画面の「再試行」「修正して再送信」から
  // 呼んだとき。キャンペーンの実行はその前に止まるが、画面からの経路には守りが無かった）。一時停止中なら下の確認で待機に戻る
  if (job.channel === "email" && !job.is_test && !opts.dryRun && !picked && !emailPause(primarySender)) {
    db.prepare("UPDATE form_jobs SET status='queued', result_text=?, retry_after=NULL, updated_at=datetime('now') WHERE id=?")
      .run("今日のメール上限に達しているため待機に戻しました（明日の送信時間帯に自動で続きます）", jobId);
    return db.prepare("SELECT * FROM form_jobs WHERE id=?").get(jobId) as Job;
  }
  // 社名に法人格（株式会社など）が無ければ、会社のホームページの表記から正式名称を補う（AI不要・0円）。
  // 事前チェックはフォームの会社だけが対象なので、メール送信の会社はここで補う（以前は補われていなかった）。
  // まずキャッシュ済みのHP本文、無ければブラウザを使わずにHPの文字だけを読む。URLが無ければメールのドメイン（フリーメールは除く）
  if (!job.is_test && !hasEntity(job.company_name)) {
    const cached = db.prepare("SELECT title, text FROM site_cache WHERE domain=?").get(job.domain) as { title: string; text: string } | undefined;
    let legal = cached ? extractLegalName(job.company_name, `${cached.title}\n${cached.text}`) : null;
    const siteUrl = job.site_url || (job.domain && !FREE_MAIL_DOMAINS.has(job.domain) ? `https://${job.domain}/` : "");
    if (!legal && siteUrl) {
      const found = await findLegalNameFromSite(job.company_name, siteUrl.startsWith("http") ? siteUrl : `https://${siteUrl}`);
      legal = found.legal;
      // 文字が十分に取れたときだけキャッシュする（AI文面用にも使われるため、中身の薄いページは残さない）
      if (!cached && job.domain && found.top.text.length > 200) {
        db.prepare("INSERT INTO site_cache(domain,title,text) VALUES(?,?,?) ON CONFLICT(domain) DO NOTHING").run(job.domain, found.top.title, found.top.text);
      }
    }
    if (legal) { db.prepare("UPDATE form_jobs SET company_name=? WHERE id=?").run(legal, jobId); job.company_name = legal; }
  }
  // 今回が再試行で、前回が失敗系だったら「直前の失敗」を覚えておく（送信済みになったとき履歴として見せる）
  const failLike = ["failed", "skip_no_form", "skip_captcha"];
  if (!job.is_test && failLike.includes(job.status)) {
    db.prepare("UPDATE form_jobs SET prev_status=?, prev_result=? WHERE id=?").run(job.status, (job.result_text || "").split("\n")[0].slice(0, 80), jobId);
  }
  // 前回の試みで書いた「送り始めた印」（sent_by_sender・send_started_at）は、まだ一度も送れていない行（sent_at が空）に限って消す。
  // 残っていると、今回 SMTP より前で止まったときに起動時の片付け（replies.ts の recoverStuckSending）が「送ったかもしれない」と扱い、
  // 送っていない会社を要確認にしていた。送れた記録のある行（戻りメールで失敗になった行など）は消さない
  // （今日の送信数・ウォームアップ・返信の照合が sent_by_sender を見ているため）
  db.prepare(`UPDATE form_jobs SET status='sending', attempts=attempts+1, updated_at=datetime('now'),
      sent_by_sender=CASE WHEN sent_at IS NULL THEN NULL ELSE sent_by_sender END,
      send_started_at=CASE WHEN sent_at IS NULL THEN NULL ELSE send_started_at END WHERE id=?`).run(jobId);

  const finish = (status: JobStatus, result: string, extra: Partial<Job> = {}) => {
    db.prepare(
      `UPDATE form_jobs SET status=@status, result_text=@result_text, message_used=COALESCE(@message_used, message_used),
        screenshot_path=COALESCE(@screenshot_path, screenshot_path), form_url=COALESCE(@form_url, form_url),
        pending_questions=CASE WHEN @status='sent' THEN '' ELSE COALESCE(@pending_questions, pending_questions) END,
        sent_at=CASE WHEN @status='sent' THEN datetime('now') ELSE sent_at END, retry_after=NULL, updated_at=datetime('now') WHERE id=@id`
    ).run({ id: jobId, status, result_text: result, message_used: extra.message_used ?? null, screenshot_path: extra.screenshot_path ?? null, form_url: extra.form_url ?? null, pending_questions: extra.pending_questions ?? null });
    return db.prepare("SELECT * FROM form_jobs WHERE id=?").get(jobId) as Job;
  };

  // 除外リスト（送信直前にも確認）。メールは、送り先アドレスのドメインも見る（サイトURLの会社と別のドメインのことがある）
  const mailDomain = job.channel === "email" ? emailDomain(job.email) : "";
  if (!job.is_test && (domainSuppressed(job.domain) || (mailDomain && mailDomain !== job.domain && domainSuppressed(mailDomain)))) return finish("skip_suppressed", "除外リストに登録済み");
  // 官公庁・学校等は取り込みで外しているが、以前の取り込みでドメインが「go.jp>」のように崩れて素通りした行があるため、送信直前にも見る
  if (!job.is_test && job.channel === "email" && (isExcludedDomain(job.domain) || (mailDomain && isExcludedDomain(mailDomain)))) return finish("skip_suppressed", "官公庁・学校等のドメインは既定で除外");
  // 同じアドレスに、再送禁止の期間内に送っている／いま別の送信で送っている（グループ会社の共通 info@ を複数社に書いた表、
  // 同じアドレスの重複行など）。取り込みで外しきれなかった分の保険で、送る直前にも確かめる
  if (!job.is_test && job.channel === "email" && job.email) {
    const dup = sameAddressSent(job.email, job.id, campaign.resend_days);
    if (dup) return finish("skip_duplicate", dup);
  }
  // チームの誰かがすでに送っている会社には送らない（#78）。フリーメールの会社はドメインではなくアドレスで照合する（share.ts）
  if (!job.is_test && (job.domain || job.email)) {
    const by = sharedSentBy(job.domain, job.email);
    if (by) return finish("skip_duplicate", `チームの ${by.member || "他のメンバー"} が送信済み（共有リスト${by.sent_at ? `・${by.sent_at.slice(0, 10)}` : ""}）`);
  }
  // 設定で指定した「送りたくない業種・キーワード」（#87）。取り込み後に設定を変えた場合もここで止まる
  if (!job.is_test) {
    const ng = matchExcludedKeyword({ company_name: job.company_name, industry: job.industry, sub_industry: job.sub_industry });
    if (ng) return finish("skip_suppressed", `除外キーワード「${ng}」に一致（設定で変更できます）`);
  }
  // 同じグループの別キャンペーンですでに送信済み／送信中なら送らない（取り込み後にグループを付けた場合などの保険）
  if (!job.is_test) {
    const dup = findGroupDuplicate(db, { groupName: campaign.group_name, campaignId: campaign.id, domain: job.domain, email: job.email, statuses: ["sending", "sent"], excludeJobId: job.id });
    if (dup) return finish("skip_duplicate", `同じグループの「${dup}」で送信済み`);
  }

  // 文面
  let subject = "", message = "";
  try {
    // 企業HP本文が要るのは文面をAI生成するモードだけ。tpl_ai は文面テンプレなので取得不要（速く・安く）
    const needSite = (campaign.mode === "ai" || campaign.mode === "hybrid") && activeProvider() !== "none";
    const site = await getSiteInfo(browser, job, needSite);
    const composed = await composeMessage(job, sender, campaign, site);
    subject = composed.subject;
    message = composed.message;
    // A/Bテストでどちらの文面を送ったかを残す（あとで反応を比べるため: #64）
    if (!job.is_test) db.prepare("UPDATE form_jobs SET variant=? WHERE id=?").run(composed.variant, jobId);
  } catch (e) {
    const why = String((e as Error).message ?? e).slice(0, 150);
    // AIのAPIキー・残高・混雑・回線など、こちら側の原因なら、この会社は失敗にせず待機に戻す（どの会社でも同じく失敗するため）
    const ai = campaign.mode === "ai" && !job.is_test ? aiErrorKind(e) : null;
    if (ai?.kind === "config") {
      // 直すまで何度やっても失敗するので、キャンペーンを一時停止して知らせる（設定を直して「開始」で続きから）
      requestStop(campaign.id);
      db.prepare("UPDATE form_campaigns SET status='paused', pause_reason=? WHERE id=?").run(`AIで文面を作れないため: ${jpError(why, 120)}`, campaign.id);
      notify("AIで文面を作れないため送信を止めました", `「${campaign.name}」: ${jpError(why, 120)}。設定画面でAIのAPIキー・残高・モデルを確認してから、もう一度「開始」してください`, `aicfg:${campaign.id}`);
      logError("worker", `AIの設定の問題で一時停止: ${jpError(why)}`, job.company_name);
      return finish("queued", `AIで文面を作れないため待機に戻しました（キャンペーンを一時停止）: ${jpError(why, 120)}`);
    }
    if (ai?.kind === "transient") {
      if (ai.minutes > 0) {
        setAiPause(ai.minutes, jpError(why, 120));
        notify("AIが混み合っているため送信を少し止めました", `${jpError(why, 120)}（${ai.minutes}分後に自動で再開します）`, "aipause");
      }
      return finish("queued", `AIで文面を作れなかったため待機に戻しました${ai.minutes > 0 ? `（${ai.minutes}分後に自動で再開）` : ""}: ${jpError(why, 120)}`);
    }
    return finish("failed", `文面生成エラー: ${jpError(why, 150)}`);
  }
  const ng = findNgWords(message);
  if (ng.length) return finish("failed", `NGワード検出: ${ng.join(", ")}`, { message_used: message });
  const errs = lintMessage(message, subject, campaign.channel).filter((l) => l.level === "error");
  if (errs.length) {
    const why = errs.map((e) => e.text).join(" / ");
    // 差し込み名の書き間違い（{{企業}} など）は文面の側の問題で、どの会社でも同じく止まる。
    // 1社ずつ失敗にすると待機中の全社が失敗に変わってしまうので、この会社は待機に戻し、キャンペーンを止めて知らせる
    // （以前の版は空欄のまま送っていたので、アップデート直後にこれで一斉に失敗にしないためでもある）
    if (!job.is_test && errs.some((e) => /差し込みが置き換わっていません|【ここに/.test(e.text))) {
      requestStop(campaign.id);
      db.prepare("UPDATE form_campaigns SET status='paused', pause_reason=? WHERE id=?").run(`文面に直す所があるため: ${why.slice(0, 160)}`, campaign.id);
      notify("文面に直す所があるため送信を止めました", `「${campaign.name}」: ${why.slice(0, 120)}。キャンペーンの文面（【ここに…】や {{…}} の名前）を直してから、もう一度「開始」してください`, `tplvar:${campaign.id}`);
      logError("worker", `文面の間違いで一時停止: ${why.slice(0, 200)}`, job.company_name);
      return finish("queued", `文面に直す所があるため待機に戻しました（キャンペーンを一時停止）: ${why.slice(0, 160)}`);
    }
    return finish("failed", `文面エラー: ${why}`, { message_used: message });
  }

  if (job.channel === "email") {
    if (!job.email) return finish("failed", "メールアドレスが無い", { message_used: message });
    // 上でそろえられなかった＝アドレスとして読めない。nodemailer に渡すと、思わぬ宛先に直して送ることがあるので送らない
    if (!normalizeEmail(job.email)) return finish("failed", `メールアドレスの形が正しくない（${job.email.slice(0, 80)}）。会社の画面の「修正して再送信」で直してください`, { message_used: message });
    if (isOptedOut(job.email)) return finish("skip_optout", "配信停止済みのアドレス", { message_used: message });
    const paused = emailPause(sender);
    if (paused) return finish("queued", `メール送信を一時停止中のため待機に戻しました: ${paused.reason}`, { message_used: message });
    const chk = senderEmailOk(sender);
    if (!chk.ok) {
      // 設定が足りないのは全社共通なので、1社ずつ失敗にせず送信を止めて待機に戻す（送信者を保存すると解除）
      setEmailPause(sender, 24 * 60, chk.reason ?? "差出人メールが使えません");
      notify("メール送信を止めました（設定が必要）", chk.reason ?? "差出人メールが使えません", `senderng:${sender.id}`);
      return finish("queued", `メール送信を一時停止しました: ${chk.reason ?? "差出人メールが使えません"}`, { message_used: message });
    }
    if (opts.dryRun) return finish("queued", "テスト（メールは送っていない）", { message_used: message });
    try {
      const body = buildEmailBody(message, sender, job.email);
      // 資料ファイルがあればメールに添付する（フォームは添付できないので本文リンクで対応済み）
      const attachments = campaign.attach_path && fs.existsSync(campaign.attach_path)
        ? [{ path: campaign.attach_path, filename: campaign.attach_name || "資料.pdf" }]
        : undefined;
      await oneMailAtATime(async () => {
        // どのアカウントで送るかと、送り始めた時刻を「送る前に」書いておく。
        // 送信中にアプリが止まった・通信が切れたとき、どのアカウントの送信済みフォルダを見て、いつ以降の控えを探すかに使う
        // （以前は送れた後に書いていたため、途中で止まると本来の送信者の送信済みフォルダを見て「未送信」と判断し、二重送信になり得た）。
        // 順番待ちの後に書くのは、待っている間に止まった会社を「送ったかもしれない」と扱わないため（起動時に確認なしで待機に戻せる）
        db.prepare("UPDATE form_jobs SET sent_by_sender=?, send_started_at=datetime('now'), updated_at=datetime('now') WHERE id=?").run(sender.id, jobId);
        await sendEmail(sender, { from: chk.from, to: job.email, subject, ...body, attachments });
      });
      resetStreak(sender);
      return finish("sent", `メール送信（${job.email}${sender.id !== primarySender.id ? `／送信アカウント: ${sender.label}` : ""}）`, { message_used: message });
    } catch (e) {
      const why = explainSmtpError(e, sender);
      const kind = classifySmtpError(e);
      if (kind.kind === "unknown") {
        // 本文を送り切った後に切れた: 届いているかもしれないので送り直さない。送信済みフォルダで確かめて、
        // 無ければ待機に戻す（replies.ts の verifyInterruptedEmails）。updated_at は送り始めた時刻のまま残す（照合に使う）
        db.prepare("UPDATE form_jobs SET status='failed', result_text=?, message_used=? WHERE id=?")
          .run(`${CUT_PREFIX}（送信済みか不明・要確認）: ${why}。送信済みフォルダを自動で確認します。確認できない場合は、送信用メールの「送信済み」フォルダに届いているか見て、無ければ再送信してください`, message, jobId);
        logWarn("worker", `送信の最後で通信が切れた（送信済みか不明）: ${job.email}`, job.company_name);
        setTimeout(() => { verifyInterruptedEmails().catch(() => {}); }, 3 * 60_000).unref?.();
        return db.prepare("SELECT * FROM form_jobs WHERE id=?").get(jobId) as Job;
      }
      if (kind.kind === "pause") {
        const { minutes } = kind;
        setEmailPause(sender, minutes, why);
        // 上限・ログイン拒否で止まったら、ウォームアップを1段階下げて様子を見る（#18）
        if (kind.penalty) setSetting(`warmup_penalty:${sender.id}`, String(Date.now()));
        notify("メール送信を一時停止しました", `${why}（${minutes >= 60 ? `${Math.round(minutes / 60)}時間` : `${minutes}分`}後に自動で再開。フォーム送信は続きます）`, `pause:${sender.id}`);
        return finish("queued", `メール送信を一時停止しました（${minutes >= 60 ? `${Math.round(minutes / 60)}時間` : `${minutes}分`}後に自動で再開）: ${why}`, { message_used: message });
      }
      // 宛先を受け付けた後の 4xx・本文の段階の 5xx が、別の宛先で続いたら、送信用アカウント側の制限とみなして止める
      const streak = maybeAccountSide(e) ? bumpStreak(sender, job.email, jobId) : null;
      if (streak) {
        const minutes = streakPauseMinutes(sender);
        const reason = `別の宛先で${ACCOUNT_STREAK}件続けて受け付けられなかったため、送信用アカウント側の制限か文面・添付の問題とみなしました: ${why}`;
        setEmailPause(sender, minutes, reason);
        const span = minutes >= 60 ? `${Math.round(minutes / 60)}時間` : `${minutes}分`;
        // 先の2件は宛先のせいではなかったので、数えた回数を戻して待機に戻す（本文の段階で断られて失敗にした分も、届いていないので戻す）
        const back = db.prepare(`UPDATE form_jobs SET status='queued', retry_after=NULL, temp_tries=MAX(temp_tries-1, 0), result_text=?, updated_at=datetime('now')
          WHERE id=? AND (status='queued' OR (status='failed' AND result_text LIKE 'メール送信エラー%'))`);
        for (const id of streak) if (id !== jobId) back.run(`メール送信を一時停止したため待機に戻しました（${span}後に自動で再開）: ${reason}`, id);
        notify("メール送信を一時停止しました", `${reason}（${span}後に自動で再開。フォーム送信は続きます）`, `pause:${sender.id}`);
        logWarn("worker", `送信用アカウントの制限とみなして一時停止（${span}）: ${why}`, job.company_name);
        return finish("queued", `メール送信を一時停止しました（${span}後に自動で再開）: ${reason}`, { message_used: message });
      }
      if (kind.kind === "temporary") {
        // 宛先側の一時的な拒否。回数を限って、時間を置いて送り直す。
        // 回数は列（temp_tries）に持つ。以前は結果の文から読んでいたため、間に「一時停止のため待機」が入ると 0 に戻っていた
        const prevTries = Math.max(Number((job as Job & { temp_tries?: number }).temp_tries ?? 0), Number(/^一時エラーで再送待ち（(\d)\//.exec(job.result_text || "")?.[1] ?? 0));
        const tries = prevTries + 1;
        db.prepare("UPDATE form_jobs SET temp_tries=? WHERE id=?").run(tries, jobId);
        if (tries < TEMP_RETRY_MAX) {
          const wait = TEMP_RETRY_WAIT_MIN[tries - 1] ?? TEMP_RETRY_WAIT_MIN[TEMP_RETRY_WAIT_MIN.length - 1];
          const j = finish("queued", `一時エラーで再送待ち（${tries}/${TEMP_RETRY_MAX - 1}回目・${wait}分後）: ${why}`, { message_used: message });
          db.prepare("UPDATE form_jobs SET retry_after=datetime('now', ?) WHERE id=?").run(`+${wait} minutes`, jobId);
          return j;
        }
        return finish("failed", `メール送信エラー（${TEMP_RETRY_MAX}回試しても一時エラーのまま）: ${why}`, { message_used: message });
      }
      return finish("failed", `メール送信エラー: ${why}`, { message_used: message });
    }
  }

  const r = await submitToCompany(browser, { jobId, formUrl: job.form_url, siteUrl: job.site_url, sender, subject, message, dryRun: opts.dryRun, ignoreRefusal: Boolean(campaign.ignore_refusal), aiMode: (campaign.mode === "ai" || campaign.mode === "tpl_ai") && activeProvider() !== "none", company: job.company_name, manualAnswers: parseManualAnswers(job.manual_answers) });
  const detail = [r.detail, ...r.log].join("\n");
  // フォームが見つからなかった会社に、メールアドレスがあればメール送信へ自動で振り替える（#16）。
  // これまでは「フォーム無し」で止まり、人が手で振り分け直していた（取りこぼしが最も多かったところ）
  if (!opts.dryRun && !job.is_test && r.status === "skip_no_form" && job.email && allowsEmailFallback(campaign.channel) && !isOptedOut(job.email)) {
    db.prepare("UPDATE form_jobs SET channel='email', status='queued', result_text=?, scan_note=?, updated_at=datetime('now') WHERE id=?")
      .run(`フォームが見つからなかったため、メール送信に切り替えました（${job.email}）`, `フォーム無し → メールに切替（${job.email}）`, jobId);
    logInfo("worker", `フォーム無しのためメールに切替: ${job.email}`, job.company_name);
    return db.prepare("SELECT * FROM form_jobs WHERE id=?").get(jobId) as Job;
  }
  if (r.status === "skip_refused" && job.domain && !campaign.ignore_refusal) {
    db.prepare("INSERT OR IGNORE INTO form_suppressions(domain, reason) VALUES(?,?)").run(job.domain, "営業お断り文言を検知（自動）");
  }
  const status: JobStatus = opts.dryRun ? "queued" : r.status;
  return finish(status, detail, { message_used: message, screenshot_path: r.screenshot, form_url: r.finalUrl && r.status !== "skip_no_form" ? r.finalUrl : undefined, pending_questions: r.pendingQuestions ? JSON.stringify(r.pendingQuestions) : undefined });
}

/** キャンペーンのキューを回す。停止要求・送信時間帯・日次上限を守る */
export async function runCampaign(campaignId: number, opts: { ignoreWindow?: boolean; onProgress?: (j: Job) => void } = {}): Promise<{ processed: number; reason: string }> {
  if (running.has(campaignId)) return { processed: 0, reason: "already running" };
  if (shuttingDown) return { processed: 0, reason: "アプリ終了中" };
  const state = { stop: false, lastActive: Date.now() };
  running.set(campaignId, state);
  const db = getDb();
  db.prepare("UPDATE form_campaigns SET status='running' WHERE id=?").run(campaignId);
  let processed = 0;
  let reason = "queue empty";
  // ブラウザの起動に失敗したら「実行中」の記録を必ず消す。
  // 以前はここで失敗すると実行中のまま残り、画面は「実行中」なのに二度と送らない状態になっていた（実例: 10日間止まっていた）
  let browser: Browser;
  try {
    browser = await launchBrowser();
  } catch (e) {
    running.delete(campaignId);
    console.error(`[campaign ${campaignId}] ブラウザを起動できませんでした:`, e);
    logError("worker", `ブラウザを起動できませんでした: ${jpError(e)}`);
    notify("送信を始められませんでした", jpError(e), `launch:${campaignId}`);
    throw e;
  }
  // 送信中はパソコンをスリープさせない（スリープで止まる問い合わせが最も多かった）
  const releaseAwake = keepAwake();
  // 続けて失敗しているときに気づけるようにする（設定ミス・サイト側の変化・ネットワーク断）
  let failStreak = 0;
  try {
    // メールは1本目（index 0）だけが送る。並列の2本が同じアカウントから同時に送ると、Gmail 等に送りすぎと見なされやすいため。
    // フォームは従来どおり2本で回す
    const worker = async (_: unknown, index: number) => {
      while (!state.stop) {
        state.lastActive = Date.now();
        const { campaign, sender } = loadCampaign(campaignId);
        if (!opts.ignoreWindow && !inSendWindow(campaign)) { reason = "送信時間帯外"; return; }
        // 「メールだけ／フォームだけ」を選んで開始した場合は、その種類だけを送る
        const only = String((campaign as { send_only?: string }).send_only ?? "");
        const formCap = cappedDailyLimit(campaign.daily_limit).limit;
        const formOk = only !== "email" && sentToday(campaignId, "form") < formCap;
        // メールは「ウォームアップ中の上限」と「使えるアカウントがあるか」で判断する（#18 #24）
        const mail = pickEmailSender(campaign, sender);
        const emailOk = only !== "form" && Boolean(mail);
        if (!formOk && !emailOk) {
          reason = only ? `${only === "email" ? "メール" : "フォーム"}の送信が上限または一時停止` : "本日の上限に到達";
          // 「上限に達して止まった」ことに気づけるように通知する（1時間に1回まで）
          if (notify("本日の送信上限に達しました", `「${campaign.name}」は今日の上限（フォーム${campaign.daily_limit}・メール${campaign.email_daily_limit}）に達したため止まりました。残りは明日の送信時間帯に自動で続きます`, `limit:${campaignId}`)) {
            logInfo("worker", `上限で停止: ${campaign.name}（${reason}）`);
          }
          return;
        }
        // 文面をAIで作るキャンペーンは、AIの一時停止中は止める（時間が来たら自動で再開される）
        const ap = campaign.mode === "ai" ? aiPause() : null;
        if (ap) { reason = `AIの一時停止中: ${ap.reason}`; return; }
        const channels = [formOk && "form", emailOk && index === 0 && "email"].filter(Boolean) as string[];
        if (!channels.length) return; // 2本目で、メールしか残っていない（メールは1本目が送る）
        const next = db.prepare(`SELECT id, channel FROM form_jobs WHERE campaign_id=? AND status='queued' AND is_test=0 AND ${READY_SQL} AND channel IN (${channels.map(() => "?").join(",")}) ORDER BY id LIMIT 1`).get(campaignId, ...channels) as { id: number; channel: string } | undefined;
        if (!next) { reason = "queue empty or 本日の上限"; return; }
        if (shuttingDown || state.stop) break;
        // 取り合い防止（同一プロセス内の並列用）
        const claimed = db.prepare("UPDATE form_jobs SET status='sending' WHERE id=? AND status='queued'").run(next.id).changes;
        if (!claimed) continue;
        inFlight++;
        try {
          const j = await processJob(browser, next.id);
          processed++;
          opts.onProgress?.(j);
          // 続けて失敗していないか見る（10件続いたら知らせる。設定ミスや回線不調に早く気づけるように）
          if (j.status === "failed") {
            failStreak++;
            logWarn("worker", `失敗: ${j.result_text.split("\n")[0]}`, j.company_name);
            if (failStreak === 10) {
              notify("送信が続けて失敗しています", `「${campaign.name}」で10件続けて失敗しました。エラーログ画面で内容を確認してください（最後の理由: ${j.result_text.split("\n")[0].slice(0, 60)}）`, `streak:${campaignId}`);
              logError("worker", `10件続けて失敗（最後の理由: ${j.result_text.split("\n")[0].slice(0, 120)}）`);
            }
          } else if (j.status === "sent") failStreak = 0;
          // 自動再試行は「送信前の通信エラー」だけ。「送信後の判定不能」は送信ボタンを押し済みで、
          // 実際には届いていることが多い（例: 完了文言を知らなかっただけ）。再試行すると同じ会社に二重送信になるため除外する。
          // 見るのは結果の1行目だけ。2行目以降は操作の記録で、「click失敗: Timeout」のような行があるだけで、
          // ボタンを押したあとの失敗（確認画面を抜けられない等）まで送り直していた
          // メールは送信エラーの種類ごとに processJob で待機・再送を決めている（通信断は一時停止、本文送信後の切断は送信済みフォルダで確認）ので、ここでは送り直さない
          if (j.status === "failed" && j.channel !== "email" && j.attempts < 2 && !/送信後の判定不能/.test(j.result_text) && /(例外|timeout|Timeout|net::|ECONN|socket|接続)/.test(j.result_text.split("\n")[0])) {
            db.prepare("UPDATE form_jobs SET status='queued', result_text=? WHERE id=?").run(`再試行待ち: ${j.result_text.split("\n")[0]}`, j.id);
          }
        } catch (e) {
          db.prepare("UPDATE form_jobs SET status='failed', result_text=? WHERE id=?").run(`エラー: ${jpError(e, 150)}`, next.id);
          logError("worker", `送信中のエラー: ${jpError(e)}`);
        } finally {
          inFlight--;
        }
        if (shuttingDown || state.stop) break;
        // フォーム送信の間隔は 3〜5秒に固定（以前は設定で 8〜15秒なども選べたが、選ぶ必要が無いので設定ごと無くした）。
        // 環境変数で指定されていればそちらを優先（テスト用）。
        // メールは 8〜12秒あける（以前は 2〜5秒×並列2本で、1分に20通を超えることがあり、Gmail の「送りすぎ（421 4.7.0）」を招きやすかった）
        const [lo, hi] = process.env.FO_MIN_WAIT_MS ? [MIN_WAIT, MAX_WAIT] : [3000, 5000];
        const wait = next.channel === "email" ? (process.env.FO_MIN_WAIT_MS ? MIN_WAIT : 8000 + Math.random() * 4000) : lo + Math.random() * (hi - lo);
        await new Promise((r) => setTimeout(r, wait));
      }
      reason = "停止要求";
    };
    await Promise.all(Array.from({ length: Math.max(1, CONCURRENCY) }, worker));
  } finally {
    await browser.close().catch(() => {});
    releaseAwake();
    running.delete(campaignId);
    const left = (db.prepare("SELECT COUNT(*) n FROM form_jobs WHERE campaign_id=? AND status='queued' AND is_test=0").get(campaignId) as { n: number }).n;
    // 時間帯外・上限で止まった場合は running のまま残し、スケジューラが再開する
    db.prepare("UPDATE form_campaigns SET status=? WHERE id=?").run(left === 0 ? "done" : state.stop && !shuttingDown ? "paused" : "running", campaignId); // アプリ終了で止めた場合は実行中のまま（次の起動で再開）
    if (left === 0 && processed > 0) {
      const name = (db.prepare("SELECT name FROM form_campaigns WHERE id=?").get(campaignId) as { name: string } | undefined)?.name ?? `#${campaignId}`;
      notify("送信が完了しました", `「${name}」の待機がすべて終わりました（今回 ${processed}件）`, `done:${campaignId}`);
    }
  }
  return { processed, reason };
}

/** 事前チェック: フォームの有無・お断り・CAPTCHA・メールを調べて振り分ける（フォーム無し→メールに切替） */
export async function scanCampaign(campaignId: number): Promise<{ scanned: number; reason: string }> {
  const key = -campaignId;
  if (running.has(key) || running.has(campaignId)) return { scanned: 0, reason: "already running" };
  const state = { stop: false, lastActive: Date.now() };
  running.set(key, state);
  const db = getDb();
  let scanned = 0;
  let browser: Browser | null = null;
  const releaseAwake = keepAwake(); // 事前チェック中もスリープさせない
  try {
    const { campaign } = loadCampaign(campaignId);
    browser = await launchBrowser();
    for (;;) {
      if (state.stop) break;
      state.lastActive = Date.now(); // 動いている印（固まった実行の片付け clearStaleRuns に消されないように）
      const job = db.prepare("SELECT * FROM form_jobs WHERE campaign_id=? AND status='queued' AND is_test=0 AND channel='form' AND scanned_at IS NULL ORDER BY id LIMIT 1").get(campaignId) as Job | undefined;
      if (!job) break;
      db.prepare("UPDATE form_jobs SET scanned_at=datetime('now') WHERE id=?").run(job.id);
      const r = await scanCompany(browser, { formUrl: job.form_url, siteUrl: job.site_url, companyName: job.company_name });
      // HPの表記から正式名称（法人格つき）が取れたら社名を補完する（「div」→「株式会社div」等。失礼を防ぐ）
      let nameNote = "";
      if (r.legalName && r.legalName !== job.company_name) {
        db.prepare("UPDATE form_jobs SET company_name=? WHERE id=?").run(r.legalName, job.id);
        nameNote = `／社名を補完: ${job.company_name} → ${r.legalName}`;
      }
      scanned++;
      // サイトで見つけたアドレスも表記ゆれをそろえる（「info@a.jp」の後ろに句読点や全角が付いたまま入ると、配信停止の照合を外れる）
      const email = normalizeEmail(job.email) || r.emails.map((x) => normalizeEmail(x)).find(Boolean) || job.email || "";
      let status: JobStatus = "queued";
      let note = "";
      let channel: "form" | "email" = "form";
      if (r.refused && !campaign.ignore_refusal) {
        status = "skip_refused"; note = `営業お断り文言: 「${r.refused}」`;
        db.prepare("INSERT OR IGNORE INTO form_suppressions(domain, reason) VALUES(?,?)").run(job.domain, "営業お断り文言を検知（事前チェック）");
      } else if (r.captcha) { status = "skip_captcha"; note = `CAPTCHAあり (${r.captcha})`; }
      else if (r.formUrl) note = `フォームあり${r.emails.length ? `・メール発見 ${r.emails[0]}` : ""}`;
      else if (allowsEmailFallback(campaign.channel) && normalizeEmail(email) && !isOptedOut(email)) { channel = "email"; note = `フォーム無し → メールに切替（${email}）`; }
      else { status = "skip_no_form"; note = r.note || "フォームが見つからない"; }
      if (nameNote) note += nameNote;
      // 「送れそう度」を点数にして残す（#9）。送れる会社から先に回したいときの並び替えに使う
      let score = 0;
      if (!/サイトにアクセスできない/.test(r.note)) score += 20;
      if (r.formUrl) score += 50;
      if (email) score += 25;
      if (r.captcha) score -= 45;
      if (r.refused) score = 0;
      score = Math.max(0, Math.min(100, score));
      db.prepare("UPDATE form_jobs SET status=?, channel=?, email=?, form_url=?, scan_note=?, scan_score=?, result_text=?, updated_at=datetime('now') WHERE id=?")
        .run(status, channel, email, r.formUrl ?? job.form_url, note, score, status === "queued" ? `事前チェック: ${note}` : note, job.id);
      await new Promise((r) => setTimeout(r, 1000 + Math.random() * 1500));
    }
    if (scanned && !state.stop) {
      const name = (db.prepare("SELECT name FROM form_campaigns WHERE id=?").get(campaignId) as { name: string } | undefined)?.name ?? `#${campaignId}`;
      notify("事前チェックが終わりました", `「${name}」の ${scanned}件を調べ終わりました（結果はキャンペーン画面で確認できます）`, `scandone:${campaignId}`);
    }
    return { scanned, reason: state.stop ? "停止" : "done" };
  } catch (e) {
    logError("scan", `事前チェックが途中で止まりました: ${jpError(e)}`);
    notify("事前チェックが止まりました", jpError(e, 120), `scanerr:${campaignId}`);
    return { scanned, reason: `エラー: ${jpError(e, 120)}` };
  } finally {
    await browser?.close().catch(() => {});
    releaseAwake();
    running.delete(key);
  }
}

// 単独起動: 実行中(running)のキャンペーンを順に回し続ける（1分ごとに見直し）
if (process.argv[1] && /worker\.(ts|js)$/.test(process.argv[1])) {
  (async () => {
    console.log(`[form-worker] start provider=${activeProvider()} concurrency=${CONCURRENCY}`);
    for (;;) {
      const ids = getDb().prepare("SELECT id FROM form_campaigns WHERE status='running'").all() as { id: number }[];
      for (const { id } of ids) {
        const r = await runCampaign(id);
        if (r.processed) console.log(`[form-worker] campaign ${id}: ${r.processed}件 (${r.reason})`);
      }
      await new Promise((r) => setTimeout(r, 60000));
    }
  })();
}
