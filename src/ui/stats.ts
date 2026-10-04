// 成果（送信数・分析・週次レポート）
import { STATUS_LABEL, OUTCOME_LABEL, CHANNEL_LABEL, channelMode, jst, type Campaign, type Job, type SenderProfile, type JobStatus } from "../db.js";
import { AI_MODELS, type Lint } from "../message.js";
import { TEMPLATE_LIBRARY } from "../templates.js";
import { esc, layout, n, type NavUser, IC_MAIL, IC_FORM } from "./layout.js";

/** 送信数（日別・月別）。棒グラフはCSSだけで描く（ライブラリは増やさない） */
export function statsView(
  rows: { period: string; form: number; email: number; total: number }[],
  mode: "day" | "month",
  campaigns: { id: number; name: string }[],
  campaignId: number,
  totals: { total: number; form: number; email: number },
  analysis?: Analysis,
): string {
  const max = Math.max(1, ...rows.map((r) => r.total));
  const label = (p: string) => (mode === "month" ? p.replace("-", "/") : `${Number(p.slice(5, 7))}/${Number(p.slice(8, 10))}`);
  const weekday = (p: string) => (mode === "day" ? ["日", "月", "火", "水", "木", "金", "土"][new Date(`${p}T00:00:00+09:00`).getDay()] : "");
  const q = (m: string, c: number) => `/stats?mode=${m}${c ? `&campaign=${c}` : ""}`;
  return `<h1>成果</h1>
<h2 style="margin-top:0">送信数</h2>
<p class="muted">送信できた件数を、東京時間の日付で数えています（フォームとメールの合計）。</p>
<form method="get" action="/stats" class="inline" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:12px">
<label class="inline small">表示: <select name="mode" onchange="this.form.submit()" style="width:auto;padding:4px 8px"><option value="day" ${mode === "day" ? "selected" : ""}>日別（直近30日）</option><option value="month" ${mode === "month" ? "selected" : ""}>月別（直近12か月）</option></select></label>
<label class="inline small">キャンペーン: <select name="campaign" onchange="this.form.submit()" style="width:auto;padding:4px 8px"><option value="">すべて</option>${campaigns.map((c) => `<option value="${c.id}" ${campaignId === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>
<a class="btn sub small" href="${q(mode, campaignId)}">更新</a>
</form>
${(() => {
    // 直近7日と、その前の7日を比べる（日別表示のとき）
    let week = "";
    if (mode === "day" && rows.length) {
      const day = (back: number) => new Date(Date.now() + 9 * 3600_000 - back * 86400_000).toISOString().slice(0, 10);
      const sum = (from: number, to: number) => rows.filter((r) => r.period <= day(from) && r.period >= day(to)).reduce((a, r) => a + r.total, 0);
      const now7 = sum(0, 6), prev7 = sum(7, 13), diff = now7 - prev7;
      week = `<div class="stat">直近7日<b>${n(now7)}<span class="unit">件</span></b><span class="muted" data-nohelp>その前の7日 ${n(prev7)}件${prev7 || now7 ? `（${diff >= 0 ? "+" : "−"}${n(Math.abs(diff))}）` : ""}</span></div>`;
    }
    return `<div class="stats" style="margin-bottom:14px">${week}<div class="stat">この期間の合計<b>${n(totals.total ?? 0)}<span class="unit">件</span></b></div><div class="stat">フォーム<b>${n(totals.form ?? 0)}<span class="unit">件</span></b></div><div class="stat">メール<b>${n(totals.email ?? 0)}<span class="unit">件</span></b></div></div>`;
  })()}
${rows.length === 0 ? `<div class="card"><p class="muted">この条件では送信の記録がありません。</p></div>` : `<div class="card">
<div class="vbars" role="img" aria-label="${mode === "month" ? "月別" : "日別"}の送信数">${[...rows].sort((x, y) => (x.period < y.period ? -1 : 1)).map((r) => `<div class="col" data-tip="${esc(label(r.period))} フォーム${r.form}・メール${r.email}">${r.email ? `<i class="e" style="height:${Math.max(2, Math.round((r.email / max) * 150))}px"></i>` : ""}${r.form ? `<i class="f" style="height:${Math.max(2, Math.round((r.form / max) * 150))}px"></i>` : ""}</div>`).join("")}</div>
<div class="vlabels">${(() => { const sorted = [...rows].sort((x, y) => (x.period < y.period ? -1 : 1)); const step = Math.max(1, Math.ceil(sorted.length / 10)); return sorted.map((r, i) => `<span>${i % step === 0 ? esc(label(r.period)) : ""}</span>`).join(""); })()}</div>
<p class="muted small" data-nohelp style="margin:10px 0 0"><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:var(--c-brand);vertical-align:-1px"></span> フォーム　<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#8E8E93;vertical-align:-1px"></span> メール</p>
<details style="margin-top:10px"><summary class="muted small" style="cursor:pointer">${mode === "month" ? "月" : "日"}ごとの数字を見る</summary>
<table style="max-width:420px"><tr><th>${mode === "month" ? "月" : "日付"}</th><th style="width:70px">フォーム</th><th style="width:70px">メール</th><th style="width:70px">合計</th></tr>
${rows.map((r) => {
    return `<tr><td class="small">${esc(label(r.period))}${weekday(r.period) ? `<span class="muted">（${weekday(r.period)}）</span>` : ""}</td>
<td class="small">${n(r.form)}</td><td class="small">${n(r.email)}</td><td><b>${n(r.total)}</b></td></tr>`;
  }).join("")}
</table>
</details></div>`}${analysis ? analysisSection(analysis) : ""}
`;
}

// ---- 分析（#71 #72 #73 #75）----
// 「どのリストが当たりだったか」「何で失敗しているか」を、手で数えなくても分かるようにする。
export type Analysis = {
  byIndustry: { key: string; sent: number; replied: number; appo: number }[];
  byPref: { key: string; sent: number; replied: number; appo: number }[];
  byChannel: { channel: string; sent: number; failed: number; replied: number; appo: number }[];
  byHour: { hour: string; sent: number; replied: number }[];
  failures: { label: string; n: number; hint: string }[];
  totalTried: number;
};

export function rateTable(title: string, note: string, rows: { key: string; sent: number; replied: number; appo: number }[]): string {
  if (!rows.length) return "";
  const max = Math.max(1, ...rows.map((r) => r.sent));
  return `<div class="card"><h2 style="margin-top:0">${esc(title)}</h2>
<p class="muted small" style="margin:0 0 8px">${esc(note)}</p>
<table><tr><th>${esc(title.replace("別の反応", ""))}</th><th style="width:34%">送信数</th><th style="width:70px">返信+アポ</th><th style="width:60px">アポ</th><th style="width:70px">反応率</th></tr>
${rows.map((r) => `<tr><td>${esc(r.key || "（未設定）")}</td>
<td><div style="display:flex;align-items:center;gap:6px"><div style="flex:1;height:14px;background:#f1efe9;border-radius:3px;overflow:hidden;min-width:80px"><div style="width:${Math.round((r.sent / max) * 100)}%;height:100%;background:var(--honey)"></div></div><span class="small">${n(r.sent)}</span></div></td>
<td class="small">${r.replied}</td><td class="small"><b>${r.appo}</b></td>
<td class="small">${r.sent >= 10 ? `${((r.replied / r.sent) * 100).toFixed(1)}%` : `<span class="muted">—</span>`}</td></tr>`).join("")}
</table>
<p class="muted small" style="margin:8px 0 0">送信10件未満は、反応率が偶然に左右されるため「—」にしています。</p></div>`;
}

export function analysisSection(a: Analysis): string {
  return `
<h2 id="analysis" style="margin-top:28px">反応の分析</h2>
<p class="muted">送信済みの会社について、どこからの反応が多いかを集計しています。次に買うリスト・送る時間帯を決める材料にしてください。</p>

${a.byChannel.length ? `<div class="card"><h2 style="margin-top:0">フォームとメールの比較</h2>
<table><tr><th>送り方</th><th>送信</th><th>失敗・送れず</th><th>返信+アポ</th><th>アポ</th><th>反応率</th></tr>
${a.byChannel.map((r) => `<tr><td>${r.channel === "email" ? IC_MAIL + " メール" : IC_FORM + " フォーム"}</td><td>${n(r.sent)}</td><td>${n(r.failed)}</td><td>${n(r.replied)}</td><td><b>${r.appo}</b></td><td>${r.sent >= 10 ? `${((r.replied / r.sent) * 100).toFixed(1)}%` : "—"}</td></tr>`).join("")}
</table></div>` : ""}

${rateTable("業種別の反応", "送信数の多い順。反応率が高い業種に絞ると、同じ手間でアポが増えます。", a.byIndustry)}
${rateTable("都道府県別の反応", "地域によって反応が変わることがあります。", a.byPref)}

${a.byHour.length ? `<div class="card"><h2 style="margin-top:0">送信した時間帯と反応</h2>
<table><tr><th style="width:90px">時間帯</th><th>送信数</th><th style="width:90px">返信+アポ</th><th style="width:80px">反応率</th></tr>
${a.byHour.map((r) => `<tr><td>${esc(r.hour)}時台</td><td>${n(r.sent)}</td><td>${r.replied}</td><td class="small">${r.sent >= 10 ? `${((r.replied / r.sent) * 100).toFixed(1)}%` : "—"}</td></tr>`).join("")}
</table>
<p class="muted small" style="margin:8px 0 0">反応率が高い時間帯に送信時間帯（キャンペーンの設定）を寄せると、反応が増えることがあります。</p></div>` : ""}

${a.failures.length ? `<div class="card"><h2 style="margin-top:0">送れなかった理由（多い順）</h2>
<p class="muted small" style="margin:0 0 8px">全 ${a.totalTried.toLocaleString("ja-JP")}件のうち、送れなかったもの。上から順に手を打つと、送信数が増えます。</p>
<table><tr><th>理由</th><th style="width:80px">件数</th><th>打てる手</th></tr>
${a.failures.map((f) => `<tr><td>${esc(f.label)}</td><td><b>${n(f.n)}</b></td><td class="small">${f.hint}</td></tr>`).join("")}
</table></div>` : ""}

<p><a class="btn sub" href="/report">週次レポートを見る（印刷できます）</a></p>`;
}

// ---- 週次レポート（#74）----
export type WeeklyReport = {
  from: string; to: string;
  sentForm: number; sentEmail: number; replied: number; appo: number; declined: number;
  failed: number; captcha: number; noForm: number;
  prevSent: number;
  topIndustries: { key: string; sent: number; replied: number; appo: number }[];
  campaigns: { name: string; sent: number; replied: number; appo: number }[];
  appointments: { company: string; at: string; note: string }[];
};

export function reportView(r: WeeklyReport): string {
  const sent = r.sentForm + r.sentEmail;
  const diff = r.prevSent ? Math.round(((sent - r.prevSent) / r.prevSent) * 100) : 0;
  return `<h1>週次レポート</h1>
<p class="muted">${esc(r.from)} 〜 ${esc(r.to)}（東京時間）。この画面はそのまま印刷・PDF保存できます（ブラウザの印刷メニュー）。</p>
<div class="stats">
  <div class="stat"><span class="muted small">送信</span><b>${sent}</b><span class="muted small">フォーム${r.sentForm}・メール${r.sentEmail}</span></div>
  <div class="stat"><span class="muted small">前の週と比べて</span><b>${r.prevSent ? `${diff >= 0 ? "+" : ""}${diff}%` : "—"}</b><span class="muted small">前週 ${r.prevSent}件</span></div>
  <div class="stat"><span class="muted small">アポ</span><b>${r.appo}</b><span class="muted small">返信 ${r.replied}・断り ${r.declined}</span></div>
  <div class="stat"><span class="muted small">送れなかった</span><b>${r.failed + r.captcha + r.noForm}</b><span class="muted small">失敗${r.failed}・認証${r.captcha}・フォーム無${r.noForm}</span></div>
</div>
${r.appointments.length ? `<div class="card"><h2 style="margin-top:0">今週のアポ・前向きな返信</h2>
<table><tr><th>会社</th><th style="width:120px">日時</th><th>メモ</th></tr>
${r.appointments.map((a) => `<tr><td><b>${esc(a.company)}</b></td><td class="small">${esc(a.at)}</td><td class="small">${esc(a.note.slice(0, 120))}</td></tr>`).join("")}
</table></div>` : ""}
${r.campaigns.length ? `<div class="card"><h2 style="margin-top:0">キャンペーン別</h2>
<table><tr><th>キャンペーン</th><th style="width:80px">送信</th><th style="width:90px">返信+アポ</th><th style="width:70px">アポ</th></tr>
${r.campaigns.map((c) => `<tr><td>${esc(c.name)}</td><td>${c.sent}</td><td>${c.replied}</td><td><b>${c.appo}</b></td></tr>`).join("")}
</table></div>` : ""}
${r.topIndustries.length ? `<div class="card"><h2 style="margin-top:0">業種別（今週）</h2>
<table><tr><th>業種</th><th style="width:80px">送信</th><th style="width:90px">返信+アポ</th><th style="width:70px">アポ</th></tr>
${r.topIndustries.map((c) => `<tr><td>${esc(c.key || "（未設定）")}</td><td>${c.sent}</td><td>${c.replied}</td><td><b>${c.appo}</b></td></tr>`).join("")}
</table></div>` : ""}
<p class="muted small">※ 反応（返信・アポ・断り）は、送信用メールの受信箱を読んで自動で記録したものと、手で記録したものの合計です。</p>
<p><a class="btn sub" href="/stats">送信数の画面に戻る</a></p>
<style>@media print{header,.btn{display:none!important}main{padding:0}.card{break-inside:avoid}}</style>`;
}
