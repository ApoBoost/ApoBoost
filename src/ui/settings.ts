// 設定まわり（基本設定・除外リスト・ユーザー・アップデート・動作チェック・エラーログ）
import { STATUS_LABEL, OUTCOME_LABEL, CHANNEL_LABEL, channelMode, jst, type Campaign, type Job, type SenderProfile, type JobStatus } from "../db.js";
import { AI_MODELS, type Lint } from "../message.js";
import { TEMPLATE_LIBRARY } from "../templates.js";
import { esc, layout, n, type NavUser, IC_WARN } from "./layout.js";
import { post } from "./parts.js";

export function suppressionsView(
  rows: { id: number; company_name: string; domain: string | null; email: string | null; tel: string; reason: string; created_at: string }[],
  optouts: { email: string; reason: string; created_at: string }[] = [],
  imported?: { added: number; already: number; noKey: number; noKeyNames: string[] },
  sync?: { url: string; lastAt?: string; lastResult?: string } | null,
  extra?: { industries: string; replyRules: { id: number; phrase: string; outcome: string; source: string }[]; share?: { sentPullUrl: string; pushUrl: string; member: string; lastPull: string; lastResult: string; sharedCount: number; configured: boolean; script: string } }
) {
  return `<h1>除外リスト</h1>
<div class="card"><h2 style="margin-top:0">送りたくない業種・キーワード</h2>
<p class="muted small" style="margin:0 0 8px">ここに書いた言葉が<b>会社名・業界・小業界</b>に含まれる会社には送りません（取り込みのときと、送信の直前に確認します）。1行に1つ、または読点区切り。例: 病院／クリニック／法律事務所／税理士／宗教／学校法人</p>
<form method="post" action="/suppressions/industries" data-busy>
<textarea name="industries" style="min-height:90px" placeholder="病院&#10;クリニック&#10;法律事務所">${esc(extra?.industries ?? "")}</textarea>
<p><button class="btn sub">保存する</button> <span class="muted small">官公庁・自治体・学校のドメイン（.go.jp / .lg.jp / .ac.jp / .ed.jp）は、設定に関係なく最初から除外しています。</span></p></form></div>
${extra?.replyRules?.length ? `<div class="card"><h2 style="margin-top:0">返信の自動判定が覚えた言い回し（${extra.replyRules.length}件）</h2>
<p class="muted small" style="margin:0 0 8px">自動判定を手で直したとき、その返信の言い回しを覚えています。次から同じ言い回しのメールは、直した側に振り分けます。おかしなものは削除してください。</p>
<table><tr><th>言い回し</th><th style="width:110px">振り分け</th><th style="width:160px">覚えた相手</th><th style="width:70px"></th></tr>
${extra.replyRules.map((r) => `<tr><td>${esc(r.phrase)}</td><td>${esc(OUTCOME_LABEL[r.outcome] ?? r.outcome)}</td><td class="small muted">${esc(r.source)}</td><td><form method="post" action="/reply-rules/${r.id}/delete" class="inline"><button class="btn sub small">削除</button></form></td></tr>`).join("")}
</table></div>` : ""}
${(() => {
    // チームで別々のPCに入れている場合、断りの会社を1つのスプレッドシートで共有して、各自が自動で取り込めるようにする
    const last = sync?.lastAt ? new Date(sync.lastAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
    return `<div class="card" style="background:var(--honey-50)"><h2 style="margin-top:0">共有の除外リスト（チームで同じNGリストを使う）</h2>
<p class="muted small" style="margin:0 0 10px">Googleスプレッドシートを1つ「共有NGリスト」に決めて、そのURLを登録すると、<b>1日1回そこから自動で取り込みます</b>（起動から2分後にも1回）。チームの全員が同じURLを登録すれば、誰かが追加した断り先が全員に行き渡ります。<br>シートは「リンクを知っている全員（閲覧可）」にし、1行目を見出し（会社名 / ドメイン / メール など）にしてください。</p>
<form method="post" action="/suppressions/sync-url" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
<input type="url" name="sheet_url" value="${esc(sync?.url ?? "")}" placeholder="https://docs.google.com/spreadsheets/d/…" style="flex:1;min-width:320px">
<button class="btn sub small">保存</button></form>
${sync ? `<form method="post" action="/suppressions/sync-now" style="margin-top:8px" data-busy><button class="btn sub small" data-busytext="取り込み中…">今すぐ取り込む</button> <span class="muted small">${last ? `最終取り込み: ${esc(last)}` : "まだ取り込んでいません"}${sync.lastResult ? ` ／ ${esc(sync.lastResult)}` : ""}</span></form>
<p class="muted small" style="margin:6px 0 0">解除するには、URLを空にして「保存」を押してください。</p>` : ""}</div>`;
  })()}
${extra?.share ? `<div class="card" style="background:var(--honey-50)"><h2 style="margin-top:0">チームで共有する（送信済み・除外の双方向）</h2>
<p class="muted small" style="margin:0 0 10px">
  <b>送信済みの共有</b>（#78）: 誰かが送った会社には、ほかのメンバーは送らなくなります（取り込み時と送信直前に確認）。<br>
  <b>除外の書き戻し</b>（#79）: 自分が追加した断り先を、共有シートへ自動で書き出します。<br>
  1つのGoogleスプレッドシートをチームで共有し、全員が同じURLを登録してください。1日1回（起動から3分後にも1回）同期します。
</p>
<form method="post" action="/share/settings">
<label>① 共有シートの「送信済み」を読むURL（スプレッドシートの共有URL）</label>
<input type="url" name="sent_pull_url" value="${esc(extra.share.sentPullUrl)}" placeholder="https://docs.google.com/spreadsheets/d/…">
<label>② 書き込み用のURL（Apps Script のウェブアプリURL）</label>
<input type="url" name="push_url" value="${esc(extra.share.pushUrl)}" placeholder="https://script.google.com/macros/s/…/exec">
<label>③ あなたの名前（誰が送ったか分かるように）</label>
<input type="text" name="member" value="${esc(extra.share.member)}" placeholder="例: 田中" style="max-width:260px">
<p style="margin-top:10px"><button class="btn sub">保存する</button>
${extra.share.configured ? `</form><form method="post" action="/share/sync-now" class="inline" data-busy><button class="btn sub" data-busytext="同期中…">今すぐ同期する</button></form>` : "</form>"}
</p>
${extra.share.lastResult ? `<p class="muted small">最終同期: ${esc(extra.share.lastPull)} ／ ${esc(extra.share.lastResult)}</p>` : ""}
${extra.share.sharedCount ? `<p class="small">共有リストに入っている「送信済みの会社」: <b>${extra.share.sharedCount}社</b></p>` : ""}
<details style="margin-top:10px"><summary style="cursor:pointer;font-weight:700">書き込み用URLの作り方（Apps Script のコード）</summary>
<ol class="small" style="line-height:1.9">
<li>共有に使うスプレッドシートを開き、「拡張機能 → Apps Script」を選ぶ</li>
<li>出てきたコード欄を全部消して、下のコードを貼り付けて保存する</li>
<li>右上の「デプロイ → 新しいデプロイ → 種類: ウェブアプリ」を選び、<b>アクセスできるユーザー: 全員</b> にしてデプロイ</li>
<li>表示された <code>https://script.google.com/macros/s/…/exec</code> を、上の②に貼る（チーム全員が同じURLを使います）</li>
</ol>
<textarea readonly style="min-height:220px;font-family:monospace;font-size:11px">${esc(extra.share.script)}</textarea>
</details></div>` : ""}
<p class="muted">ここに登録した会社には、全キャンペーンで送りません。営業お断りを検知した先は自動で追加されます。返信で「今後不要」と言われた先も必ず追加してください。</p>
${imported ? `<div class="flash">CSVを取り込みました: 追加 ${imported.added}件 / 登録済み ${imported.already}件${imported.noKey ? ` / 登録できず ${imported.noKey}件（ドメインもメールも無いため）: ${esc(imported.noKeyNames.join("、"))}` : ""}</div>` : ""}
<div class="card"><h2 style="margin-top:0">1件ずつ追加</h2>
<form method="post" action="/suppressions"><div class="row3">
<div><label>会社名</label><input type="text" name="company_name" placeholder="株式会社○○"></div>
<div><label>ドメイン または メールアドレス</label><input type="text" name="domain" placeholder="example.co.jp / info@example.co.jp" required></div>
<div><label>理由</label><input type="text" name="reason" placeholder="先方より連絡不要のご依頼"></div>
</div><p><button class="btn">追加</button></p></form></div>

<div class="card"><h2 style="margin-top:0">まとめて追加（貼り付け・スプレッドシート・CSV）</h2>
<p class="muted">1行1社。<b>URL・ドメインやメールアドレスだけを縦に貼るだけでOK</b>です（会社名は無くても登録できます）。<br>スプレッドシートからコピーした複数列（会社名・URL・メール・電話）もそのまま貼れます。1行目が見出し（会社名／ドメイン／メール 等）ならその列で読み、見出しが無ければ中身で自動判別します。<br>ドメインもメールも無い行（会社名だけ）は、送信を止める手がかりが無いため登録できません（その場合は会社名を一覧で出します）。</p>
<form method="post" action="/suppressions/import" enctype="multipart/form-data">
<label>① 貼り付け（スプレッドシート・Excel・メモ帳からコピー）</label>
<textarea name="pasted" style="min-height:120px" placeholder="example.co.jp&#10;https://www.sample.jp/&#10;info@test.co.jp&#10;株式会社○○	https://maru.co.jp"></textarea>
<div class="row"><div><label>② または Google スプレッドシートのURL</label><input type="url" name="sheet_url" placeholder="https://docs.google.com/spreadsheets/d/…"><p class="muted small">共有を「リンクを知っている全員（閲覧可）」にしてください。</p></div><div><label>③ または CSVファイル</label><input type="file" name="csv" accept=".csv,text/csv"></div></div>
<label>理由（理由の列が無い行に付けます）</label><input type="text" name="reason" placeholder="取引先のため送信対象外">
<p><button class="btn primary">取り込む</button></p></form>
<p class="muted small">除外リストはPCごとに独立しています。別のメンバーと共有したいときは、下のボタンでCSVに書き出し、相手はこの「CSVでまとめて追加」から取り込めます（列はそのまま合います）。</p>
${rows.length ? '<a class="btn sub" href="/suppressions/export.csv">除外リストをCSVで書き出す</a>' : ""}</div>

<table><tr><th>会社名</th><th>ドメイン</th><th>メール</th><th>電話</th><th>理由</th><th>登録</th><th></th></tr>${rows.length ? rows.map((r) => `<tr><td>${esc(r.company_name || "―")}</td><td>${esc(r.domain ?? "―")}</td><td class="small">${esc(r.email ?? "―")}</td><td class="small">${esc(r.tel || "―")}</td><td class="small">${esc(r.reason)}</td><td class="small">${esc(jst(r.created_at))}</td><td><form method="post" action="/suppressions/${r.id}/delete" class="inline"><button class="btn sub small">削除</button></form></td></tr>`).join("") : `<tr><td colspan="7" class="muted">まだ登録がありません。</td></tr>`}</table>
<h2>メール配信停止（アドレス単位）</h2><p class="muted">上の欄にメールアドレスを入れて追加すると、そのアドレス宛てのメールを停止します。返信で「配信停止」と言われた相手は必ず入れてください。</p>
<table><tr><th>メール</th><th>理由</th><th>登録</th></tr>${optouts.map((r) => `<tr><td>${esc(r.email)}</td><td>${esc(r.reason)}</td><td class="small">${esc(jst(r.created_at))}</td></tr>`).join("")}</table>`;
}

