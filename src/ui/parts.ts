// どの画面からも使う小さな部品（状態の札・色の凡例・画像の拡大など）
import { STATUS_LABEL, OUTCOME_LABEL, CHANNEL_LABEL, channelMode, jst, type Campaign, type Job, type SenderProfile, type JobStatus } from "../db.js";
import { AI_MODELS, type Lint } from "../message.js";
import { TEMPLATE_LIBRARY } from "../templates.js";
import { esc, layout, n, type NavUser } from "./layout.js";

export function statusTag(s: JobStatus) {
  const cls = s === "sent" ? "sent" : s === "failed" ? "failed" : s === "queued" ? "queued" : s === "sending" ? "sending" : "skip";
  return `<span class="tag ${cls}">${STATUS_LABEL[s] ?? s}</span>`;
}

/** 失敗理由を「何のエラーか」ひと目で分かる種類に分類する */
export function errKind(j: Pick<Job, "status" | "result_text">): string {
  if (j.status === "skip_captcha") return "CAPTCHA検出（要手動対応）";
  if (j.status !== "failed") return "";
  const t = j.result_text || "";
  if (/^要確認/.test(t)) return "要確認（AIが回答を決められない項目）";
  if (/入力エラー|未入力|入力してください|必須項目/.test(t)) return "必須項目未入力";
  if (/送信ボタンが見つからない/.test(t)) return "送信ボタン未検出";
  if (/timeout|タイムアウト/i.test(t)) return "タイムアウト";
  if (/net::|ECONN|ERR_|getaddrinfo|dns/i.test(t)) return "ネットワークエラー";
  if (/本文欄への入力に失敗|本文（textarea）/.test(t)) return "本文欄に入力できず";
  if (/エラー文言/.test(t)) return "サイト側のエラー表示";
  return "その他";
}

export function errKindTag(j: Pick<Job, "status" | "result_text">): string {
  const k = errKind(j);
  return k ? `<span class="errkind">${esc(k)}</span>` : "";
}

/** 事前チェックで出した「送れそう度」（0〜100）。高いほど送れる見込みが高い。未計測は出さない */
export function scoreTag(j: Job): string {
  const n = (j as Job & { scan_score?: number }).scan_score ?? -1;
  if (n < 0 || j.status === "sent") return "";
  const color = n >= 70 ? "var(--ok)" : n >= 40 ? "var(--warn)" : "var(--hive-600)";
  return `<br><span class="muted" style="color:${color}" title="事前チェックの結果から出した、送れる見込み（フォームの有無・メールの有無・画像認証）">送れそう度 ${n}</span>`;
}

/** 一覧の状態セル。リトライで送信済みになった会社は、過去の失敗をグレーアウトし ↓ で「N回目で送信済み」を見せる */
export function statusCell(j: Job): string {
  if (j.status === "sent" && j.prev_status && j.attempts > 1) {
    return `<span class="tag" style="background:#eee;color:#999;text-decoration:line-through">${STATUS_LABEL[j.prev_status as JobStatus] ?? j.prev_status}</span>`
      + `<div class="small" style="color:var(--hive-600);margin:2px 0">↓</div>`
      + `${statusTag(j.status)}<div class="small muted">${j.attempts}回目の送信で送信済み</div>`;
  }
  return statusTag(j.status);
}

/** 送信結果をお知らせの文にする。内部の値（sent / failed など）はそのまま出さず、
 *  日本語の状態名と結果の1行目にする（「テスト送信の結果: sent」と出ていた） */
export function resultNote(r: { status: string; result_text?: string | null }): string {
  const first = String(r.result_text ?? "").split("\n")[0].trim().slice(0, 60);
  return `${STATUS_LABEL[r.status as JobStatus] ?? "状態不明"}${first ? `（${first}）` : ""}`;
}

/** ボタンが2つ以上あるフォームの二重送信防止（data-once を付けたフォーム）。
 *  共通の data-busy は押したボタンを送信の瞬間に無効にするため、ボタンの name/value（例: 「入力だけ試す」の dry=1）が
 *  送られなくなる。ここでは2回目の送信だけを止め、ボタンの無効化は送信の後に回す */
