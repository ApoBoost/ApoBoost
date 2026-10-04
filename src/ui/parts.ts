// どの画面からも使う小さな部品（状態の札・色の凡例・画像の拡大など）
import { STATUS_LABEL, OUTCOME_LABEL, CHANNEL_LABEL, channelMode, jst, type Campaign, type Job, type SenderProfile, type JobStatus } from "../db.js";
import { AI_MODELS, buildVars, type Lint } from "../message.js";
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

// ---- 文面の検査（#2周目-1・2）----
// 【ここに…】の書き換え忘れや差し込み名の間違いは、どの会社に送っても同じく止まる。
// 送る直前（worker）で見つけると、待機中の全社が1社ずつ「失敗」になっていた。保存と開始のときに先に見つける

/** 差し込みに使える名前。message.ts の buildVars が値を入れる名前（同じ一覧を手で写すと、増えたときにずれるため関数から取る）
 *  と、composeMessage が足す「資料リンク」「AI冒頭」 */
export const TEMPLATE_VARS: string[] = [
  ...Object.keys(buildVars({ company_name: "", industry: "", sub_industry: "", prefecture: "", representative: "" }, {} as SenderProfile)),
  "資料リンク", "AI冒頭",
];

/** 画面に押すボタンとして並べる差し込み（よく使うもの。別名の 企業名・大業界 などは並べないが、使っても通る） */
export const TEMPLATE_VAR_BUTTONS = ["会社名", "代表者", "業種", "都道府県", "自社名", "担当者", "自社メール", "自社電話", "自社URL", "AI冒頭", "資料リンク"].filter((v) => TEMPLATE_VARS.includes(v));

// よくある書き間違い → 正しい名前。編集距離だけでは「企業」が「企業名」（別名）になり、意味の近さでは選べないため
const VAR_HINTS: Record<string, string> = {
  企業: "会社名", 会社: "会社名", 社名: "会社名", 御社名: "会社名", 貴社名: "会社名", 相手の会社名: "会社名", 相手先: "会社名", 宛名: "会社名", 会社名様: "会社名",
  代表: "代表者", 代表者様: "代表者", 社長: "代表者", 社長名: "代表者",
  自社: "自社名", 弊社: "自社名", 弊社名: "自社名", 当社名: "自社名",
  担当: "担当者", 担当者名: "担当者", 名前: "担当者", 氏名: "担当者", 自分の名前: "担当者",
  電話: "自社電話", 電話番号: "自社電話", tel: "自社電話", メール: "自社メール", メールアドレス: "自社メール", mail: "自社メール",
  url: "自社URL", hp: "自社URL", ホームページ: "自社URL", 自社hp: "自社URL",
  資料: "資料リンク", 資料url: "資料リンク", 資料のリンク: "資料リンク",
  業界: "業種", 県: "都道府県", 都道府県名: "都道府県", ai: "AI冒頭", 冒頭: "AI冒頭", ai挨拶: "AI冒頭",
};

function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/** 知らない差し込み名に近い、正しい名前（無ければ空） */
export function suggestTemplateVar(name: string): string {
  const k = String(name ?? "").normalize("NFKC").replace(/[\s　]+/g, "").toLowerCase();
  if (!k) return "";
  const exact = TEMPLATE_VARS.find((v) => v.toLowerCase() === k);
  if (exact) return exact;
  if (VAR_HINTS[k]) return VAR_HINTS[k];
  let best = "", bestD = Infinity;
  for (const v of TEMPLATE_VARS) { const dd = editDistance(k, v.toLowerCase()); if (dd < bestD) { best = v; bestD = dd; } }
  return bestD <= Math.min(2, Math.ceil(k.length / 2)) ? best : "";
}

/** 全角の二重波括弧（｛｛会社名｝｝・｛{ など）を半角にそろえる。保存のときに使う。
 *  一重のもの（｛会社名｝）は、差し込みのつもりか飾りか分からないので変えない（検査で知らせる） */
export function normalizeTemplateBraces(s: string): string {
  return String(s ?? "").replace(/｛｛|｛\{|\{｛/g, "{{").replace(/｝｝|｝\}|\}｝/g, "}}");
}

export type TemplateFields = { subject_text?: string | null; template_text?: string | null; subject_b?: string | null; template_b?: string | null; subject_alts?: string | null; ab_enabled?: number | string | null; mode?: string | null };

/** キャンペーンの文面（件名・本文・A/Bの件名と本文・件名の別案）を、送る前に調べる。
 *  返す文が1つでもあれば、開始させない（保存はできる。保存のときは注意として出す）。
 *  ここで見るのは「どの会社に送っても同じく止まる」間違いだけ（文字数・迷惑語などの注意は文面チェック lintMessage が見る） */
export function templateProblems(c: TemplateFields): string[] {
  const out: string[] = [];
  const ab = Number(c.ab_enabled ?? 0) === 1;
  const fields: [string, string][] = [
    ["件名", String(c.subject_text ?? "")],
    ["本文", String(c.template_text ?? "")],
    ["件名の別案", String(c.subject_alts ?? "")],
    ...(ab ? [["件名（B）", String(c.subject_b ?? "")], ["本文（B）", String(c.template_b ?? "")]] as [string, string][] : []),
  ];
  // 本文が空だと、差し込みだけの空の文面（または資料リンクだけ）が送られてしまう
  if (!String(c.template_text ?? "").trim()) out.push("本文が空です。本文を書いてから開始してください");
  for (const [label, text] of fields) {
    if (!text) continue;
    if (/【ここに/.test(text)) out.push(`${label}に【ここに…】の部分が残っています。自分の言葉に書き換えてください`);
    // 二重の波括弧で囲んだもの（renderTemplate が置き換える形）。名前を確かめる
    const rest = text.replace(/\{\{\s*([^{}]*?)\s*\}\}/g, (_m, raw: string) => {
      const name = raw.trim();
      if (!TEMPLATE_VARS.includes(name)) {
        const s = suggestTemplateVar(name);
        out.push(`${label}の {{${name}}} は使えない差し込み名です。${s ? `{{${s}}} のことですか` : `使えるのは ${TEMPLATE_VAR_BUTTONS.map((v) => `{{${v}}}`).join(" ")} です`}`);
      }
      return " ";
    });
    // 残った波括弧＝一重・片側だけ・全角。置き換わらずに、そのまま相手に送られてしまう
    for (const m of rest.match(/[{｛]+[^{}｛｝\n]{0,15}[}｝]*|[}｝]+/g) ?? []) {
      const inner = (m.match(/[^{}｛｝\s　]+/) ?? [""])[0];
      const s = inner ? suggestTemplateVar(inner) : "";
      out.push(`${label}の「${m.trim()}」は差し込みになりません。${s ? `{{${s}}} のように` : ""}半角の波括弧2つ（{{ と }}）で囲んでください`);
    }
  }
  return [...new Set(out)];
}

export const ZOOM_SNIPPET =`<div id="fozoom" hidden style="position:fixed;inset:0;background:rgba(0,0,0,.82);z-index:100;display:flex;align-items:center;justify-content:center;padding:20px;cursor:zoom-out" onclick="this.hidden=true"><img id="fozoomimg" style="max-width:100%;max-height:100%;background:#fff"></div>
<script>function foZoom(src){const b=document.getElementById("fozoom");document.getElementById("fozoomimg").src=src;b.hidden=false;}
addEventListener("keydown",(e)=>{if(e.key==="Escape"){const b=document.getElementById("fozoom");if(b)b.hidden=true;}});</script>`;