export function settingsView(ngWords: string[], ai: import("../message.js").AiConfig, stats?: { senders: number; campaigns: number; companies: number; sent: number; suppressions: number; optouts: number }, gameEnabled = false, notifyOn = true, aiBudget?: { usage: import("../message.js").AiUsage; limit: number }, license?: { status: import("../license.js").LicenseStatus; key: string; enforce: boolean }, opts?: { effects: boolean; notifyReply: boolean; dailySummary: boolean; todoHideDays: number; listPageSize: number; sendPace: string }) {
  // ライセンス（#90）
  const licenseCard = license ? `<div class="card"><h2 style="margin-top:0">ライセンス</h2>
<p>${license.status.state === "valid" ? `<span class="tag sent">有効</span>` : license.status.state === "expired" ? `<span class="tag failed">期限切れ</span>` : license.status.state === "invalid" ? `<span class="tag failed">キーが不正</span>` : `<span class="tag queued">未登録</span>`} ${esc(license.status.label)}</p>
<form method="post" action="/settings/license">
<label>ライセンスキー（配布元から受け取った APO1… で始まる1行）</label>
<input type="text" name="key" value="${esc(license.key)}" placeholder="APO1.xxxxx.xxxxx">
<p style="margin-top:8px"><button class="btn sub">保存する</button></p></form>
<form method="post" action="/settings/license-enforce" style="margin-top:6px">
<label style="display:flex;align-items:center;gap:8px;font-weight:400"><input type="checkbox" name="enforce" value="1" ${license.enforce ? "checked" : ""} onchange="this.form.submit()" style="width:auto">
ライセンスが無い・期限切れのときは、1日50件までに制限する</label></form>
<p class="muted small" style="margin:6px 0 0">チェックを外していれば、ライセンスの状態にかかわらず制限なく動きます（既定）。<br>キーには「宛先の会社名・台数・期限」だけが入っており、通信は行いません（オフラインで確認します）。</p></div>` : "";

  // AIの使用量と上限（#66）。「いくらかかるか読めない」のが不安でAIを使えない、という状態をなくす
  const budgetCard = aiBudget ? `<div class="card"><h2 style="margin-top:0">AIの利用料と上限</h2>
<div class="stats"><div class="stat"><span class="muted small">今月の目安</span><b>${Math.round(aiBudget.usage.jpy).toLocaleString("ja-JP")}円</b></div>
<div class="stat"><span class="muted small">AIを使った回数</span><b>${aiBudget.usage.calls.toLocaleString("ja-JP")}<span class="unit">回</span></b></div>
</div>
<details class="small" style="margin-top:6px"><summary style="cursor:pointer;color:var(--c-ink-3)">内訳（AIに送った文字量）</summary><p class="small" style="margin:6px 0 0">AIに渡した量: ${Math.round(aiBudget.usage.input / 1000).toLocaleString("ja-JP")}千トークン／AIが書いた量: ${Math.round(aiBudget.usage.output / 1000).toLocaleString("ja-JP")}千トークン（トークン＝AIの料金を数える単位。日本語ではおよそ1文字）</p></details>
<form method="post" action="/settings/ai-budget" style="margin-top:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
<label style="margin:0">今月の上限（円・0で制限なし）</label>
<input type="number" name="limit" value="${aiBudget.limit}" min="0" step="100" style="width:140px">
<button class="btn sub small">保存</button></form>
<p class="muted small" style="margin:8px 0 0">上限に達すると、AIを使わずテンプレートの文面で送り続けます（送信は止まりません）。金額は1Mトークンあたりの目安単価から計算した<b>概算</b>です。正確な請求額は各社の管理画面でご確認ください。</p></div>` : "";
  const configured = ai.provider !== "none";
  // データの概要: 集計して表示するだけの追加カード。このブロックを消せば丸ごと外せる
  const overview = stats
    ? `<div class="card"><h2 style="margin-top:0">データの概要</h2>
<p class="muted">このPCに保存されている件数のまとめです（あなたが見られる範囲）。</p>
<div class="stats"><div class="stat">送信者<b>${stats.senders}</b></div><div class="stat">キャンペーン<b>${stats.campaigns}</b></div><div class="stat">登録企業<b>${stats.companies}<span style="font-size:12px;font-weight:400">社</span></b></div><div class="stat">送信済み<b style="color:var(--ok)">${stats.sent}</b></div><div class="stat">除外リスト<b>${stats.suppressions}</b></div><div class="stat">配信停止<b>${stats.optouts}</b></div></div></div>`
    : "";
  const models = (p: "anthropic" | "gemini") => AI_MODELS[p].map((m) => `<option value="${m.id}" data-p="${p}" ${ai.model === m.id ? "selected" : ""}>${esc(m.label)}</option>`).join("");
  return `<h1>設定</h1>
${overview}${budgetCard}${licenseCard}
<div class="card"><h2 style="margin-top:0">送信が止まったときの通知</h2>
<p class="muted small">メール送信が一時停止したとき・送信が全部終わったとき・止まっていた送信を自動再開したときに、<b>パソコンの通知</b>（Macは通知センター、Windowsはトースト）でお知らせします。画面を見ていなくても気づけます。</p>
<form method="post" action="/settings/notify" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><select name="notify_desktop" style="width:auto"><option value="1" ${notifyOn ? "selected" : ""}>通知する</option><option value="0" ${notifyOn ? "" : "selected"}>通知しない</option></select><button class="btn sub small">保存</button></form>
<form method="post" action="/settings/notify-test" style="margin-top:8px"><button class="btn sub small">テスト通知を出す</button></form>
<form method="post" action="/settings/notify-kinds" style="margin-top:14px;border-top:1px solid var(--c-line);padding-top:12px">
<label style="display:flex;gap:8px;align-items:center;font-weight:400;margin:4px 0"><input type="checkbox" name="notify_reply" value="1" ${opts?.notifyReply ? "checked" : ""} style="width:auto">アポ・返信が来たら、すぐに知らせる</label>
<label style="display:flex;gap:8px;align-items:center;font-weight:400;margin:4px 0"><input type="checkbox" name="daily_summary" value="1" ${opts?.dailySummary ? "checked" : ""} style="width:auto">1日の終わり（送信時間帯の終了時）に、その日のまとめを知らせる</label>
<button class="btn small" style="margin-top:6px">保存</button></form></div>
<div class="card"><h2 style="margin-top:0">一覧と要対応</h2>
<form method="post" action="/settings/lists" class="row">
<div><label>要対応を「見送り」に移すまでの日数</label><input type="number" name="todo_hide_days" value="${opts?.todoHideDays ?? 30}" min="1" max="365"></div>
<div><label>送信一覧の1ページの件数</label><select name="list_page_size">${[50, 100, 200].map((v) => `<option value="${v}" ${(opts?.listPageSize ?? 100) === v ? "selected" : ""}>${v}件</option>`).join("")}</select></div>
<p style="grid-column:1/-1;margin:0"><button class="btn small">保存</button></p></form></div>
<div class="card"><h2 style="margin-top:0">AIモード設定</h2>
<p>現在: ${configured ? `<span class="tag sent">設定済み</span> <b>${ai.provider === "anthropic" ? "Claude" : "Gemini"} / ${esc(ai.model)}</b>${ai.source === "env" ? ' <span class="muted small">（環境変数から読み込み）</span>' : ""}` : '<span class="tag">未設定（AI: none）</span> <span class="muted">テンプレートのみで動いています。AIを使わなくても送信はできます。</span>'}</p>

<details ${configured ? "" : "open"} style="margin:10px 0"><summary style="cursor:pointer;font-weight:700">はじめての方へ: APIキーとは？ 料金はいくら？（クリックで開く）</summary>
<div style="padding:10px 4px">
<p><b>APIキーとは。</b> ChatGPTやClaude.aiのように「会員登録して画面から使う」サービスとは別に、このツールが直接AIを呼び出すための<b>利用者ごとの認証キー</b>です。長い文字列で、発行した本人（または会社）の支払い方法に、<b>使った分だけ課金</b>されます。月額ではなく従量課金です。</p>
<p><b>料金の目安。</b> フォーム1件あたり入力1,000トークン＋出力300トークン程度を想定した概算です。</p>
<table style="max-width:560px"><tr><th>モデル</th><th>1件あたり</th><th>月1,000件</th><th>月10,000件</th></tr>
<tr><td>Claude Haiku</td><td>約0.4円</td><td>約400円</td><td>約4,000円</td></tr>
<tr><td>Claude Sonnet</td><td>約0.8円</td><td>約800円</td><td>約8,000円</td></tr>
<tr><td>Gemini Flash-Lite</td><td>約0.2円</td><td>約200円</td><td>約2,000円</td></tr>
<tr><td>Gemini Flash</td><td>約0.3円</td><td>約300円</td><td>約3,000円</td></tr></table>
<p class="muted small">2026年9月時点の各社公式レート・1ドル=154円換算の概算です。実際の送信件数やフォームの複雑さで変動します。</p>
<p><b>キーの取得手順。</b></p>
<ul class="small">
<li><b>Claude:</b> <a href="https://console.anthropic.com" target="_blank">console.anthropic.com</a> でアカウント作成 → 支払い方法を登録 → 左メニュー「API Keys」から発行（<code>sk-ant-</code>で始まる文字列）</li>
<li><b>Gemini:</b> <a href="https://aistudio.google.com" target="_blank">aistudio.google.com</a> にGoogleアカウントでログイン →「Get API key」から発行（<code>AIza</code>で始まる文字列）</li>
</ul>
<p><b>${IC_WARN} 注意</b></p>
<ul class="small">
<li>キーは<b>他人・他の拠点と共有しない</b>でください。共有相手の利用分もあなたに課金されます。拠点ごとに各自のキーを発行してください</li>
<li>各社の管理画面で<b>利用上限（スペンドリミット）</b>を設定できます。使いすぎ防止に、最初に設定しておくのがおすすめです</li>
<li>キーはこのPCの <code>data/</code> フォルダ内にだけ保存され、配布物やGitHubには含まれません</li>
</ul>
</div></details>

<form method="post" action="/settings/ai">
<div class="row3">
<div><label>AIプロバイダ</label><select name="provider" id="ai-provider" onchange="foAiModels()">
<option value="anthropic" ${ai.provider !== "gemini" ? "selected" : ""}>Claude（Anthropic）</option>
<option value="gemini" ${ai.provider === "gemini" ? "selected" : ""}>Gemini（Google）</option>
</select></div>
<div><label>モデル</label><select name="model" id="ai-model">${models("anthropic")}${models("gemini")}</select></div>
<div><label>APIキー ${configured && ai.source === "settings" ? '<span class="muted small">（保存済み。変えるときだけ入力）</span>' : ""}</label><input type="password" name="api_key" placeholder="${configured && ai.source === "settings" ? "••••••••（保存済み）" : "sk-ant-… / AIza…"}" autocomplete="off"></div>
</div>
<p><button class="btn">保存して接続テスト</button> <span class="muted small">保存すると、実際にAIを1回呼んで接続を確認します</span></p>
</form>
${configured && ai.source === "settings" ? `<form method="post" action="/settings/ai/delete" class="inline" onsubmit="return confirm('AI設定を削除しますか？ テンプレートのみの動作に戻ります')"><button class="btn danger small">AI設定を削除する</button></form>` : ""}
<script>
function foAiModels(){const p=document.getElementById("ai-provider").value;const sel=document.getElementById("ai-model");let first=null;let cur=sel.selectedOptions[0];
for(const o of sel.options){const show=o.dataset.p===p;o.hidden=!show;o.disabled=!show;if(show&&!first)first=o;}
if(!cur||cur.dataset.p!==p)sel.value=first.value;}
foAiModels();
</script></div>

<div class="card"><h2 style="margin-top:0">NGワード（1行1語）</h2><form method="post" action="/settings"><textarea name="ng_words">${esc(ngWords.join("\n"))}</textarea><p><button class="btn primary">保存</button></p></form></div>

<div class="card"><h2 style="margin-top:0">データのバックアップ</h2>
<p class="muted">送信者・キャンペーン・送信履歴を1つのファイル（JSON）に書き出します。PCの買い替え前や、記録の保管にどうぞ。安全のため、SMTPのアプリパスワードとAIのAPIキーは含みません。<b>書き出しのみで、読み込み（復元）機能はありません。</b></p>
<a class="btn sub" href="/backup.json">バックアップを書き出す</a></div>`;
}

