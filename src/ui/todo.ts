// 要対応
import { STATUS_LABEL, OUTCOME_LABEL, CHANNEL_LABEL, channelMode, jst, type Campaign, type Job, type SenderProfile, type JobStatus } from "../db.js";
import { AI_MODELS, type Lint } from "../message.js";
import { TEMPLATE_LIBRARY } from "../templates.js";
import { esc, layout, n, type NavUser } from "./layout.js";
import { post, thumb, moreMenu, ZOOM_SNIPPET } from "./parts.js";

// ---- 要対応（#50 #10 → #113〜#118 #124 で作り直し）----
// 最初の版は2,000件超が同じ重さで並ぶだけで、開いた瞬間に閉じたくなる画面だった。
//  ・「今日やる10件」を先頭に出す（送れそう度と新しさで選ぶ）
//  ・同じ原因はまとめて1行にし、1回の操作で片づける
//  ・理由によって出すボタンを変える（開けないサイトに「開いて入力」を出さない）
//  ・古いものは自動で「見送り」に回す
export type TodoRow = Job & { campaign_name: string; prio?: number };

export type TodoGroup = { key: string; label: string; n: number; advice: string; action: "requeue" | "dismiss" | "to_email"; actionLabel: string; link?: string; linkLabel?: string };

export type TodoKind = "" | "captcha" | "check" | "failed" | "noform" | "dismissed";

/** その会社が「何で止まっているか」。出すボタンを決めるのに使う（#116） */
export function todoReason(j: Pick<Job, "status" | "result_text" | "channel">): "captcha" | "check" | "mailconfig" | "input" | "blocked" | "unreachable" | "noform" | "network" | "unsure" | "other" {
  const t = j.result_text || "";
  if (j.status === "skip_captcha") return "captcha";
  if (j.status === "skip_no_form") return /アクセスできない|接続を拒否|見つかりません（ドメイン|応答がありません/.test(t) ? "unreachable" : "noform";
  if (/^要確認/.test(t)) return "check";
  if (/メール送信エラー|ログインを拒否|2段階認証|アプリパスワード|送信用メール/.test(t)) return "mailconfig";
  if (/送信後の判定不能/.test(t)) return "unsure";
  // サイトの側で断られた（スパム判定・403 など）。入力を直しても通らないので、入力エラーとは別にする
  if (/^サイト側で受け付けられません/.test(t)) return "blocked";
  if (/入力エラー|必須|送信ボタンが有効になりません|本文欄/.test(t)) return "input";
  if (/時間切れ|タイムアウト|timeout|net::|通信|接続/i.test(t)) return "network";
  return "other";
}

/** 理由ごとに、意味のある操作だけを出す（#116）。
 *  いちばん効く操作1つだけをボタンにして、残りは「…」メニューに畳む（以前は1行にボタンとリンクが4つ並んでいた） */
export function todoActions(j: TodoRow, back: string): string {
  const b = `<input type="hidden" name="back" value="${esc(back)}">`;
  const open = post(`/jobs/${j.id}/assist`, "開いて入力", b + "", "").replace('class="inline"', 'class="inline" data-busy data-busytext="ブラウザを開いています…"');
  const sent = post(`/jobs/${j.id}/mark-sent`, "送信済みにする", b);
  const requeue = post(`/jobs/${j.id}/requeue`, "もう一度送る", b);
  const dismiss = post(`/jobs/${j.id}/dismiss`, "見送る", b);
  const toEmail = j.email ? post(`/jobs/${j.id}/to-email`, "メールで送る", b) : "";
  const fix = `<a class="btn small" href="/jobs/${j.id}#fix">URLを直す</a>`;
  const detail = `<a class="btn small" href="/jobs/${j.id}">くわしく見る</a>`;
  const [main, ...rest] = pick().filter(Boolean);
  return `<span class="todoacts">${main} ${moreMenu([...rest, "<hr>", detail])}</span>`;
  function pick(): string[] {
  switch (todoReason(j)) {
    case "captcha": return [open, sent, toEmail, dismiss];
    case "check": return [`<a class="btn small" href="/jobs/${j.id}#answer">質問に答える</a>`, dismiss];
    case "mailconfig": return [`<a class="btn small" href="/senders">送信者の設定を直す</a>`, requeue];
    case "input": return [requeue, open, toEmail, dismiss];
    case "blocked": return [toEmail || open, toEmail ? open : "", sent, dismiss];
    case "unsure": return [sent, requeue, dismiss];
    case "unreachable": return [fix, toEmail, dismiss];
    case "noform": return [toEmail || fix, toEmail ? fix : "", requeue, dismiss];
    case "network": return [requeue, dismiss];
    default: return [requeue, sent, dismiss];
  }
  }
}

export const REASON_LABEL: Record<string, string> = { captcha: "画像認証", check: "質問への回答待ち", mailconfig: "メールの設定", input: "入力エラー", blocked: "サイト側の拒否", unreachable: "サイトを開けない", noform: "フォームが無い", network: "通信エラー", unsure: "届いたか不明", other: "その他" };

