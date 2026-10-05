// 質問箱で答えられなかった質問を、配布元（開発者）に送り、返信をチャットに戻す。
//
// サーバーは持たない方針なので、チーム共有（share.ts）と同じく Google スプレッドシート＋Apps Script を使う。
//   ・利用者が「担当者に送る」を押す → このアプリが、配布元の Apps Script（WebアプリのURL）へ質問をPOSTする
//   ・配布元は、スプレッドシートの「返信」の列に答えを書く
//   ・このアプリが数分おきに返信を見に行き、届いたらチャットに出して通知する
// 送り先のURLは update.json の support_url に書く（配布元が1回書けば、アップデートで全利用先に届く）。
// 空のあいだは、この機能は出ない（質問箱は「診断ファイルを送ってください」の案内に戻る）。
//
// 送るのは「質問の文章・版・開いていた画面・会社名と表示名」だけ。営業リストや送信履歴、パスワード類は送らない。
// 他の利用先の返信が読めないよう、質問ごとに推測できない番号（ticket）を振り、その番号を知っている端末だけが返信を読める。
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getDb } from "./db.js";
import { notify } from "./notify.js";
import { currentVersion, ROOT } from "./update.js";
import { logError } from "./applog.js";

export type SupportTicket = { id: number; ticket: string; user_id: number; chat_id?: number; question: string; page: string; created_at: string; sent_ok: number; reply: string; replied_at: string | null; seen_at: string | null; context: string; parent: string };

/** 配布元の Apps Script のURL（update.json の support_url）。未設定なら空 */
export function supportUrl(): string {
  if (process.env.SUPPORT_URL !== undefined) return process.env.SUPPORT_URL; // テスト用
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "update.json"), "utf8")) as { support_url?: string };
    const u = String(cfg.support_url ?? "").trim();
    return /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(u) ? u : "";
  } catch { return ""; }
}
export const supportEnabled = () => supportUrl() !== "";

/** 受付時間・返信の目安（update.json の support_note）。例:「平日10〜18時に、1営業日以内を目安にお返事します」。空なら出さない */
export function supportNote(): string {
  if (process.env.SUPPORT_NOTE !== undefined) return process.env.SUPPORT_NOTE; // テスト用
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "update.json"), "utf8")) as { support_note?: string };
    return String(cfg.support_note ?? "").trim().slice(0, 120);
  } catch { return ""; }
}