/** ユーザー管理（管理者のみ） */
/** 他の人のPCから開くURL（ユーザー管理に表示）。アドレス欄の localhost のリンクは相手のPCでは開けないため */
export function shareUrlsCard(urls: string[]): string {
  if (!urls.length) return "";
  return `<div class="card"><h2 style="margin-top:0">他の人のPCから開くには</h2>
<p class="small" style="margin:0 0 4px">アドレス欄の <code>localhost</code> のリンクを送ると、相手のPCでは「サーバーに接続できません」になります。同じWi-Fi・社内ネットワークにいる人には、次のURLを伝えてください（おまけゲームは出ない版）。発行したログインIDと一緒に送ると便利です。</p>
${urls.map((u) => `<p style="margin:4px 0;display:flex;gap:8px;align-items:center;flex-wrap:wrap"><code style="user-select:all">${esc(u)}</code><button type="button" class="btn sub small" onclick="(navigator.clipboard?navigator.clipboard.writeText('${esc(u)}'):Promise.reject()).then(()=>{this.textContent='コピーしました'}).catch(()=>{prompt('このURLをコピーしてください','${esc(u)}')})">コピー</button></p>`).join("")}
<p class="muted small" style="margin:6px 0 0">※ このPCの電源が入っていて、ApoBoostが起動している間だけ開けます。1つ目（PC名）のURLで開けない場合は、数字のURLを使ってください（数字はWi-Fiにつなぎ直すと変わることがあります）。社外の人や、別のネットワーク（ゲストWi-Fi・テザリング等）からは開けません。</p></div>`;
}

