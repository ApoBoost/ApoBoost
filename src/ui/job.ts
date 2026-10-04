// 会社1社の詳細
import { STATUS_LABEL, OUTCOME_LABEL, CHANNEL_LABEL, channelMode, jst, type Campaign, type Job, type SenderProfile, type JobStatus } from "../db.js";
import { AI_MODELS, type Lint } from "../message.js";
import { TEMPLATE_LIBRARY } from "../templates.js";
import { esc, layout, n, type NavUser, IC_MAIL, IC_FORM } from "./layout.js";
import { statusTag, errKind, post } from "./parts.js";

/** この会社とのやり取りの履歴（#56）。同じ会社に別のキャンペーンから送った分も時系列で見せる。
 *  対応漏れや二重送信に気づけるようにするためのもの */
export type JobHistory = { id: number; campaign_name: string; channel: string; status: string; result_text: string; sent_at: string | null; updated_at: string; outcome: string; outcome_note: string };

export function jobView(j: Job, c: Campaign, history: JobHistory[] = []) {
  const timeline = history.length <= 1 ? "" : `<div class="card"><h2 style="margin-top:0">この会社とのやり取り（${history.length}件）</h2>
<p class="muted small" style="margin:0 0 10px">同じ会社に、別のキャンペーンから送ったぶんも含めて、新しい順に並べています。</p>
<ul style="list-style:none;padding:0;margin:0;border-left:2px solid var(--hive-200)">
${history.map((h) => `<li style="padding:6px 0 10px 14px;position:relative">
  <span style="position:absolute;left:-7px;top:12px;width:10px;height:10px;border-radius:50%;background:${h.status === "sent" ? "var(--ok)" : h.status === "failed" ? "var(--ng)" : "var(--honey)"}"></span>
  <span class="small muted">${esc(jst(h.sent_at || h.updated_at))}</span> ${statusTag(h.status as JobStatus)} <span class="small">${h.channel === "email" ? IC_MAIL + " メール" : IC_FORM + " フォーム"}／${esc(h.campaign_name)}</span>
  ${h.id === j.id ? '<span class="tag">いま見ている記録</span>' : `<a class="small" href="/jobs/${h.id}">詳細</a>`}
  <div class="small muted">${esc((h.result_text || "").split("\n")[0].slice(0, 90))}</div>
  ${h.outcome ? `<div class="small"><b>反応: ${esc(OUTCOME_LABEL[h.outcome] ?? h.outcome)}</b> ${esc((h.outcome_note || "").slice(0, 80))}</div>` : ""}
</li>`).join("")}
</ul></div>`;
  return `<h1>${esc(j.company_name)} ${statusTag(j.status)}</h1>
<p><a href="/campaigns/${c.id}">← ${esc(c.name)}</a></p>
${timeline}
<div class="${j.screenshot_path ? "row" : ""}"><div class="card"><b>フォームURL:</b> <a href="${esc(j.form_url)}" target="_blank">${esc(j.form_url)}</a><br><b>企業URL:</b> ${esc(j.site_url)}<br><b>業種:</b> ${esc(j.industry)} / ${esc(j.sub_industry)}<br><b>試行:</b> ${j.attempts}回 <b>送信:</b> ${esc(jst(j.sent_at) || "-")}
<h2>結果・ログ ${errKind(j) ? `<span class="errkind">${esc(errKind(j))}</span>` : ""}</h2><pre>${esc(j.result_text)}</pre>
<form method="post" action="/jobs/${j.id}/retry" class="inline" data-busy><button class="btn sub" data-busytext="再試行中…">再試行</button></form>
<form method="post" action="/jobs/${j.id}/assist" class="inline" data-busy><button class="btn sub" data-busytext="ブラウザで入力中…" title="このパソコンにブラウザを開き、フォームを入力した状態で止めます（送信は押しません）">ブラウザで開いて自動入力（送信しない）</button></form>
${j.status !== "sent" ? `<form method="post" action="/jobs/${j.id}/mark-sent" class="inline" onsubmit="return confirm('この会社を「送信済み（手動）」にします。手動で送った分の消し込みに使ってください。よろしいですか？')"><button class="btn sub">手動で送信済みにする</button></form>` : ""}
${j.status === "failed" || j.status === "skip_no_form" || j.status === "skip_captcha" ? `
<div class="card" id="fix" style="margin-top:14px;background:var(--honey-50)"><h2 style="margin-top:0">修正して再送信</h2>
<p class="muted">フォームURLの間違い（別ページに正しいフォームがある等）を直して、その場で送り直せます。</p>
<form method="post" action="/jobs/${j.id}/fix" data-busy>
<div class="row"><div><label>フォームURL</label><input type="url" name="form_url" value="${esc(j.form_url)}"></div><div><label>企業URL</label><input type="url" name="site_url" value="${esc(j.site_url)}"></div></div>
<div class="row"><div><label>会社名</label><input type="text" name="company_name" value="${esc(j.company_name)}"></div><div><label>メール（メール送信に切り替える場合）</label><input type="email" name="email" value="${esc(j.email)}"></div></div>
<p><button class="btn primary">修正して再送信</button> <button class="btn sub" name="via" value="email" formnovalidate>メールで送信</button> <span class="muted small">「メールで送信」は、フォームをあきらめて上のメール宛てに送ります。送信には10〜30秒かかります</span></p></form></div>` : ""}
<form method="post" action="/suppressions" class="inline"><input type="hidden" name="domain" value="${esc(j.domain)}"><input type="hidden" name="reason" value="手動（${esc(j.company_name)}）"><button class="btn small" title="この会社には今後送りません（除外リストに入れます）">このドメインを除外リストに入れる</button></form>
${j.status === "sent" ? `<h2>反応を記録</h2><form method="post" action="/jobs/${j.id}/outcome"><p>${[["replied", "返信あり"], ["appointment", "アポ獲得"], ["declined", "断り・不要（今後送らない）"], ["", "取り消し"]].map(([k, l]) => `<button class="btn ${j.outcome === k && k ? "" : "sub"} small" name="outcome" value="${k}">${l}</button>`).join(" ")}</p><input type="text" name="note" value="${esc(j.outcome_note)}" placeholder="メモ（返信内容・次のアクション）"></form>` : ""}
<h2>送った文面</h2><pre>${esc(j.message_used)}</pre></div>
<div class="card"${j.screenshot_path ? "" : " hidden"}><h2 style="margin-top:0">スクリーンショット</h2>${j.screenshot_path ? `<img src="/screenshots/${esc(j.screenshot_path.split("/").pop())}" style="max-width:100%;border:1px solid #ddd;cursor:zoom-in" onclick="foZoom(this.src)" title="クリックで拡大">
<p class="muted small">画像をクリックすると大きく表示します。</p>
<div id="fozoom" hidden style="position:fixed;inset:0;background:rgba(0,0,0,.82);z-index:100;display:flex;align-items:center;justify-content:center;padding:20px;cursor:zoom-out" onclick="this.hidden=true"><img id="fozoomimg" style="max-width:100%;max-height:100%;box-shadow:0 10px 40px rgba(0,0,0,.5);background:#fff"></div>
<script>function foZoom(src){const b=document.getElementById("fozoom");document.getElementById("fozoomimg").src=src;b.hidden=false;}
addEventListener("keydown",(e)=>{if(e.key==="Escape"){const b=document.getElementById("fozoom");if(b)b.hidden=true;}});</script>` : '<p class="muted">なし</p>'}
${(() => {
    if (j.status === "sent") return "";
    let qs: { label: string; kind: string; multiple?: boolean; options?: string[] }[] = [];
    try { qs = JSON.parse(j.pending_questions || "[]"); } catch { qs = []; }
    if (!qs.length) return "";
    return `<div style="margin-top:14px;background:var(--honey-50);border:1px solid var(--honey);border-radius:10px;padding:12px">
<h2 style="margin-top:0">未回答の質問に答えて再送信</h2>
<p class="muted small">フォームにあった質問に自動で回答を決められませんでした。上のスクリーンショットを見ながら選ぶか記入してください。再送信時にこの回答をフォームへ入力します。</p>
<form method="post" action="/jobs/${j.id}/answer" data-busy>
${qs.slice(0, 30).map((q, i) => `<input type="hidden" name="q_label_${i}" value="${esc(q.label)}">
<label>${esc(q.label)}${q.multiple ? '<span class="muted small">（複数選べます）</span>' : ""}</label>
${q.kind === "choice" && q.options?.length
      ? `<div class="small" style="display:flex;flex-wrap:wrap;gap:4px 14px;margin:4px 0 10px">${q.options.map((o) => `<label class="inline" style="font-weight:400;display:inline-flex;align-items:center;gap:4px"><input type="${q.multiple ? "checkbox" : "radio"}" name="q_ans_${i}" value="${esc(o)}">${esc(o)}</label>`).join("")}</div>`
      : `<input type="text" name="q_ans_${i}" style="margin-bottom:10px" placeholder="回答を記入">`}`).join("")}
<p><button class="btn">回答して再送信</button> <span class="muted small">10〜30秒かかります</span></p></form></div>`;
  })()}</div></div>`;
}