export function todoView(rows: TodoRow[], kind: TodoKind, counts: Record<string, number>, opts: { today: TodoRow[]; groups: TodoGroup[]; hideDays: number; page: number; pageSize: number; total: number }): string {
  const KINDS: [TodoKind, string][] = [["", "すべて"], ["failed", "失敗"], ["check", "回答待ち"], ["captcha", "画像認証"], ["noform", "フォーム無し"], ["dismissed", "見送り"]];
  const back = `/todo${kind ? `?kind=${kind}` : ""}`;
  const tab = (k: TodoKind, label: string) => `<a class="${kind === k ? "on" : ""}" href="/todo${k ? `?kind=${k}` : ""}">${label}<span class="cnt">${n(counts[k || "all"] ?? 0)}</span></a>`;
  const todayIds = new Set(opts.today.map((j) => j.id));
  const reasonCell = (j: TodoRow, max: number) => { const t = (j.result_text || "").split("\n")[0]; return `<span class="tag ${j.status === "skip_captcha" ? "queued" : "failed"}">${esc(REASON_LABEL[todoReason(j)])}</span><span class="muted" data-nohelp title="${esc(t)}">${esc(t.replace(/^(入力エラー|サイト側で受け付けられませんでした|送信後の判定不能)[:：]\s*/, "").slice(0, max))}</span>`; };
  const acts = (j: TodoRow) => kind === "dismissed" ? post(`/jobs/${j.id}/undismiss`, "要対応に戻す", `<input type="hidden" name="back" value="${esc(back)}">`) : todoActions(j, back);
  // 1社＝1段。会社名・理由・更新日・操作だけ（スクリーンショットとくわしい理由は、会社を開いた先で見る）
  const row = (j: TodoRow) => `<tr>
<td><input type="checkbox" name="ids" value="${j.id}" form="todobulk" onchange="foTodoCount()"></td>
<td class="cut"><a href="/jobs/${j.id}"><b>${esc(j.company_name)}</b></a>${todayIds.has(j.id) ? ` <span class="tag sending" title="送れる見込みが高く、新しいもの">今日</span>` : ""}<span class="muted" data-nohelp>${esc(j.domain || j.email)}</span></td>
<td class="cut">${reasonCell(j, 60)}</td>
<td class="small muted">${esc(jst(j.updated_at).slice(5, 10))}</td>
<td class="acts">${acts(j)}</td></tr>`;
  const card = (j: TodoRow) => `<div class="c"><h3><a href="/jobs/${j.id}">${esc(j.company_name)}</a>${todayIds.has(j.id) ? ` <span class="tag sending">今日</span>` : ""}</h3>
<div class="small">${reasonCell(j, 40)}</div>
<div class="acts">${acts(j)}</div></div>`;
  const pages = Math.max(1, Math.ceil(opts.total / opts.pageSize));
  const pager = pages > 1 ? `<div class="pager">${opts.page > 1 ? `<a class="btn small" href="${back}${back.includes("?") ? "&" : "?"}page=${opts.page - 1}">← 前へ</a>` : ""}<span>${opts.page} / ${pages} ページ（${n(opts.total)}社）</span>${opts.page < pages ? `<a class="btn small" href="${back}${back.includes("?") ? "&" : "?"}page=${opts.page + 1}">次へ →</a>` : ""}</div>` : "";

  return `<h1>要対応</h1>
<p class="muted" data-nohelp>自動で送れなかった会社です。${opts.hideDays}日たったものは自動で「見送り」に移します（設定で変更できます）。</p>

${kind === "" && opts.today.length ? `<p data-nohelp style="margin:0 0 14px"><span class="tag sending">今日</span> の印が付いた <b>${opts.today.length}件</b>（送れる見込みが高く、新しいもの）だけ片づければ十分です。${(counts.captcha ?? 0) > 0 ? ` <a class="btn small" href="/todo/run?kind=captcha" style="margin-left:6px">画像認証を続けて処理する（${n(counts.captcha)}社）</a>` : ""}</p>` : ""}

${kind === "" && opts.groups.length ? `<div class="card"><h2 style="margin-top:0">同じ原因のまとめ</h2>
<p class="muted" data-nohelp>原因が同じものは、1回の操作でまとめて片づけられます。</p>
${opts.groups.map((g) => `<div class="grouprow"><div><b>${esc(g.label)}</b> <span class="muted" data-nohelp>${n(g.n)}社</span><div class="small muted" data-nohelp>${esc(g.advice)}</div></div>
<div style="white-space:nowrap">${g.link ? `<a class="btn small" href="${g.link}">${esc(g.linkLabel ?? "開く")}</a> ` : ""}<form method="post" action="/todo/group" class="inline" onsubmit="return confirm('${n(g.n)}社をまとめて「${esc(g.actionLabel)}」にします。よろしいですか？')"><input type="hidden" name="key" value="${esc(g.key)}"><input type="hidden" name="action" value="${g.action}"><button class="btn small">${esc(g.actionLabel)}</button></form></div></div>`).join("")}
</div>` : ""}

<div class="tabs">${KINDS.map(([k, label]) => tab(k, label)).join("")}</div>
${kind === "captcha" && rows.length ? `<p><a class="btn primary" href="/todo/run?kind=captcha">続けて処理する（1社ずつ順番に）→</a></p>` : ""}
${rows.length ? `
<table class="resp dense"><tr><th style="width:34px"><input type="checkbox" title="このページを全選択" onchange="document.querySelectorAll('input[name=ids][form=todobulk]').forEach(c=>c.checked=this.checked);foTodoCount()"></th><th>会社</th><th>理由</th><th style="width:64px">更新</th><th style="width:190px"></th></tr>
${rows.map(row).join("")}
</table>
<div class="cards">${rows.map(card).join("")}</div>
<form id="todobulk" class="bulkbar" hidden method="post" action="/todo/bulk" onsubmit="return foTodoConfirm(this)">
<input type="hidden" name="back" value="${esc(back)}"><input type="hidden" name="kind" value="${esc(kind)}">
<b id="todosel">0社</b>
<select name="action"><option value="">操作を選ぶ…</option>${kind === "dismissed" ? `<option value="undismiss">要対応に戻す</option>` : `<option value="requeue">もう一度送る（待機に戻す）</option><option value="to_email">メールで送る（アドレスがある会社）</option><option value="mark_sent">送信済みにする</option><option value="dismiss">見送る</option>`}<option value="suppress">除外リストに入れる（今後送らない）</option></select>
<button class="btn small">実行</button>
<label><input type="checkbox" name="all" value="1" onchange="foTodoCount()">このタブの全 ${n(opts.total)}社を対象にする</label>
</form>
${pager}
<script>
// まとめて操作の帯は、会社を1つ以上選んだときだけ出す（選ぶ前は意味がないので）
function foTodoCount(){const bar=document.getElementById("todobulk");const all=bar.querySelector('input[name=all]');const k=document.querySelectorAll('input[name=ids][form=todobulk]:checked').length;document.getElementById("todosel").textContent=all&&all.checked?"このタブの全件":k+"社を選択中";bar.hidden=!(k>0||(all&&all.checked));}
function foTodoConfirm(f){const a=f.action.value;if(!a){alert("操作を選んでください");return false;}const all=f.all&&f.all.checked;const k=document.querySelectorAll('input[name=ids][form=todobulk]:checked').length;if(!all&&!k){alert("会社を選んでください");return false;}const label=f.action.options[f.action.selectedIndex].text;return confirm((all?"このタブの全件":k+"社")+" を「"+label+"」にします。よろしいですか？");}
</script>` : `<div class="card"><p>${kind === "dismissed" ? "見送った会社はありません。" : "対応が必要な会社はありません。"}</p></div>`}
${ZOOM_SNIPPET}`;
}