export function usersView(users: { id: number; username: string; display_name: string; role: string; active: number; last_login_at: string | null; created_at: string }[], issued?: { username: string; password: string }, shareUrls: string[] = []): string {
  return `<h1>ユーザー管理</h1>
${issued ? `<div class="card" style="border-color:var(--honey);background:var(--honey-50)">
<b>アカウントを発行しました。この内容をご本人に伝えてください（パスワードは今だけ表示されます）</b>
<table style="margin-top:8px"><tr><th>ログインID</th><td><code style="font-size:15px">${esc(issued.username)}</code></td></tr>
<tr><th>初期パスワード</th><td><code style="font-size:15px">${esc(issued.password)}</code></td></tr></table>
<p class="muted">初回ログイン時に本人がパスワードを変更する画面になります。</p></div>` : ""}
<div class="card"><h2 style="margin-top:0">＋ アカウントを発行する</h2>
<div class="muted small" style="background:var(--honey-50);border:1px solid var(--honey);border-radius:8px;padding:10px 12px;margin-bottom:12px">
<b>権限の違い</b><br>
・<b>一般</b>：自分が作った<b>キャンペーン・送信者・送信履歴だけ</b>が見え、操作できます。他の人のデータや、ユーザー管理・設定（AIキー／NGワード）は見えません。日々の営業担当はこちら。<br>
・<b>管理者</b>：<b>全ユーザーのデータ</b>が見え、<b>アカウントの発行・停止・パスワード再発行</b>や<b>設定（AIキー・NGワード）の変更</b>ができます。運用の責任者だけに付けてください。<br>
※「営業お断り」の除外リストは、事故防止のため<b>全員で共通に突合</b>されます（各自の画面に出るのは自分が登録した分だけです）。
</div>
<form method="post" action="/users">
<div class="row3">
<div><label>ログインID（半角英数字）</label><input name="username" placeholder="tanaka" required></div>
<div><label>表示名</label><input name="display_name" placeholder="田中商事 田中様"></div>
<div><label>権限</label><select name="role"><option value="user">一般（自分のデータだけ見える）</option><option value="admin">管理者（全部見える・ユーザー発行可）</option></select></div>
</div>
<label>初期パスワード（空欄なら自動生成）</label><input name="password" placeholder="空欄で自動生成">
<p><button class="btn primary">発行する</button></p>
</form></div>
<h2>アカウント一覧</h2>
<table><tr><th>ID</th><th>ログインID</th><th>表示名</th><th>権限</th><th>状態</th><th>最終ログイン</th><th></th></tr>
${users.map((u) => `<tr>
<td>${u.id}</td>
<td><form method="post" action="/users/${u.id}/username" class="inline" style="display:flex;gap:4px;align-items:center" onsubmit="return confirm('ログインIDを変更します。本人に新しいIDを伝えてください。よろしいですか？')"><input type="text" name="username" value="${esc(u.username)}" pattern="[a-zA-Z0-9._-]{3,32}" title="半角英数字・._- の3〜32文字" style="width:150px;padding:3px 6px;font-family:inherit"><button class="btn sub small">変更</button></form></td>
<td>${esc(u.display_name)}</td>
<td>${u.role === "admin" ? "管理者" : "一般"}</td>
<td>${u.active ? '<span class="tag sent">有効</span>' : '<span class="tag">停止中</span>'}</td>
<td class="small">${esc(jst(u.last_login_at) || "―")}</td>
<td class="small">
<form method="post" action="/users/${u.id}/reset" class="inline" onsubmit="return confirm('パスワードを再発行します。よろしいですか？')"><button class="btn sub small">パスワード再発行</button></form>
<form method="post" action="/users/${u.id}/toggle" class="inline"><button class="btn sub small">${u.active ? "停止する" : "再開する"}</button></form>
</td></tr>`).join("")}
</table>
<p class="muted">ログインIDは、その場で書き換えて「変更」を押せば変えられます（本人に新しいIDを伝えてください。パスワードとデータはそのままです）。停止したアカウントはログインできなくなります（データは残ります）。一般ユーザーは自分が作ったキャンペーン・送信者・送信履歴だけが見えます。「営業お断り」の除外リストは安全のため全ユーザー共通で突合されます（画面に出るのは自分が登録した分だけです）。</p>`;
}

