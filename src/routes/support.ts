// 質問箱から配布元（担当者）への質問と、その返信
import express from "express";
import { app, me, ownedJob, ownedCampaign } from "../app/context.js";
import { getDb, jst, STATUS_LABEL, type Job, type JobStatus } from "../db.js";
import { askSupport, supportEnabled, supportNote, supportThread, supportUnread, markSupportSeen, pollSupportReplies, recordHelpFeedback, recordHelpMiss, saveChat, listChats, getChat, activeChatId, type ChatMessage } from "../support.js";
import { errKind, CAMPAIGN_STATUS_LABEL } from "../ui/parts.js";

let lastPoll = 0;

/** その会社が何で止まっているかを、質問箱の答えを選ぶための短い印にする */
function helpKey(j: Pick<Job, "status" | "result_text">): string {
  const t = j.result_text || "";
  if (j.status === "skip_captcha") return "captcha";
  if (j.status === "skip_no_form") return "noform";
  if (j.status !== "failed") return "";
  if (/^要確認/.test(t)) return "check";
  if (/送信後の判定不能|送信済みか不明/.test(t)) return "unsure";
  if (/^サイト側で受け付けられません|エラー文言/.test(t)) return "blocked";
  if (/送信ボタンが見つからない|確認画面を抜けられない|本文欄への入力に失敗|本文（textarea）/.test(t)) return "form";
  if (/入力エラー|未入力|入力してください|必須項目|送信ボタンが有効になりません/.test(t)) return "input";
  if (/timeout|タイムアウト|時間切れ|net::|ECONN|ERR_|getaddrinfo|dns|通信/i.test(t)) return "network";
  return "";
}

/** 質問に添える「その1社の状況」。会社名・URL・状態・失敗の種類だけ（営業リスト・文面・送信者の個人情報・スクリーンショットは入れない） */
function jobContext(req: express.Request, id: number) {
  const j = ownedJob(req, id);
  if (!j) return null;
  const c = ownedCampaign(req, j.campaign_id);
  const kind = errKind(j);
  const score = (j as Job & { scan_score?: number }).scan_score ?? -1;
  const rows: [string, string][] = [
    ["キャンペーン", c?.name ?? ""],
    ["会社名", j.company_name],
    ["会社URL", j.site_url || j.form_url || (j.domain ? `https://${j.domain}/` : "")],
    ["状態", STATUS_LABEL[j.status as JobStatus] ?? j.status],
    ["失敗の種類", kind],
    ["結果", (j.result_text || "").split("\n")[0].slice(0, 80)],
    ["送れそう度", score >= 0 ? String(score) : ""],
    ["試した回数", j.attempts ? `${j.attempts}回` : ""],
    ["最後に試した日時", j.updated_at ? jst(j.updated_at) : ""],
  ];
  const shown = rows.filter(([, v]) => v);
  return { jobId: j.id, company: j.company_name, status: STATUS_LABEL[j.status as JobStatus] ?? j.status, kind, key: helpKey(j), rows: shown, text: shown.map(([k, v]) => `${k}: ${v}`).join(" / ") };
}
function campaignContext(req: express.Request, id: number) {
  const c = ownedCampaign(req, id);
  if (!c) return null;
  const n = (st: string) => (getDb().prepare("SELECT COUNT(*) n FROM form_jobs WHERE campaign_id=? AND is_test=0 AND status=?").get(id, st) as { n: number }).n;
  const rows: [string, string][] = [
    ["キャンペーン", c.name],
    ["状態", CAMPAIGN_STATUS_LABEL[c.status] ?? c.status],
    ["送信済み", `${n("sent")}社`], ["待機", `${n("queued")}社`], ["失敗", `${n("failed")}社`],
  ];
  return { campaignId: c.id, company: c.name, status: CAMPAIGN_STATUS_LABEL[c.status] ?? c.status, kind: "", key: "", rows, text: rows.map(([k, v]) => `${k}: ${v}`).join(" / ") };
}

