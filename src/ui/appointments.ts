// アポだけを並べる画面。返信の一覧や送信一覧に混ざっていると、大事なアポを見落とすため
import { OUTCOME_LABEL, jst } from "../db.js";
import { esc, n } from "./layout.js";

export type AppoRow = {
  id: number; company_name: string; domain: string; email: string; channel: string;
  outcome: string; outcome_note: string; updated_at: string; sent_at: string | null; appo_seen_at?: string | null;
  campaign_id: number; campaign_name: string; mailbox: string; site_url?: string;
};

/** 自動判定のメモから「相手の言葉」だけを取り出す */
const saidOf = (note: string) => (note.match(/本文「…?([\s\S]*?)…?」/)?.[1] ?? note).replace(/\s+/g, " ").trim();
const subjectOf = (note: string) => note.match(/件名「([^」]*)」/)?.[1] ?? "";

// ---- 担当者に渡す（LINE用） ----
// アポの対応（日程調整・料金の案内など）を別の人に任せるとき、LINE にそのまま貼れる文章を案件ごとに作る。
// 返信の言葉から「次にやってほしいこと」を拾う。拾えなければ、まずお礼と日程の候補を返す、にする
const NEXT_ACTIONS: [RegExp, string][] = [
  [/日程|候補|打ち?合わ?せ|面談|ミーティング|オンライン|zoom|teams|meet|お時間|ご都合|伺|来社|訪問|商談/i, "日程調整：こちらから候補の日時を3つほど出して返信してください"],
  [/単価|料金|費用|価格|見積|金額|いくら|予算|コスト|プラン/, "単価・料金のご案内：料金表かお見積りを送ってください"],
  [/資料|パンフ|カタログ|詳細|詳しく|概要|サービス内容/, "資料の送付：サービスの資料を送ってください"],
  [/実績|事例|導入例/, "実績のご紹介：近い業種の導入事例を添えてください"],
  [/電話|お電話|TEL|架電/i, "電話での連絡：先方にお電話してください（番号は返信の署名を確認）"],
  [/担当|部署|窓口|転送|おつなぎ/, "担当者の確認：担当の方・部署を確かめて、改めてご連絡してください"],
];
export function handoffActions(said: string): string[] {
  const hits = NEXT_ACTIONS.filter(([re]) => re.test(said)).map(([, t]) => t);
  return hits.length ? hits : ["返信内容を確認して、お礼と次のご提案（日程の候補など）を返信してください"];
}
const WD = ["日", "月", "火", "水", "木", "金", "土"];
/** 日時（UTC の "YYYY-MM-DD HH:MM:SS"）を日本時間の「10/6（月）14:05」にする */
function jpDay(utc: string, withTime = true): string {
  const d = new Date(String(utc).replace(" ", "T") + "Z");
  if (isNaN(d.getTime())) return "";
  const j = new Date(d.getTime() + 9 * 3600_000);
  const md = `${j.getUTCMonth() + 1}/${j.getUTCDate()}（${WD[j.getUTCDay()]}）`;
  return withTime ? `${md}${String(j.getUTCHours()).padStart(2, "0")}:${String(j.getUTCMinutes()).padStart(2, "0")}` : md;
}
/** 期限の目安: 返信が来た日の次の平日（返事は早いほどアポにつながるため） */
function dueOf(utc: string): string {
  const d = new Date(String(utc).replace(" ", "T") + "Z");
  if (isNaN(d.getTime())) return "";
  let j = new Date(d.getTime() + 9 * 3600_000);
  do { j = new Date(j.getTime() + 86400_000); } while (j.getUTCDay() === 0 || j.getUTCDay() === 6);
  return `${j.getUTCMonth() + 1}/${j.getUTCDate()}（${WD[j.getUTCDay()]}）中`;
}
/** LINE にそのまま貼る文章（記号は LINE で崩れないものだけ） */
export function handoffText(r: AppoRow, name: string): string {
  const said = saidOf(r.outcome_note), subject = subjectOf(r.outcome_note);
  const who = name.trim() ? `${name.trim()}さん` : "";
  const lines = [
    ...(who ? [who] : []),
    r.outcome === "appointment" ? "アポの対応をお願いします。" : "前向きな返信の対応をお願いします。",
    "",
    `■ 会社：${r.company_name}`,
    `■ 返信日：${jpDay(r.updated_at)}`,
    ...(r.email ? [`■ 連絡先：${r.email}`] : []),
    ...(r.site_url || r.domain ? [`■ HP：${r.site_url || `https://${r.domain}/`}`] : []),
    `■ 送った方法：${r.channel === "email" ? "メール" : "問い合わせフォーム"}（${r.campaign_name}）`,
    "",
    "■ 先方の返信",
    ...(subject ? [`件名：${subject}`] : []),
    `「${said.length > 200 ? said.slice(0, 200) + "…" : said}」`,
    "",
    "■ 次にやってほしいこと",
    ...handoffActions(`${subject} ${said}`).map((t, i) => `${i + 1}. ${t}`),
    "",
    `■ 期限：${dueOf(r.updated_at)}`,
    ...(r.mailbox ? [`■ 元のメール：${r.mailbox} の受信箱にあります`] : []),
  ];
  return lines.join("\n");
}

/** その会社とのやり取りを Gmail で開くリンク（送信に使ったアカウントで、相手のドメインから届いたメールを検索） */
function gmailLink(r: AppoRow): string {
  const q = r.domain ? `from:(@${r.domain})` : r.email ? `from:(${r.email})` : r.company_name;
  return `https://mail.google.com/mail/?authuser=${encodeURIComponent(r.mailbox)}#search/${encodeURIComponent(q)}`;
}

export function appointmentsView(appos: AppoRow[], replies: AppoRow[], campaigns: { id: number; name: string }[], campaignId: number, handoffName = ""): string {
  const toWho = handoffName.trim() ? `${handoffName.trim()}さん` : "担当者";
  // 渡す文章は、開いて直してからコピー・LINE で送れる（言い回しを足したいことがあるため）
  const handoff = (r: AppoRow) => {
    const text = handoffText(r, handoffName);
    return `<details class="handoff" style="margin-top:10px"><summary class="small" style="cursor:pointer;font-weight:600">${esc(toWho)}に渡す（LINE用の文章）</summary>
<textarea id="ho-${r.id}" rows="14" style="margin-top:8px;font-size:13px;line-height:1.6">${esc(text)}</textarea>
<p style="margin:6px 0 0;display:flex;gap:6px;flex-wrap:wrap;align-items:center"><button type="button" class="btn small" data-copy="ho-${r.id}">コピー</button><button type="button" class="btn small" data-line="ho-${r.id}">LINEで送る ↗</button><span class="small muted" data-copied="ho-${r.id}" hidden>コピーしました。LINE に貼り付けてください</span></p>
</details>`;
  };
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
  ${handoff(r)}
</div>`;
  const fresh = appos.filter((r) => !r.appo_seen_at);
  const seen = appos.filter((r) => r.appo_seen_at);
  return `<h1 style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">アポ <span class="muted" data-nohelp style="font-size:var(--fs-base);font-weight:400">未確認 ${n(fresh.length)}社／全部で ${n(appos.length)}社</span></h1>
<form method="get" action="/appointments" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 14px">
<label class="inline small" style="margin:0">キャンペーン: <select name="campaign" onchange="this.form.submit()" style="width:auto"><option value="">すべて</option>${campaigns.map((c) => `<option value="${c.id}" ${c.id === campaignId ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>
</form>
<form method="post" action="/appointments/handoff-name" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 14px">
<label class="inline small" style="margin:0">アポを渡す相手: <input name="name" value="${esc(handoffName)}" placeholder="例: 松田" maxlength="20" style="width:9em"> さん</label>
<button class="btn small">保存</button><span class="small muted">各アポの「${esc(toWho)}に渡す」から、LINE 用の文章をコピーできます</span>
</form>
<script>
// コピーと LINE で送る。コピーはクリップボードが使えないときに、選んでコピーにする（古いブラウザ・http でも動くように）
document.addEventListener("click", function (e) {
  var b = e.target.closest && e.target.closest("[data-copy],[data-line]");
  if (!b) return;
  var id = b.getAttribute("data-copy") || b.getAttribute("data-line"), t = document.getElementById(id);
  if (!t) return;
  if (b.hasAttribute("data-line")) { window.open("https://line.me/R/share?text=" + encodeURIComponent(t.value), "_blank", "noopener"); return; }
  var done = function () { var m = document.querySelector('[data-copied="' + id + '"]'); if (m) { m.hidden = false; setTimeout(function () { m.hidden = true; }, 2500); } };
  if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(t.value).then(done, function () { t.select(); document.execCommand("copy"); done(); });
  else { t.select(); document.execCommand("copy"); done(); }
});
</script>
<p class="muted" data-nohelp>受信箱を15分ごとに読み、日程やお打ち合わせの話が出た返信を「アポ」にしています。中身を見たら「確認した」を押すと、上のメニューの数字が減ります。</p>
${!appos.length ? `<div class="card"><p>まだアポはありません。</p></div>` : fresh.length ? fresh.map((r) => card(r, true)).join("") : `<div class="card"><p>未確認のアポはありません。</p></div>`}
${seen.length ? `<h2 style="margin-top:26px">確認済み（${n(seen.length)}社）</h2>${seen.map((r) => card(r, true)).join("")}` : ""}
${replies.length ? `<h2 style="margin-top:26px">アポかもしれない返信（${n(replies.length)}件）</h2>
<p class="muted" data-nohelp>「返信あり」と判定した中に、アポにつながるものが混ざっていることがあります。中身を見て、アポなら「アポにする」を押してください（次から同じ言い回しはアポに振り分けます）。</p>
${replies.map((r) => card(r, false)).join("")}` : ""}`;
}