/** アップデート画面（管理者のみ） */
export function updateView(st: { current: string; latest?: string; notes?: string; available: boolean; configured: boolean; error?: string }, result?: { ok: boolean; log: string[]; version?: string; error?: string }, channel: "stable" | "beta" = "stable"): string {
  return `<h1>アップデート</h1>
<div class="card"><h2 style="margin-top:0">受け取る版</h2>
<form method="post" action="/settings/update-channel" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
<label class="inline" style="font-weight:400"><input type="radio" name="channel" value="stable" ${channel === "stable" ? "checked" : ""} onchange="this.form.submit()" style="width:auto"> 安定版（おすすめ）</label>
<label class="inline" style="font-weight:400"><input type="radio" name="channel" value="beta" ${channel === "beta" ? "checked" : ""} onchange="this.form.submit()" style="width:auto"> 先行版（新しい機能を先に試す）</label>
</form>
<p class="muted small" style="margin:8px 0 0">配布元は、まず先行版で出して問題がないことを確かめてから安定版にします。他社に渡したPCは「安定版」のままにしてください。</p></div>
${result ? `<div class="card" style="border-color:${result.ok ? "var(--ok)" : "var(--ng)"}">
<b>${result.ok ? `v${esc(result.version ?? "")} に更新しました` : `更新できませんでした: ${esc(result.error ?? "")}`}</b>
<pre style="white-space:pre-wrap;font-size:12px;margin:8px 0 0">${esc(result.log.join("\n"))}</pre>
${result.ok ? `<p class="muted">数秒後に自動で再起動します。画面が真っ白になったら、少し待ってから再読み込みしてください。</p>` : ""}
</div>` : ""}
<div class="card">
<table>
<tr><th style="width:170px">いま使っている版</th><td><b>v${esc(st.current)}</b></td></tr>
${st.configured ? `<tr><th>公開されている最新版</th><td>${st.latest ? `<b>v${esc(st.latest)}</b>` : "―"}</td></tr>` : ""}
${st.notes ? `<tr><th>更新内容</th><td>${esc(st.notes)}</td></tr>` : ""}
</table>
${st.error ? `<p style="color:var(--ng)">${esc(st.error)}</p>` : ""}
${!st.configured
  ? `<p class="muted">更新の確認先が設定されていません。配布元にお問い合わせください。<br>（設定する場合はフォルダ内の <code>update.json</code> の <code>manifest_url</code> を書き換えます）</p>`
  : st.available
    ? `<form method="post" action="/update"><p><button class="btn">v${esc(st.latest ?? "")} に更新する</button></p></form>
       <p class="muted">送信中のキャンペーンがあれば、先に一時停止してから実行してください。営業リスト・送信履歴・アカウントはそのまま残ります。</p>`
    : `<p class="muted">最新版です。</p>`}
<form method="post" action="/update/check" class="inline"><button class="btn sub">いま確認する</button></form>
</div>`;
}