async function post(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20_000);
  try {
    // Apps Script は 302 で別のURLへ回すので、追いかける（既定の follow）
    const r = await fetch(supportUrl(), { method: "POST", headers: { "content-type": "text/plain;charset=utf-8" }, body: JSON.stringify(body), signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return (await r.json()) as Record<string, unknown>;
  } finally { clearTimeout(timer); }
}

/** 質問を控えて、配布元へ送る。送れなくても控えは残し、あとで送り直す */
/** context: どの会社（1件の送信）についての質問か。parentId: 追加の質問のとき、元の質問（この利用者のもの）の id */
export async function askSupport(userId: number, who: string, question: string, page: string, context = "", parentId = 0, chatId = 0): Promise<{ ok: boolean; ticket: SupportTicket }> {
  const db = getDb();
  const ticket = crypto.randomBytes(16).toString("hex");
  const parent = parentId ? ((db.prepare("SELECT ticket FROM support_tickets WHERE id=? AND user_id=?").get(parentId, userId) as { ticket: string } | undefined)?.ticket ?? "") : "";
  const id = db.prepare("INSERT INTO support_tickets(ticket, user_id, who, question, page, context, parent, chat_id) VALUES(?,?,?,?,?,?,?,?)").run(ticket, userId, who.slice(0, 120), question.slice(0, 2000), page.slice(0, 200), context.slice(0, 600), parent, chatId).lastInsertRowid as number;
  const ok = await sendTicket(id);
  return { ok, ticket: db.prepare("SELECT * FROM support_tickets WHERE id=?").get(id) as SupportTicket };
}

async function sendTicket(id: number): Promise<boolean> {
  const db = getDb();
  const t = db.prepare("SELECT * FROM support_tickets WHERE id=?").get(id) as (SupportTicket & { who: string }) | undefined;
  if (!t || !supportEnabled()) return false;
  try {
    const r = await post({ action: "ask", ticket: t.ticket, who: t.who, version: currentVersion(), page: t.page, question: t.question, at: t.created_at, context: t.context, parent: t.parent });
    if (r.ok !== true) throw new Error(String(r.error ?? "受け付けられませんでした"));
    db.prepare("UPDATE support_tickets SET sent_ok=1 WHERE id=?").run(id);
    return true;
  } catch (e) {
    logError("support", `質問を配布元に送れませんでした: ${String((e as Error).message ?? e).slice(0, 120)}`);
    return false;
  }
}

/** 返信が届いていないかを見に行く。届いたらチャットに出し、通知する。戻り値は新しく届いた件数 */
export async function pollSupportReplies(): Promise<number> {
  if (!supportEnabled()) return 0;
  const db = getDb();
  // 送れていなかった質問は、ここで送り直す
  for (const r of db.prepare("SELECT id FROM support_tickets WHERE sent_ok=0 AND created_at > datetime('now','-14 days') LIMIT 10").all() as { id: number }[]) await sendTicket(r.id);
  // 返信待ちの質問（60日より古いものは見に行かない）
  const open = db.prepare("SELECT ticket FROM support_tickets WHERE sent_ok=1 AND reply='' AND created_at > datetime('now','-60 days') LIMIT 50").all() as { ticket: string }[];
  if (!open.length) return 0;
  let got = 0;
  try {
    const r = await post({ action: "poll", tickets: open.map((o) => o.ticket) });
    const replies = Array.isArray(r.replies) ? (r.replies as { ticket?: string; reply?: string }[]) : [];
    for (const x of replies) {
      const text = String(x.reply ?? "").trim().slice(0, 4000);
      if (!x.ticket || !text) continue;
      const n = db.prepare("UPDATE support_tickets SET reply=?, replied_at=datetime('now') WHERE ticket=? AND reply=''").run(text, String(x.ticket)).changes;
      if (n) {
        got++; notify("質問に返信が届きました", text.slice(0, 80), `support-${x.ticket}`);
        // その質問を送った問い合わせ（終了済みでも）に、返信を書き足す。一覧から開くと続きとして読める
        const t = db.prepare("SELECT id, chat_id FROM support_tickets WHERE ticket=?").get(String(x.ticket)) as { id: number; chat_id: number } | undefined;
        if (t?.chat_id) appendChatMessage(t.chat_id, { r: "staff", t: text, tk: t.id });
      }
    }
  } catch (e) {
    logError("support", `返信の確認に失敗しました: ${String((e as Error).message ?? e).slice(0, 120)}`);
  }
  return got;
}

/** この利用者の、担当者とのやり取り（新しい順に最大20件を、古い順に並べて返す） */
export function supportThread(userId: number): SupportTicket[] {
  return (getDb().prepare("SELECT * FROM support_tickets WHERE user_id=? ORDER BY id DESC LIMIT 20").all(userId) as SupportTicket[]).reverse();
}
/** まだ読んでいない返信の数（右下のボタンに印を出す） */
export function supportUnread(userId: number): number {
  return (getDb().prepare("SELECT COUNT(*) n FROM support_tickets WHERE user_id=? AND reply<>'' AND seen_at IS NULL").get(userId) as { n: number }).n;
}
export function markSupportSeen(userId: number): void {
  getDb().prepare("UPDATE support_tickets SET seen_at=datetime('now') WHERE user_id=? AND reply<>'' AND seen_at IS NULL").run(userId);
}

// ---- 問い合わせ（質問箱の1回ぶんのやり取り）。終了したものも、一覧から見返せる ----
export type ChatMessage = { r: string; t?: string; [k: string]: unknown };
export type HelpChat = { id: number; user_id: number; title: string; last: string; messages: string; started_at: string; updated_at: string; ended_at: string | null };

/** 画面のやり取りを保存する。id が 0 なら新しい問い合わせを作る。戻り値は問い合わせの id */
export function saveChat(userId: number, id: number, title: string, last: string, messages: ChatMessage[], ended: boolean): number {
  const db = getDb();
  if (id) {
    const own = db.prepare("SELECT id FROM help_chats WHERE id=? AND user_id=?").get(id, userId);
    if (own) {
      // 画面は、開いたときに読んだやり取りを持ったまま、そこに足して丸ごと保存し直す。開いている間に担当者の返信が
      // 届くと（サーバーが書き足す）、画面の古い控えで上書きして返信が消えていた。届いている返信は必ず残す
      const json = JSON.stringify(mergeStaffReplies(id, messages).list.slice(-200)).slice(0, 200_000);
      db.prepare("UPDATE help_chats SET title=?, last=?, messages=?, updated_at=datetime('now'), ended_at=CASE WHEN ? THEN COALESCE(ended_at, datetime('now')) ELSE ended_at END WHERE id=?")
        .run(title.slice(0, 60), last.slice(0, 120), json, ended ? 1 : 0, id);
      return id;
    }
  }
  const json = JSON.stringify(messages.slice(-200)).slice(0, 200_000);
  const nid = db.prepare("INSERT INTO help_chats(user_id, title, last, messages, ended_at) VALUES(?,?,?,?,CASE WHEN ? THEN datetime('now') ELSE NULL END)")
    .run(userId, title.slice(0, 60), last.slice(0, 120), json, ended ? 1 : 0).lastInsertRowid as number;
  // 古いものは100件まで残す
  db.prepare("DELETE FROM help_chats WHERE user_id=? AND id NOT IN (SELECT id FROM help_chats WHERE user_id=? ORDER BY id DESC LIMIT 100)").run(userId, userId);
  return nid;
}
/** この問い合わせに届いている担当者の返信のうち、やり取りに入っていないものを差し込む。
 *  差し込む場所は、その質問のあとの「受付済み・返信待ち」の直後（見つからなければ最後） */
export function mergeStaffReplies(chatId: number, messages: ChatMessage[]): { list: ChatMessage[]; added: number } {
  const tickets = getDb().prepare("SELECT id, question, reply FROM support_tickets WHERE chat_id=? AND reply<>'' ORDER BY id").all(chatId) as { id: number; question: string; reply: string }[];
  const list = messages.slice();
  let added = 0;
  for (const tk of tickets) {
    const has = list.some((m) => m.r === "staff" && (m.tk === tk.id || String(m.t ?? "").trim() === tk.reply.trim()));
    if (has) continue;
    let at = list.length;
    let q = -1;
    for (let i = list.length - 1; i >= 0; i--) if (list[i].r === "me" && String(list[i].t ?? "").trim() === tk.question.trim()) { q = i; break; }
    if (q >= 0) {
      at = q + 1;
      for (let i = q + 1; i < Math.min(list.length, q + 5); i++) { if (list[i].r === "me") break; at = i + 1; if (list[i].r === "st") break; }
    }
    list.splice(at, 0, { r: "staff", t: tk.reply, tk: tk.id });
    added++;
  }
  return { list, added };
}
export function appendChatMessage(chatId: number, m: ChatMessage): void {
  const db = getDb();
  const c = db.prepare("SELECT messages FROM help_chats WHERE id=?").get(chatId) as { messages: string } | undefined;
  if (!c) return;
  let list: ChatMessage[] = [];
  try { list = JSON.parse(c.messages) as ChatMessage[]; } catch { /* 壊れていたら作り直す */ }
  list.push(m);
  db.prepare("UPDATE help_chats SET messages=?, last=?, updated_at=datetime('now') WHERE id=?").run(JSON.stringify(list.slice(-200)), String(m.t ?? "").replace(/\s+/g, " ").slice(0, 120), chatId);
}
/** 問い合わせの一覧（新しい順）。unread＝まだ読んでいない担当者の返信がある */
export function listChats(userId: number): { id: number; title: string; last: string; updated_at: string; ended: boolean; staff: boolean; unread: boolean }[] {
  const rows = getDb().prepare(`SELECT c.id, c.title, c.last, c.updated_at, c.ended_at,
      (SELECT COUNT(*) FROM support_tickets t WHERE t.chat_id=c.id) staff,
      (SELECT COUNT(*) FROM support_tickets t WHERE t.chat_id=c.id AND t.reply<>'' AND t.seen_at IS NULL) unread
    FROM help_chats c WHERE c.user_id=? AND c.messages<>'[]' ORDER BY c.updated_at DESC, c.id DESC LIMIT 40`).all(userId) as { id: number; title: string; last: string; updated_at: string; ended_at: string | null; staff: number; unread: number }[];
  return rows.map((r) => ({ id: r.id, title: r.title, last: r.last, updated_at: r.updated_at, ended: !!r.ended_at, staff: r.staff > 0, unread: r.unread > 0 }));
}
/** 問い合わせ1件の中身。開いたら、その中の返信は読んだことにする */
export function getChat(userId: number, id: number): { id: number; title: string; ended: boolean; messages: ChatMessage[]; replyTicketId: number } | null {
  const db = getDb();
  const c = db.prepare("SELECT * FROM help_chats WHERE id=? AND user_id=?").get(id, userId) as HelpChat | undefined;
  if (!c) return null;
  db.prepare("UPDATE support_tickets SET seen_at=datetime('now') WHERE chat_id=? AND user_id=? AND reply<>'' AND seen_at IS NULL").run(id, userId);
  let messages: ChatMessage[] = [];
  try { messages = JSON.parse(c.messages) as ChatMessage[]; } catch { /* 空として返す */ }
  const merged = mergeStaffReplies(id, messages);
  if (merged.added) {
    messages = merged.list;
    db.prepare("UPDATE help_chats SET messages=? WHERE id=?").run(JSON.stringify(messages.slice(-200)).slice(0, 200_000), id);
  }
  const t = db.prepare("SELECT id FROM support_tickets WHERE chat_id=? AND user_id=? AND reply<>'' ORDER BY id DESC LIMIT 1").get(id, userId) as { id: number } | undefined;
  return { id: c.id, title: c.title, ended: !!c.ended_at, messages, replyTicketId: t?.id ?? 0 };
}
/** 終了していない、いちばん新しい問い合わせ（ページを移っても続きから話せるように） */
export function activeChatId(userId: number): number {
  const c = getDb().prepare("SELECT id FROM help_chats WHERE user_id=? AND ended_at IS NULL AND updated_at > datetime('now','-1 day') ORDER BY id DESC LIMIT 1").get(userId) as { id: number } | undefined;
  return c?.id ?? 0;
}

// ---- 質問箱の使われ方（この端末の中だけ。配布元には送らない） ----
/** 答えで解決したか。どの答えが役に立っていないかを、診断ファイルから知るため */
export function recordHelpFeedback(question: string, solved: boolean): void {
  const db = getDb();
  db.prepare("INSERT INTO help_feedback(question, solved) VALUES(?,?)").run(question.slice(0, 120), solved ? 1 : 0);
  db.prepare("DELETE FROM help_feedback WHERE id <= (SELECT MAX(id) FROM help_feedback) - 500").run();
}
/** 用意した答えの中に見つからなかった言葉。どの答えを足せばよいかを知るため（直近200件） */
export function recordHelpMiss(text: string): void {
  const db = getDb();
  db.prepare("INSERT INTO help_misses(text) VALUES(?)").run(text.replace(/\s+/g, " ").trim().slice(0, 80));
  db.prepare("DELETE FROM help_misses WHERE id <= (SELECT MAX(id) FROM help_misses) - 200").run();
}
export function topHelpMisses(limit = 20): { text: string; n: number; last: string }[] {
  return getDb().prepare("SELECT text, COUNT(*) n, MAX(at) last FROM help_misses GROUP BY text ORDER BY n DESC, last DESC LIMIT ?").all(limit) as { text: string; n: number; last: string }[];
}
export function unsolvedHelp(limit = 10): { question: string; n: number }[] {
  return getDb().prepare("SELECT question, COUNT(*) n FROM help_feedback WHERE solved=0 GROUP BY question ORDER BY n DESC LIMIT ?").all(limit) as { question: string; n: number }[];
}

// 配布元がスプレッドシートに貼る Apps Script は scripts/support-apps-script.gs にある（手順は CLAUDE.md の「質問箱」）
