// ホームとキャンペーン一覧
import { STATUS_LABEL, OUTCOME_LABEL, CHANNEL_LABEL, channelMode, jst, type Campaign, type Job, type SenderProfile, type JobStatus } from "../db.js";
import { AI_MODELS, type Lint } from "../message.js";
import { TEMPLATE_LIBRARY } from "../templates.js";
import { esc, layout, n, type NavUser, IC_WARN, mascot } from "./layout.js";
import { MODE_LABEL, campaignStatusTag, post, moreMenu } from "./parts.js";

/** ホーム上部の「今日やることが分かる1画面」（#49 #108 #132 #137） */
export type HomeSummary = {
  todayForm: number; todayEmail: number; monthForm: number; monthEmail: number;
  appointments: number; replies: number; declines: number;
  queued: number; runningNames: string[]; windowOk: boolean; windowText: string;
  todo: number; todoCaptcha: number;
  emailPaused: { label: string; until: number; reason: string }[];
  senders: number; campaigns: number;
  capForm: number; capEmail: number;   // 今日送れる上限（開始中のキャンペーンの合計）
  nextStart: string;                   // 時間帯外のとき、次に始まる時刻
  setupDone: number; setupTotal: number;
  newAppointments: { id: number; company: string; at: string }[]; // 直近3日のアポ
  perCampaign: CampaignHome[];         // キャンペーンごとの進み具合と数字
};
/** ホームに出す、キャンペーン1件ぶんのまとめ */
export type CampaignHome = {
  id: number; name: string; status: string; running: boolean;
  todayForm: number; todayEmail: number; monthForm: number; monthEmail: number;
  appointments: number; replies: number; declines: number;
  queued: number; todo: number; todoCaptcha: number;
  queuedForm?: number; queuedEmail?: number; // 待機の内訳（上限はチャネルごとに比べる）
  capForm: number; capEmail: number;   // このキャンペーンが今日送れる上限
  windowOk: boolean; nextStart: string;
  paused: string;                      // メール送信が一時停止中なら、その理由
  /** いま送りが進まない理由（経路の campaignStall で1つに決めたもの）。無ければ null */
  stall?: { kind: string; text: string; blocking: boolean; href: string; action: string } | null;
};