// ---- 動作チェック（#42）----
// 「動かない」の原因を利用者自身が切り分けられる画面。ここからエラーログ・診断ファイル・バックアップにも行ける
export type HealthCheck = { level: "ok" | "warn" | "ng"; label: string; detail: string; fix?: string };

export type HealthState = {
  autostart: { supported: boolean; enabled: boolean; path: string };
  autoUpdate: boolean;
  awakeNote: string;
  logs: { errors24h: number; total: number };
  backups: { file: string; label: string }[];
  backupDir: string;
  isAdmin: boolean;
};

export function healthView(checks: HealthCheck[], st: HealthState): string {
  const mark = (l: HealthCheck["level"]) =>
    l === "ok" ? `<span class="tag sent">○ 問題なし</span>` : l === "warn" ? `<span class="tag queued">△ 確認</span>` : `<span class="tag failed">× 要対応</span>`;
  const ng = checks.filter((c) => c.level === "ng").length;
  const warn = checks.filter((c) => c.level === "warn").length;
  return `<h1>動作チェック</h1>
<div class="card">
  <p>${ng ? `<b style="color:var(--ng)">要対応が ${ng}件</b>あります。` : warn ? `すぐ使えますが、確認した方がよい項目が ${warn}件あります。` : "すべて問題ありません。"}
  うまく動かないときは、この画面と<a href="/logs">エラーログ</a>を見てください。</p>
  <p class="muted">解決しない場合は、<a href="/diagnostics.txt">診断ファイルをダウンロード</a>して配布元に送ってください（パスワード・APIキーは入っていません）。</p>
</div>
<table>
  <tr><th style="width:110px">結果</th><th style="width:200px">項目</th><th>状態</th></tr>
  ${checks.map((c) => `<tr><td>${mark(c.level)}</td><td><b>${esc(c.label)}</b></td><td>${esc(c.detail)}${c.fix ? `<div class="muted">→ ${esc(c.fix)}</div>` : ""}</td></tr>`).join("")}
</table>

<h2>止まらないようにする設定</h2>
<div class="card">
  <form method="post" action="/settings/autostart" class="inline" data-busy>
    <label style="display:flex;align-items:center;gap:8px;font-weight:600">
      <input type="checkbox" name="autostart" value="1" ${st.autostart.enabled ? "checked" : ""} onchange="this.form.submit()" ${st.autostart.supported && st.isAdmin ? "" : "disabled"} style="width:auto">
      パソコンのログイン時に自動で起動する
    </label>
  </form>
  <p class="muted">オンにすると、パソコンを起動・再起動したあとに自分で立ち上げる必要がなくなります（起動し忘れ・黒い画面を閉じて止まる事故を防げます）。${st.autostart.supported ? "" : "このOSでは対応していません。"}${st.autostart.enabled && st.autostart.path ? `<br>設定ファイル: <code>${esc(st.autostart.path)}</code>` : ""}</p>
  <p class="muted">スリープ対策: ${esc(st.awakeNote)}</p>
  <hr style="border:0;border-top:1px solid var(--hive-200);margin:12px 0">
  <form method="post" action="/settings/auto-update" class="inline" data-busy>
    <label style="display:flex;align-items:center;gap:8px;font-weight:600">
      <input type="checkbox" name="auto_update" value="1" ${st.autoUpdate ? "checked" : ""} onchange="this.form.submit()" ${st.isAdmin ? "" : "disabled"} style="width:auto">
      新しい版が出たら自動で更新する
    </label>
  </form>
  <p class="muted">オンにすると、起動時と6時間ごとに確認して自動で最新にします（送信中の会社は送り終わってから。更新前にバックアップを取ります）。オフの場合は、画面右上の「新しい版があります」を押して更新してください。</p>
</div>

<h2>バックアップ</h2>
<div class="card">
  <p>1日1回、送信履歴やリストを含むデータを自動で複製しています（7世代）。保存先: <code>${esc(st.backupDir)}</code></p>
  <form method="post" action="/backup/create" class="inline" data-busy data-busytext="作成中…"><button class="btn sub">いますぐバックアップを取る</button></form>
  <a class="btn sub" href="/backup.json">閲覧用の書き出し（JSON）</a>
  ${st.backups.length ? `
  <h2 style="font-size:14px">復元</h2>
  <form method="post" action="/backup/restore" data-busy data-busytext="復元の準備中…" onsubmit="return confirm('選んだバックアップの内容に戻します。いまのデータは data/backups に退避します。よろしいですか？')">
    <select name="file">${st.backups.map((b) => `<option value="${esc(b.file)}">${esc(b.label)}</option>`).join("")}</select>
    <p class="muted">復元すると、いまの送信履歴・リストはバックアップ時点の内容に置き換わります。押すとアプリが再起動します（送信中の会社は送り終わってから）。</p>
    <button class="btn danger" ${st.isAdmin ? "" : "disabled"}>選んだバックアップから復元する</button>
    ${st.isAdmin ? "" : `<span class="muted">復元は管理者のみ</span>`}
  </form>` : `<p class="muted">まだバックアップがありません。</p>`}
</div>

<h2>困ったときの道具</h2>
<div class="card">
  <p><a class="btn sub" href="/logs">エラーログを見る${st.logs.errors24h ? `（24時間で ${st.logs.errors24h}件）` : ""}</a>
  <a class="btn sub" href="/diagnostics.txt">診断ファイルをダウンロード</a>
  <a class="btn sub" href="/template.csv">リストの見本CSV</a>
  <a class="btn sub" href="/guide">ご利用ガイド</a></p>
  <p class="muted">診断ファイルには、版・OS・設定の有無・直近のエラーが入ります。パスワードやAPIキー、送信先の会社名以外の個人情報は含みません。</p>
</div>`;
}