/** この画面の経路を登録する。server.ts から、ログイン確認などの共通処理のあとに呼ばれる */
export function register(): void {
// チャットを開いたときに、これまでのやり取りを返す。開いたついでに返信も見に行く（1分に1回まで）
app.get("/support/thread", async (req, res) => {
  res.setHeader("cache-control", "no-store");
  const u = me(req);
  // local=1 は「手元の記録だけ見る」（閉じているときの赤い印の確認用。配布元のシートを見に行く回数を増やさない）
  if (req.query.local !== "1" && supportEnabled() && Date.now() - lastPoll > 60_000) { lastPoll = Date.now(); await pollSupportReplies().catch(() => 0); }
  const list = supportThread(u.id).map((t) => ({ id: t.id, chatId: t.chat_id ?? 0, question: t.question, at: t.created_at, sent: !!t.sent_ok, reply: t.reply, repliedAt: t.replied_at, context: t.context, followUp: !!t.parent }));
  const unread = supportUnread(u.id);
  if (req.query.seen === "1") markSupportSeen(u.id);
  res.json({ enabled: supportEnabled(), note: supportNote(), unread, list, activeChat: activeChatId(u.id) });
});

// 「この会社について質問する」: その1社（またはキャンペーン）の状況を返す。他の人のものは見せない
app.get("/support/context", (req, res) => {
  res.setHeader("cache-control", "no-store");
  const ctx = req.query.job ? jobContext(req, Number(req.query.job)) : req.query.campaign ? campaignContext(req, Number(req.query.campaign)) : null;
  if (!ctx) return res.status(404).json({ ok: false });
  res.json({ ok: true, ...ctx });
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
  // 状況は、画面から受け取った文字ではなく、番号からこちらで作り直す（余計な内容が混ざらないように・他の人の会社を指定できないように）
  const ctx = req.body?.jobId ? jobContext(req, Number(req.body.jobId)) : req.body?.campaignId ? campaignContext(req, Number(req.body.campaignId)) : null;
  // 誰からの質問か分かるように、会社名（送信者の1件目）と表示名を添える
  const s = getDb().prepare("SELECT company FROM sender_profiles ORDER BY id LIMIT 1").get() as { company: string } | undefined;
  const who = [s?.company, u.display_name || u.username].filter(Boolean).join(" / ");
  const r = await askSupport(u.id, who, question, String(req.body?.page ?? ""), ctx?.text ?? "", Number(req.body?.parentId) || 0, Number(req.body?.chatId) || 0);
  res.json({ ok: true, sent: r.ok });
});

// 問い合わせ（1回ぶんのやり取り）の保存・一覧・中身。この端末の中だけに残る
app.post("/support/chats/save", express.json({ limit: "300kb" }), (req, res) => {
  const u = me(req);
  const msgs = Array.isArray(req.body?.messages) ? (req.body.messages as ChatMessage[]) : [];
  const id = saveChat(u.id, Number(req.body?.id) || 0, String(req.body?.title ?? ""), String(req.body?.last ?? ""), msgs, req.body?.ended === true);
  res.json({ ok: true, id });
});
app.get("/support/chats", (req, res) => {
  res.setHeader("cache-control", "no-store");
  res.json({ ok: true, list: listChats(me(req).id) });
});
app.get("/support/chats/:id", (req, res) => {
  res.setHeader("cache-control", "no-store");
  const c = getChat(me(req).id, Number(req.params.id));
  if (!c) return res.status(404).json({ ok: false });
  res.json({ ok: true, ...c });
});

// 答えで解決したか／見つからなかった言葉。この端末の中だけに残す（配布元には送らない）
app.post("/support/feedback", express.json({ limit: "4kb" }), (req, res) => {
  const q = String(req.body?.question ?? "").trim();
  if (q) recordHelpFeedback(q, req.body?.solved === true);
  res.json({ ok: true });
});
app.post("/support/miss", express.json({ limit: "4kb" }), (req, res) => {
  const t = String(req.body?.text ?? "").trim();
  if (t.length >= 2) recordHelpMiss(t);
  res.json({ ok: true });
});
}