export function homeCard(h: HomeSummary): string {
  // いま一番やるべきことを1つだけ出す（最初の人が迷わないように）
  // 「開始すると送ります」は、まだ開始していない（準備中・一時停止）キャンペーンに待機がある時だけ出す。
  // 開始済みで時間帯・上限を待っているものにまで出していて、「開始したのに、また開始と言われる」になっていた
  const autoStopped = h.perCampaign.find((c) => c.stall?.kind === "auto");
  const idle = h.perCampaign.filter((c) => c.status !== "running" && c.status !== "done" && c.queued > 0 && !c.running);
  const idleQueued = idle.reduce((a, c) => a + c.queued, 0);
  const waiting = h.perCampaign.find((c) => c.status === "running" && !c.running && c.stall?.blocking);
  const next = !h.senders ? { t: "はじめの設定（6ステップ）から始めましょう", b: "はじめの設定を開く", href: "/setup" }
    : !h.campaigns ? { t: "キャンペーンを作って、会社リストを取り込みましょう", b: "はじめの設定を開く", href: "/setup" }
    : h.newAppointments.length ? { t: `アポ・前向きな返信が ${h.newAppointments.length}件あります: ${h.newAppointments.map((a) => a.company).join("、")}`, b: "内容を見る", href: `/jobs/${h.newAppointments[0].id}` }
    : autoStopped ? { t: `「${autoStopped.name}」が止まっています。${autoStopped.stall!.text}`, b: autoStopped.stall!.action || "キャンペーンを開く", href: autoStopped.stall!.href || `/campaigns/${autoStopped.id}` }
    : idleQueued > 0 ? { t: `まだ開始していない待機中の会社が ${n(idleQueued)}社あります。開始すると送信時間帯に自動で送ります`, b: "キャンペーンを開く", href: idle.length === 1 ? `/campaigns/${idle[0].id}?tab=send` : "/campaigns" }
    : h.todo > 0 ? { t: `自動で送れなかった会社が ${n(h.todo)}社あります。まず「今日やる10件」から`, b: "要対応を見る", href: "/todo" }
    : h.runningNames.length ? { t: `送信中: ${h.runningNames.join("、")}`, b: "", href: "" }
    : waiting ? { t: `開始済みです。「${waiting.name}」: ${waiting.stall!.text}`, b: "", href: "" }
    : { t: "いまやることはありません。お疲れさまでした", b: "", href: "", rest: true };
  const total = (label: string, v: string) => `<span style="margin-right:18px"><span class="muted" data-nohelp>${label}</span> <b>${v}</b></span>`;
  // 上は「次にやること」と全体の合計だけ。キャンペーンごとの進み具合は、下に1件1行で出す
  return `${h.setupDone < h.setupTotal ? `<p class="flash" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">はじめの設定が <b>${h.setupDone} / ${h.setupTotal}</b> まで済んでいます <a class="btn small" href="/setup">続きを進める</a></p>` : ""}
<div class="card${"rest" in next ? " emptystate" : ""}">${"rest" in next ? mascot(84) : ""}<div>
  <p style="margin:0 0 8px;font-size:16px"><b>${esc(next.t)}</b>${next.b ? ` <a class="btn primary small" href="${next.href}" style="margin-left:8px">${esc(next.b)}</a>` : ""}</p>
  <p class="small" style="margin:0">${total("今日の送信", `${n(h.todayForm + h.todayEmail)}社`)}${total("今月", `${n(h.monthForm + h.monthEmail)}社`)}${total("アポ", `${n(h.appointments)}社`)}${total("待機", `${n(h.queued)}社`)}${h.todo ? `<a href="/todo" style="color:var(--c-ng)">${total("要対応", `${n(h.todo)}社`)}</a>` : ""}</p>
</div></div>
${h.perCampaign.length ? `<div class="card" style="padding:0">${h.perCampaign.map(campaignHomeCard).join("")}</div>` : ""}`;
}

/** キャンペーン1件ぶんのカード: 今日の進み具合のバーと、今日・今月・アポ・送信待ち・要対応 */
function campaignHomeCard(c: CampaignHome): string {
  const url = `/campaigns/${c.id}`;
  const sentToday = c.todayForm + c.todayEmail;
  const cap = c.capForm + c.capEmail;
  // 今日の目標 = 「1日の上限」と「今日送れる会社の数（送った分＋待機）」の小さい方。チャネルごとに比べてから足す
  // （合計で比べると、フォームが上限でもメールの上限の余りで目標が大きく出ていた）。
  // 上限を大きくしていると（例: 10,000）、上限を分母にした帯はいつもほぼ0%で、何も伝わらなかった
  const goal = c.queuedForm === undefined || c.queuedEmail === undefined
    ? Math.min(cap, sentToday + c.queued)
    : Math.min(c.capForm, c.todayForm + c.queuedForm) + Math.min(c.capEmail, c.todayEmail + c.queuedEmail);
  const pct = goal ? Math.min(100, Math.round((sentToday / goal) * 100)) : 0;
  const todoOther = Math.max(0, c.todo - c.todoCaptcha);
  // 進まない理由があれば、それを出す（経路で優先順に1つ決めたもの）
  const st = c.stall;
  const stateText = c.status === "done" ? "すべて送り終わりました"
    : st && (st.kind === "auto" || !c.running) ? st.text
    : c.running ? (st ? `送信中です（${st.text}）` : "送信中です")
    : c.status !== "running" ? (c.queued ? "止まっています（「開始」を押すと送ります）" : "送信待ちの会社はありません")
    : !c.windowOk ? `いまは送信時間帯の外です。${c.nextStart}`
    : "送信できる時間帯です";
  const num = (label: string, v: number, href: string, color = "") => `<a href="${href}">${label}<b${color && v ? ` style="color:${color}"` : ""}>${n(v)}</b></a>`;
  // 1キャンペーン＝1行。左に名前といまの状態、右に今日の進み具合と数字。内訳はキャンペーンを開いた先で見る
  return `<div class="hrow">
  <div>
    <h2><a href="${url}" style="color:inherit;text-decoration:none">${esc(c.name)}</a> ${campaignStatusTag(c.status, c.running)}</h2>
    <div class="${st?.kind === "auto" ? "small" : "muted"} state" data-nohelp${st?.kind === "auto" ? ' style="color:var(--c-ng)"' : ""}>${st?.kind === "auto" ? `${IC_WARN} ` : ""}${esc(stateText)}${!st && goal && cap < sentToday + c.queued ? `（1日の上限 ${n(cap)}社）` : ""}${st?.href && st.action ? ` <a class="btn small" href="${esc(st.href)}">${esc(st.action)}</a>` : ""}</div>
    ${c.paused ? `<div class="small" style="margin-top:4px;color:var(--ng)">${IC_WARN} メール送信を一時停止中: ${esc(c.paused)}</div>` : ""}
  </div>
  <div>
    <div class="small" style="display:flex;justify-content:space-between"><span>今日 ${goal ? `<b>${n(sentToday)}</b> / ${n(goal)}社` : "送る会社はありません"}</span>${goal ? `<span class="muted" data-nohelp>${pct}%</span>` : ""}</div>
    <div class="bar"><i style="width:${pct}%"></i></div>
    <div class="nums">${num("今月", c.monthForm + c.monthEmail, `/stats?mode=month&campaign=${c.id}`)}${num("アポ", c.appointments, `${url}?tab=result#reactions`, "var(--c-ok)")}${num("待機", c.queued, `${url}?tab=send`)}${num("要対応", todoOther, "/todo", "var(--c-ng)")}${c.todoCaptcha ? num("画像認証", c.todoCaptcha, "/todo?kind=captcha") : ""}</div>
  </div>
</div>`;
}

export type CampaignRow = Campaign & { sender_label: string; total: number; sent: number; queued: number; reactions: number; last_sent: string | null; is_running?: boolean };

/** キャンペーンの一覧。home を渡すとホーム画面（上にまとめを出す）、渡さなければ一覧だけ */
export function campaignListView(rows: CampaignRow[], provider: string, senders: { id: number; label: string; company: string; person: string }[] = [], home?: HomeSummary) {
  // 最終送信からの経過を「今日／昨日／N日前」で表す（放置ぎみのキャンペーンに気づける）
  const sinceLabel = (ts: string | null): string => {
    if (!ts) return "";
    const t = Date.parse(String(ts).replace(" ", "T") + "Z"); // DBは世界標準時
    if (Number.isNaN(t)) return "";
    const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const days = Math.round((startOf(new Date()) - startOf(new Date(t))) / 86400000);
    return days <= 0 ? "今日" : days === 1 ? "昨日" : `${days}日前`;
  };
  const list = rows.length ? `<table class="resp">
<tr><th>キャンペーン</th><th style="width:110px">状態</th><th style="width:220px">進み具合</th><th style="width:90px">待機</th><th style="width:110px">反応</th><th style="width:130px">最後に送った日</th><th style="width:56px"></th></tr>
${rows.map((c) => {
    const pct = c.total ? Math.round((c.sent / c.total) * 100) : 0;
    return `<tr><td><a href="/campaigns/${c.id}"><b>${esc(c.name)}</b></a><div class="muted" data-nohelp>${esc(c.sender_label)}・${esc(MODE_LABEL[c.mode] ?? c.mode)}${c.group_name ? `・グループ: ${esc(c.group_name)}` : ""}</div></td>
<td>${campaignStatusTag(c.status, c.is_running)}</td>
<td><div class="bar" style="margin:4px 0"><i style="width:${pct}%"></i></div><span class="small">${n(c.sent)} / ${n(c.total)}社 送信済み</span></td>
<td>${n(c.queued)}<span class="muted" data-nohelp>社</span></td>
<td class="small">${c.sent ? `${n(c.reactions)}件<br><span class="muted" data-nohelp>${((c.reactions / c.sent) * 100).toFixed(1)}%</span>` : "—"}</td>
<td class="small">${c.last_sent ? `${esc(jst(c.last_sent).slice(5))}<br><span class="muted" data-nohelp>${sinceLabel(c.last_sent)}</span>` : "—"}</td>
<td class="acts" style="text-align:right">${moreMenu([`<a class="btn small" href="/campaigns/${c.id}">開く</a>`, `<a class="btn small" href="/campaigns/${c.id}/edit">設定を変える</a>`, post(`/campaigns/${c.id}/duplicate`, "複製する")])}</td></tr>`;
  }).join("")}
</table>
<div class="cards">${rows.map((c) => `<div class="c"><h3><a href="/campaigns/${c.id}">${esc(c.name)}</a></h3>${campaignStatusTag(c.status, c.is_running)}
<div class="small" style="margin-top:6px">送信済み ${n(c.sent)} / ${n(c.total)}社・待機 ${n(c.queued)}社・反応 ${n(c.reactions)}件</div>
<div class="acts"><a class="btn small" href="/campaigns/${c.id}">開く</a></div></div>`).join("")}</div>`
    : `<div class="card emptystate">${mascot(96)}<div><p><b>まだキャンペーンがありません。</b></p><p><a class="btn primary" href="/setup">はじめの設定を開く</a> <a class="btn" href="/campaigns/new">キャンペーンを作る</a></p></div></div>`;

  const importBox = senders.length && !home ? `<details style="margin:16px 4px 0"><summary class="muted small" style="cursor:pointer">別のPCで書き出した設定ファイルから作る</summary>
<p class="muted" style="margin:8px 0">キャンペーン画面の「設定をファイルに書き出す」で作った .json を選ぶと、同じ文面・設定のキャンペーンが作られます（会社リスト・送信履歴・送信者は含まれません）。</p>
<form method="post" action="/campaigns/import" enctype="multipart/form-data" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
<input type="file" name="file" accept=".json,application/json" required style="max-width:320px">
<label class="inline small">送信者: <select name="sender_id" style="width:auto">${senders.map((s) => `<option value="${s.id}">${esc(s.label)}（${esc(s.company)} ${esc(s.person)}）</option>`).join("")}</select></label>
<button class="btn small">読み込む</button></form></details>` : "";

  if (home) {
    return `<div class="pagehead"><h1>ホーム</h1><span><a class="btn small" href="/campaigns">キャンペーンの一覧</a> <a class="btn small" href="/campaigns/new">＋ 新しいキャンペーン</a></span></div>
${homeCard(home)}`;
  }
  return `<div class="pagehead"><h1>キャンペーン</h1><a class="btn primary" href="/campaigns/new">＋ 新しいキャンペーン</a></div>
<p class="muted">キャンペーン＝「この文面で、この会社たちに、この送り方で送る」という送信のまとまり1件です。商材ごと・ターゲットごとに分けて作ると、反応率を比べられます。AI: ${esc(provider === "none" ? "未設定（テンプレートのみで動きます）" : provider)}</p>
${list}
${importBox}`;
}