/** 画像認証などを1社ずつ続けて処理する画面（#118）。一覧に戻らずに「次へ」で進める */
export function todoRunView(j: TodoRow | null, kind: string, left: number, skip: string, doneMsg = ""): string {
  if (!j) return `<h1>続けて処理する</h1><div class="card" style="text-align:center;padding:40px"><h2 style="margin-top:0">${left === 0 ? "すべて終わりました" : "対象がありません"}</h2><p><a class="btn primary" href="/todo">要対応に戻る</a></p></div>`;
  const hid = `<input type="hidden" name="back" value="/todo/run?kind=${esc(kind)}&skip=${esc(skip)}">`;
  return `<h1>続けて処理する <span class="tag queued">残り ${n(left)}社</span></h1>
<p><a href="/todo?kind=${esc(kind)}">← 一覧に戻る</a></p>
<div class="card">
<h2 style="margin-top:0">${esc(j.company_name)}</h2>
<p class="small">${esc(j.domain)}・${esc(j.campaign_name)}<br>${esc((j.result_text || "").split("\n")[0].slice(0, 100))}</p>
<ol style="line-height:2.1">
<li><form method="post" action="/jobs/${j.id}/assist" class="inline" data-busy data-busytext="ブラウザを開いています…">${hid}<button class="btn primary">① ブラウザを開いて入力する</button></form> <span class="muted" data-nohelp>文面まで入力した状態で開きます</span></li>
<li>開いたブラウザで、画像認証を入力して「送信」を押す</li>
<li><form method="post" action="/jobs/${j.id}/mark-sent" class="inline">${hid}<button class="btn">③ 送信済みにして次へ</button></form>
 <form method="post" action="/jobs/${j.id}/dismiss" class="inline">${hid}<button class="btn">送れなかったので見送って次へ</button></form>
 <a class="btn" href="/todo/run?kind=${esc(kind)}&skip=${esc(skip ? `${skip},${j.id}` : String(j.id))}">あとで（とばす）</a></li>
</ol>
${j.screenshot_path ? `<p>${thumb(j)}</p>` : ""}
</div>
${ZOOM_SNIPPET}`;
}