export const ONCE_SNIPPET = `<script>
document.addEventListener("submit",(e)=>{const f=e.target;if(!(f instanceof HTMLFormElement)||!f.hasAttribute("data-once"))return;
if(f.dataset.sent==="1"){e.preventDefault();return;}f.dataset.sent="1";const b=e.submitter;
if(b){b.dataset.label=b.innerHTML;b.innerHTML='<span class="spin"></span>'+(b.dataset.busytext||"処理中…");}
setTimeout(()=>f.querySelectorAll("button").forEach((x)=>{x.disabled=true}),0);},true);
// 戻るボタンで戻ってきたときに押せないままにならないように
addEventListener("pageshow",()=>document.querySelectorAll("form[data-once]").forEach((f)=>{delete f.dataset.sent;f.querySelectorAll("button").forEach((x)=>{x.disabled=false;if(x.dataset.label)x.innerHTML=x.dataset.label})}));
</script>`;

// ---- 表示用の日本語（#102）。内部の値（paused / template など）をそのまま画面に出さない ----
export const CAMPAIGN_STATUS_LABEL: Record<string, string> = { draft: "準備中", running: "送信中", paused: "一時停止", done: "完了" };

export const MODE_LABEL: Record<string, string> = { template: "テンプレート", ai: "全文AI", hybrid: "冒頭だけAI", tpl_ai: "テンプレート＋AI回答" };

export function campaignStatusTag(status: string, running = false): string {
  // 「開始」を押したあとでも、送信時間帯の外や1日の上限に達している間は実際には送っていない。
  // 以前はその間もずっと「送信中」と出ていて、動いているのか止まっているのか分からなかった
  if (status === "running" && !running) return `<span class="tag queued" title="開始済みです。送信時間帯になるか、1日の上限が戻ると自動で送ります">時間待ち</span>`;
  const cls = running || status === "running" ? "sending" : status === "done" ? "sent" : status === "paused" ? "queued" : "skip";
  // 実際に送っている間は、事前チェックと同じ「クルクル」を付ける（動いているのが一目で分かるように）
  return `<span class="tag ${cls}">${running ? '<span class="spin"></span>' : ""}${esc(running ? "送信中" : CAMPAIGN_STATUS_LABEL[status] ?? status)}</span>`;
}

/** 色の意味の凡例（#111）。どの画面でも同じ意味で使う */
export const STATUS_LEGEND = `<div class="legend"><span><i style="background:var(--c-ok)"></i>送れた</span><span><i style="background:var(--c-ng)"></i>手が必要</span><span><i style="background:#D9A400"></i>待ち</span><span><i style="background:var(--c-info)"></i>進行中</span><span><i style="background:#9A958C"></i>対象外</span></div>`;

export const post = (action: string, label: string, extra = "", cls = "", confirmMsg = "") =>
  `<form method="post" action="${action}" class="inline"${confirmMsg ? ` onsubmit="return confirm('${confirmMsg}')"` : ""}>${extra}<button class="btn small ${cls}">${label}</button></form>`;

/** 「…」メニュー。主な操作1つだけをボタンで出し、残りをここに畳む（1行にボタンが4つ並ぶのをやめる） */
export const moreMenu = (items: string[]) => {
  const list = items.filter(Boolean);
  return list.length ? `<details class="menu"><summary aria-label="その他の操作" title="その他の操作">…</summary><div class="pop">${list.join("")}</div></details>` : "";
};

export function thumb(j: Pick<Job, "id" | "screenshot_path">): string {
  if (!j.screenshot_path) return "";
  const f = esc(j.screenshot_path.split("/").pop());
  return `<img src="/screenshots/${f}" alt="" loading="lazy" onerror="this.remove()" onclick="foZoom(this.src)" title="クリックで拡大" style="width:92px;height:62px;object-fit:cover;object-position:top;border:1px solid var(--c-line);border-radius:6px;cursor:zoom-in;display:block">`;
}

export const ZOOM_SNIPPET = `<div id="fozoom" hidden style="position:fixed;inset:0;background:rgba(0,0,0,.82);z-index:100;display:flex;align-items:center;justify-content:center;padding:20px;cursor:zoom-out" onclick="this.hidden=true"><img id="fozoomimg" style="max-width:100%;max-height:100%;background:#fff"></div>
<script>function foZoom(src){const b=document.getElementById("fozoom");document.getElementById("fozoomimg").src=src;b.hidden=false;}
addEventListener("keydown",(e)=>{if(e.key==="Escape"){const b=document.getElementById("fozoom");if(b)b.hidden=true;}});</script>`;
