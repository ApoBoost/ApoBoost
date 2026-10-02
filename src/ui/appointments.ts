// アポだけを並べる画面。返信の一覧や送信一覧に混ざっていると、大事なアポを見落とすため
import { OUTCOME_LABEL, jst } from "../db.js";
import { esc, n } from "./layout.js";

export type AppoRow = {
  id: number; company_name: string; domain: string; email: string; channel: string;
  outcome: string; outcome_note: string; updated_at: string; sent_at: string | null; appo_seen_at?: string | null;
  campaign_id: number; campaign_name: string; mailbox: string;
};

/** 自動判定のメモから「相手の言葉」だけを取り出す */
const saidOf = (note: string) => (note.match(/本文「…?([\s\S]*?)…?」/)?.[1] ?? note).replace(/\s+/g, " ").trim();
const subjectOf = (note: string) => note.match(/件名「([^」]*)」/)?.[1] ?? "";

/** その会社とのやり取りを Gmail で開くリンク（送信に使ったアカウントで、相手のドメインから届いたメールを検索） */
function gmailLink(r: AppoRow): string {
  const q = r.domain ? `from:(@${r.domain})` : r.email ? `from:(${r.email})` : r.company_name;
  return `https://mail.google.com/mail/?authuser=${encodeURIComponent(r.mailbox)}#search/${encodeURIComponent(q)}`;
}

export function appointmentsView(appos: AppoRow[], replies: AppoRow[], campaigns: { id: number; name: string }[], campaignId: number): string {
  const card = (r: AppoRow, isAppo: boolean) => `<div class="card" style="${isAppo ? `border-left:4px solid ${r.appo_seen_at ? "var(--c-line-strong)" : "var(--c-ok)"}` : ""};margin-bottom:12px">
  <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:flex-start">
    <div style="min-width:0">
      <h2 style="margin:0 0 2px"><a href="/jobs/${r.id}" style="color:inherit">${esc(r.company_name)}</a> <span class="tag ${isAppo ? "sent" : "sending"}">${esc(OUTCOME_LABEL[r.outcome] ?? r.outcome)}</span></h2>
      <div class="muted" data-nohelp>${esc(r.email || r.domain)}・${esc(r.campaign_name)}・${r.channel === "email" ? "メールで送信" : "フォームで送信"}</div>
    </div>
    <div class="small muted" data-nohelp style="text-align:right">返信 ${esc(jst(r.updated_at))}${r.sent_at ? `<br>送信 ${esc(jst(r.sent_at))}` : ""}</div>
  </div>
  ${subjectOf(r.outcome_note) ? `<div class="small" style="margin-top:8px"><b>件名:</b> ${esc(subjectOf(r.outcome_note))}</div>` : ""}
  <blockquote style="margin:8px 0 0;padding:8px 12px;background:var(--c-surface-2);border-left:3px solid var(--c-line-strong);border-radius:6px">${esc(saidOf(r.outcome_note)) || '<span class="muted">（メモなし）</span>'}</blockquote>
  <p style="margin:10px 0 0;display:flex;gap:6px;flex-wrap:wrap">
    ${isAppo && !r.appo_seen_at ? `<form method="post" action="/jobs/${r.id}/appo-seen" class="inline"><button class="btn small primary">確認した</button></form>` : ""}
    <a class="btn small" href="${gmailLink(r)}" target="_blank" rel="noopener">Gmailで返信を開く ↗</a>
    <a class="btn small" href="/jobs/${r.id}">詳細・メモ</a>
    ${isAppo && r.appo_seen_at ? `<form method="post" action="/jobs/${r.id}/appo-seen" class="inline"><input type="hidden" name="seen" value="0"><button class="btn small">未確認に戻す</button></form>` : ""}
    ${isAppo ? "" : `<form method="post" action="/jobs/${r.id}/outcome" class="inline"><input type="hidden" name="outcome" value="appointment"><input type="hidden" name="note" value="${esc(r.outcome_note)}"><input type="hidden" name="back" value="/appointments"><button class="btn small">アポにする</button></form>`}
  </p>
</div>`;
  const fresh = appos.filter((r) => !r.appo_seen_at);
  const seen = appos.filter((r) => r.appo_seen_at);
  return `<h1 style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">アポ <span class="muted" data-nohelp style="font-size:var(--fs-base);font-weight:400">未確認 ${n(fresh.length)}社／全部で ${n(appos.length)}社</span></h1>
<form method="get" action="/appointments" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 14px">
<label class="inline small" style="margin:0">キャンペーン: <select name="campaign" onchange="this.form.submit()" style="width:auto"><option value="">すべて</option>${campaigns.map((c) => `<option value="${c.id}" ${c.id === campaignId ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>
</form>
<p class="muted" data-nohelp>受信箱を15分ごとに読み、日程やお打ち合わせの話が出た返信を「アポ」にしています。中身を見たら「確認した」を押すと、上のメニューの数字が減ります。</p>
${!appos.length ? `<div class="card"><p>まだアポはありません。</p></div>` : fresh.length ? fresh.map((r) => card(r, true)).join("") : `<div class="card"><p>未確認のアポはありません。</p></div>`}
${seen.length ? `<h2 style="margin-top:26px">確認済み（${n(seen.length)}社）</h2>${seen.map((r) => card(r, true)).join("")}` : ""}
${replies.length ? `<h2 style="margin-top:26px">アポかもしれない返信（${n(replies.length)}件）</h2>
<p class="muted" data-nohelp>「返信あり」と判定した中に、アポにつながるものが混ざっていることがあります。中身を見て、アポなら「アポにする」を押してください（次から同じ言い回しはアポに振り分けます）。</p>
${replies.map((r) => card(r, false)).join("")}` : ""}`;
}