// ---- エラーログ（#33）----
// これまでは黒い画面を見るしかなく、閉じてしまうと何が起きたか分からなかった
export type LogRow = { id: number; at: string; kind: string; source: string; company: string; text: string };

export function logsView(rows: LogRow[], kind: string, counts: { errors24h: number; total: number }): string {
  const tab = (k: string, label: string) => `<a class="btn ${kind === k ? "" : "sub"}" href="/logs${k ? `?kind=${k}` : ""}">${label}</a>`;
  const kindTag = (k: string) => k === "error" ? `<span class="tag failed">エラー</span>` : k === "warn" ? `<span class="tag queued">注意</span>` : `<span class="tag">記録</span>`;
  return `<h1>エラーログ</h1>
<div class="card">
  <p>アプリの中で起きたことを、新しい順に最大500件まで残しています（直近24時間のエラー: <b>${counts.errors24h}</b>件）。</p>
  <p>${tab("", "すべて")} ${tab("error", "エラーだけ")} ${tab("warn", "注意だけ")}
    <a class="btn sub" href="/health">動作チェックに戻る</a>
    <a class="btn sub" href="/diagnostics.txt">診断ファイル</a></p>
  <p class="muted">原因が分からないときは、診断ファイルをダウンロードして配布元に送ってください。ここの内容もその中に入ります。</p>
</div>
${rows.length ? `<table>
  <tr><th style="width:120px">日時</th><th style="width:80px">種類</th><th style="width:90px">場所</th><th>内容</th></tr>
  ${rows.map((r) => `<tr><td class="small">${esc(jst(r.at))}</td><td>${kindTag(r.kind)}</td><td class="small">${esc(r.source)}</td><td>${r.company ? `<b>${esc(r.company)}</b>: ` : ""}${esc(r.text)}</td></tr>`).join("")}
</table>
<form method="post" action="/logs/clear" style="margin-top:12px" onsubmit="return confirm('ログを全部消します。よろしいですか？')"><button class="btn sub small">ログを消す</button></form>`
  : `<div class="card"><p>まだ記録はありません。問題なく動いています。</p></div>`}`;
}
