// 質問箱から配布元（担当者）への質問と、その返信
import express from "express";
import { app, me } from "../app/context.js";
import { getDb } from "../db.js";
import { askSupport, supportEnabled, supportThread, supportUnread, markSupportSeen, pollSupportReplies } from "../support.js";

let lastPoll = 0;

/** この画面の経路を登録する。server.ts から、ログイン確認などの共通処理のあとに呼ばれる */
export function register(): void {
// チャットを開いたときに、これまでのやり取りを返す。開いたついでに返信も見に行く（1分に1回まで）
app.get("/support/thread", async (req, res) => {
  res.setHeader("cache-control", "no-store");
  const u = me(req);
  if (supportEnabled() && Date.now() - lastPoll > 60_000) { lastPoll = Date.now(); await pollSupportReplies().catch(() => 0); }
  const list = supportThread(u.id).map((t) => ({ question: t.question, at: t.created_at, sent: !!t.sent_ok, reply: t.reply, repliedAt: t.replied_at }));
  const unread = supportUnread(u.id);
  if (req.query.seen === "1") markSupportSeen(u.id);
  res.json({ enabled: supportEnabled(), unread, list });
});

// 担当者に質問を送る
app.post("/support/ask", express.json({ limit: "20kb" }), async (req, res) => {
  const u = me(req);
  const question = String(req.body?.question ?? "").trim();
  if (!supportEnabled()) return res.status(400).json({ ok: false, error: "この版では、担当者への質問は受け付けていません" });
  if (question.length < 5) return res.status(400).json({ ok: false, error: "もう少しくわしく書いてください" });
  // 送りすぎを防ぐ（1時間に10件まで）
  const recent = (getDb().prepare("SELECT COUNT(*) n FROM support_tickets WHERE user_id=? AND created_at > datetime('now','-1 hour')").get(u.id) as { n: number }).n;
  if (recent >= 10) return res.status(429).json({ ok: false, error: "短い時間に多く送られています。少し時間を置いてからお試しください" });
  // 誰からの質問か分かるように、会社名（送信者の1件目）と表示名を添える
  const s = getDb().prepare("SELECT company FROM sender_profiles ORDER BY id LIMIT 1").get() as { company: string } | undefined;
  const who = [s?.company, u.display_name || u.username].filter(Boolean).join(" / ");
  const r = await askSupport(u.id, who, question, String(req.body?.page ?? ""));
  res.json({ ok: true, sent: r.ok });
});
}
