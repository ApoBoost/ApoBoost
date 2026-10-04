// はじめの設定・法律の確認・導入チェックリスト・ご利用ガイド
import { STATUS_LABEL, OUTCOME_LABEL, CHANNEL_LABEL, channelMode, jst, type Campaign, type Job, type SenderProfile, type JobStatus } from "../db.js";
import { AI_MODELS, type Lint } from "../message.js";
import { TEMPLATE_LIBRARY } from "../templates.js";
import { esc, layout, n, type NavUser, IC_CHECK } from "./layout.js";
import { post } from "./parts.js";
import { AI_KEY_HELP } from "./settings.js";

/** ミニゲーム「アポスロット」＝ ネオアイムジャグラーEX 準拠のリール制御シミュレータ。
 *  利用者提供の筐体イラストを土台に、リール・停止ボタン・レバー・表示・GOGOランプを座標で重ねる
 *  （座標は元画像 967×1627 基準、--s で拡縮）。
 *  - 3リール各21コマ＝実機と同じ配列。最大4コマ引き込み・成立役以外は揃えない「蹴飛ばし」制御。
 *  - 図柄画像: 7=seven.png / BAR=bar.png / ベル=bell.png / ピエロ=pierrot.png（無い場合は絵文字で代替）。
 *    ブドウ🍇・チェリー🍒・リプレイ🔄 は絵文字（画像に差し替え可）。
 *  - GOGO!ランプが光ったら（ぺかったら）7を「目押し」で狙う。押し位置から4コマ以内なら引き込む。
 *  - BARと7が枠内に並べば「リーチ目」。BIG=7・7・7 / REG=7・7・BAR・BAR・BAR。
 *  - 内部抽選は設定6の65536分母テーブル。クレジットはフォーム送信数から（1送信=1枚、BET3）。 */
/** 初めて使う人向けの「ご利用ガイド」。上から順に進めれば送信まで行けるようにする。
 *  画面のボタン名・見出しと言葉をそろえること（違うと探せない） */
export function guideView(isAdmin: boolean): string {
  const step = (n: string, title: string, body: string, link = "") => `<div class="card" id="step-${title === "営業リストを取り込む" ? "list" : n}" style="position:relative;padding-left:64px"><div style="position:absolute;left:16px;top:16px;width:34px;height:34px;border-radius:50%;background:var(--c-brand);color:var(--c-brand-ink);font-weight:800;display:flex;align-items:center;justify-content:center">${n}</div><h2 style="margin-top:0">${title}</h2>${body}${link}</div>`;
  // ガイドを見ながら操作できるよう、ガイド内のリンクは別タブで開く
  const go = (href: string, label: string) => `<p style="margin:10px 0 0"><a class="btn sub small" href="${href}" target="_blank" rel="noopener">${label} ↗</a></p>`;
  return `<h1>ご利用ガイド</h1>
<div class="card" style="background:var(--honey-50);border-color:var(--honey)">
<b>初めての方へ</b>：<a href="/setup" target="_blank" rel="noopener">はじめの設定（6ステップ）↗</a> を上から順に進めれば、送信を開始できます。
うまく動かないときは <a href="/health" target="_blank" rel="noopener">動作チェック ↗</a>、送れなかった会社は <a href="/todo" target="_blank" rel="noopener">要対応 ↗</a> にまとまっています。
</div>
<p class="muted">ApoBoostは、問い合わせフォームとメールへの営業送信を自動で行うツールです。初めての方は、<b>上から順番に</b>進めてください。各画面にも説明が書いてあります。</p>
<div class="card" style="background:var(--honey-50)"><b>全体の流れ</b>
<ol style="margin:6px 0 0;padding-left:1.3em;line-height:1.9"><li>送信者を登録</li><li>（任意）除外リストを登録</li><li>キャンペーンを作る</li><li>営業リストを取り込む</li><li>本送信を開始</li><li>結果と反応を確認</li></ol></div>

${step("1", "送信者を登録する", `<p>フォームに入力する「あなたの会社・担当者の情報」です。キャンペーンを作る前に必ず登録します。</p>
<ul style="line-height:1.8;margin:0;padding-left:1.2em"><li>会社名・担当者名（例: 田中 太郎）・担当者名フリガナ（例: タナカ タロウ）・メール・電話・住所・会社URL</li>
<li><b>メールでも送る場合</b>は「メールで送る場合の設定」に、送信用のGmail（Google Workspace）アドレスと<b>アプリパスワード</b>を入れ、「メール設定を確認」でOKになるか確かめます。<br><span class="muted small">アプリパスワードは <a href="https://myaccount.google.com/signinoptions/twosv" target="_blank" rel="noopener">2段階認証プロセス</a>（オンにする）→ <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener">アプリパスワード</a> で作る英小文字16文字です（普段のログインパスワードではありません）。リンクは別タブで開きます。Google Workspace で「アプリパスワード」が出ない場合は、会社の管理者に2段階認証の許可を依頼してください。</span></li>
<li>メールで送る場合は<b>住所が必須</b>です（営業メールには送信者の名称・住所・配信停止の連絡先の表示が法律で必要なため、メールの末尾に自動で載ります）</li>
<li>「受信箱を読んで…自動で記録する」をオンにすると、送信用メールの受信箱を15分ごとに読み、返信や届かなかったメールを自動で記録します。個人のメールと兼用している場合はオフに</li>
<li>電話番号をフォームの必須欄だけに入れたい場合は、チェックで選べます</li></ul>`, go("/senders", "送信者ページを開く"))}

${step("2", "（任意）除外リストを登録する", `<p>既存のお客様や「送ってはいけない会社」を先に登録しておくと、取り込んでも送られません。スプレッドシートからの貼り付け・URL・CSVでまとめて登録できます。</p>
<p class="muted small">「営業お断り」と書かれたサイトや、配信停止・断りの返信があった会社は、自動でここに追加されます。</p>`, go("/suppressions", "除外リストを開く"))}

${step("3", "キャンペーンを作る", `<p>「この文面で、この会社たちに、この送り方で送る」という送信のまとまりです。</p>
<ul style="line-height:1.8;margin:0;padding-left:1.2em"><li><b>送信者</b>：手順1で登録したもの。メールの差出人・フォームの入力内容はこの送信者になります</li>
<li><b>送り方</b>：フォーム優先（無ければメール）／メール優先（無ければフォーム）／メールのみ／フォームのみ</li>
<li><b>文面</b>：「テンプレートのみ」は無料。AIを使うモードは設定画面でAIキーを登録した場合だけ選べ、AIの料金がかかります</li>
<li><b>1日の上限・送信時間帯</b>：メールは少なめに（作ったばかりのGmailは1日50〜100通から）。深夜の連続送信はアカウント停止の原因になります</li>
<li><b>資料</b>：重いPDFの添付より、Googleドライブ等の公開リンクがおすすめ（「メールの本文にもこのリンクを載せる」にチェック）</li>
<li><b>グループ</b>：フォーム用とメール用などに分けたキャンペーンで、同じ会社に重ねて送らないようにできます</li></ul>`, go("/campaigns/new", "新しいキャンペーンを作る"))}

${step("4", "営業リストを取り込む", `<p>キャンペーン画面の「1. リストを取り込む」から、CSV・Excel・貼り付け・Googleスプレッドシートのどれかで取り込みます。<b>最低限「企業名」と「企業URL」の2列</b>があればOKです（メールで送るなら「メール」列も）。</p>
<ul style="line-height:1.8;margin:0;padding-left:1.2em"><li>取り込む前にプレビューが出ます。列がずれていないか確認して「この内容で取り込む」</li>
<li>除外リストの会社・90日以内に送った会社・同じグループで登録済みの会社は、自動で「送らない」に振り分けられます</li>
<li>社名に「株式会社」などが無い場合は、送る直前に会社のHPから自動で補います（無料）</li>
<li>間違えて取り込んだら、「取り込み履歴」の「全件削除」でその回の分をまとめて消せます</li>
<li>フォームで送る場合は「事前チェックを実行」で、フォームの有無・営業お断り・画像認証を送る前に確認できます（任意）</li></ul>
<div style="margin-top:14px;padding:12px 14px;background:var(--honey-50);border:1px solid var(--honey);border-radius:10px">
<b>取り込む前に、AIでリストを整える（おすすめ）</b>
<p class="small" style="margin:6px 0">リストのURLが古い・トップページしか無い・営業お断りの会社が混ざっている、などが原因で「フォーム無し」「失敗」が多くなります。<b>ChatGPT・Claude・Gemini など、Webを閲覧できるAI</b>に、下の文章と営業リスト（ファイル添付か貼り付け）を一緒に入力してください。出てきた表をスプレッドシートに貼り付けて、そのまま取り込めます。</p>
<textarea id="fo-listprompt" readonly style="min-height:220px;font-size:12px;line-height:1.6">あなたは営業リストの整備担当です。添付（または下に貼り付けた）企業リストを、問い合わせフォーム・メールへの営業送信に使えるように整えてください。

【必ず守ること】
・各社の公式サイトを実際に開いて確認してください。確認できなかった項目は推測で埋めず、空欄にしてください（存在しないURLやメールアドレスを作らないこと）。
・件数が多い場合は50社ずつ処理し、途中で止まったら続きから再開してください。

【各社について確認・修正すること】
1. 企業名：正式な社名にする（「株式会社」「有限会社」「合同会社」などの法人格を省略しない。前株・後株も公式の表記どおり）。
2. 企業URL：その会社の公式サイトのトップページ（https:// から始まるURL）。求人サイト・ポータルサイト・SNS・地図サイトのURLは使わない。
3. 問い合わせフォーム：公式サイト内の、実際に入力欄がある「お問い合わせ」ページのURL。
　・採用応募・資料請求専用・個人向けサポート・FAQ・ログインが必要なページは不可。
　・フォームが外部サービス（Googleフォーム、formrun など）に置かれている場合は、そのURLでよい。
　・フォームが見つからなければ空欄。
4. メール：公式サイトに掲載されている問い合わせ用・代表のメールアドレス（info@ など）。個人のアドレスや採用専用のアドレスは避ける。無ければ空欄。
5. 大業界・小業界・都道府県・代表者名：公式サイトの会社概要で分かれば入れる。

【リストから除外する会社（表に出さない）】
・サイトやフォームに「営業目的のお問い合わせはご遠慮ください」「営業お断り」などと書かれている会社
・閉業・倒産している会社、公式サイトが存在しない会社
・官公庁・自治体・学校（ドメインが go.jp / lg.jp / ac.jp / ed.jp）
・同じ会社の重複（同じドメインは1行にまとめる）

【出力形式】
・次の見出しの表を、タブ区切り（スプレッドシートにそのまま貼り付けられる形）で出力してください。見出しの文字は変えないでください。
企業名	企業URL	問い合わせフォーム	メール	大業界	小業界	都道府県	代表者名	備考
・「備考」には、除外はしなかったが注意が必要な点（例：フォームに画像認証あり、フォームが2ページ構成、電話番号が必須 など）を短く書いてください。
・最後に、除外した会社の一覧と除外の理由を、別の表で出してください。</textarea>
<p style="margin:6px 0 0;display:flex;gap:8px;align-items:center;flex-wrap:wrap"><button type="button" class="btn small" onclick="var t=document.getElementById('fo-listprompt');var b=this;(navigator.clipboard?navigator.clipboard.writeText(t.value):Promise.reject()).then(function(){b.textContent='コピーしました ✓'}).catch(function(){t.select();document.execCommand('copy');b.textContent='コピーしました ✓'})">プロンプトをコピー</button><span class="muted small">AIは間違えることがあります。取り込み後のプレビューで列がずれていないか確認してください。件数が多いときは50社ずつ頼むと精度が上がります。Webを閲覧できないAIはURLを作り話することがあるので使わないでください。</span></p>
</div>`)}

${step("5", "本送信を開始する", `<p>キャンペーン画面の「3. 本送信」で「開始する」を押すと、送信時間帯・1日の上限を守りながら自動で送ります。</p>
<ul style="line-height:1.8;margin:0;padding-left:1.2em"><li>途中で止めるときは「一時停止」</li>
<li>送信は<b>このPCの中で</b>動きます。PCがスリープしたり、ふたを閉じたり、アプリを終了すると止まります（起動すると続きから再開）。長時間送るときは電源につなぎ、自動でスリープしない設定に</li>
<li>フォームが見つからない・画像認証がある・営業お断りのサイトには、安全のため送りません</li></ul>`)}

${step("6", "結果と反応を確認する", `<ul style="line-height:1.8;margin:0;padding-left:1.2em"><li><b>送信一覧</b>：会社ごとの状態（送信済み・失敗・フォーム無し等）とスクリーンショット。失敗した会社は「修正して再送信」や「失敗した会社を再送信」、手で送った場合は「手動で送信済みにする」</li>
<li><b>反応の一覧</b>：送信用メールの受信箱を15分ごとに読み、返信を「返信あり／アポ獲得／断り」に自動で記録します（受付確認の自動メールは数えません）。判定の根拠を見て、間違っていれば取り消せます</li>
<li>メールの末尾には「メール配信停止」リンクが入り、送られてきた配信停止は自動で除外リストに入ります</li>
<li>「結果をCSVで書き出す」で一覧を保存できます</li></ul>`)}

<div class="card" id="ai" style="scroll-margin-top:76px"><h2 style="margin-top:0">AIで文面を個別化する（任意）</h2>
<p class="muted" data-nohelp>テンプレートでの送信は無料で、AIは不要です。会社ごとに書き出しを変えたいときだけ、設定画面でAPIキーを登録します。</p>
${AI_KEY_HELP}
<p style="margin:10px 0 0"><a class="btn small" href="/settings#s-ai" target="_blank" rel="noopener">設定を開く ↗</a></p></div>

<div class="card"><h2 style="margin-top:0">よくある質問</h2>
<p><b>Q. 料金はかかりますか？</b><br>テンプレートでの送信・社名の自動補完・返信の自動確認は無料です。AIを使う送り方を選んだ場合だけ、AIの料金がかかります。</p>
<p><b>Q. 他の人のPCから画面を開けますか？</b><br>同じWi-Fi・社内ネットワークなら開けます。アドレス欄の localhost のリンクは他のPCでは開けないので、${isAdmin ? `<a href="/users" target="_blank" rel="noopener">ユーザー管理</a>に表示されるURLを伝えてください` : "管理者に共有用のURLを聞いてください"}。</p>
<p><b>Q. Gmailが「一時的に停止」されました</b><br>短時間に大量に送ったことが原因です。通常1時間〜24時間で戻ります。戻るまで送信を止め、1日の上限を下げ、日中に少しずつ送るようにしてください。</p>
<p style="margin-bottom:0"><b>Q. 同じ会社に二重に送ってしまいませんか？</b><br>90日以内に送った会社（期間はキャンペーンで変更可）と、同じグループで登録済みの会社には送りません。送ったか判断できなかった会社は「失敗（要確認）」になるので、スクリーンショットで確認してから再送信してください。</p></div>
<h2 id="words">言葉の意味（用語集）</h2>
<div class="card">
<table>
<tr><th style="width:170px">画面の言葉</th><th>意味</th></tr>
<tr><td><b>キャンペーン</b></td><td>「誰に・どんな文面で送るか」のひとまとまり（送信プロジェクト）。リストと文面と設定がセットになっています。</td></tr>
<tr><td><b>送信者</b></td><td>相手に表示される差出人。会社名・担当者名・住所・送信用メールを登録します。複数登録して使い分けられます。</td></tr>
<tr><td><b>事前チェック</b></td><td>送らずに各社のサイトを見て、問い合わせフォームの有無・営業お断り・画像認証・メールアドレスを調べる下見のことです。</td></tr>
<tr><td><b>本送信</b></td><td>実際に送ること。「開始」を押すと、送信時間帯の中で1社ずつ送っていきます。</td></tr>
<tr><td><b>待機中</b></td><td>これから送る順番待ちの会社です。</td></tr>
<tr><td><b>要対応</b></td><td>自動では送れなかった会社（画像認証・失敗・フォーム無し）。専用の画面で1件ずつ対応できます。</td></tr>
<tr><td><b>フォーム無し</b></td><td>問い合わせフォームを見つけられなかった会社。メールアドレスがあれば自動でメール送信に切り替えます。</td></tr>
<tr><td><b>CAPTCHA（キャプチャ）</b></td><td>「私はロボットではありません」の画像認証。自動では突破しない方針なので、人が送る形になります。</td></tr>
<tr><td><b>除外リスト</b></td><td>今後いっさい送らない会社の一覧。営業お断りの検知や、断りの返信で自動的に追加されます。</td></tr>
<tr><td><b>配信停止</b></td><td>相手から「もう送らないで」と言われた状態。以後そのアドレスには送りません。</td></tr>
<tr><td><b>反応</b></td><td>送ったあとの相手の反応（返信あり／アポ獲得／断り）。受信箱を読んで自動で記録します。</td></tr>
<tr><td><b>ウォームアップ</b></td><td>新しいメールアカウントで、1日に送る数を少しずつ増やすこと。Googleに止められるのを防ぎます。</td></tr>
<tr><td><b>送れそう度</b></td><td>事前チェックの結果から出した、その会社に送れる見込み（0〜100）。</td></tr>
</table>
</div>
`;
}

// ---- 特定電子メール法のチェックリスト（#85）----
// 他社に渡すと、法律上の表示義務を知らないまま送り始めてしまう。最初の1回だけ、実際の登録内容を見せて確認してもらう。
export function lawView(senders: SenderProfile[], acked: string, unsubscribeOk: boolean): string {
  const ok = (b: boolean) => (b ? `<span class="tag sent">○</span>` : `<span class="tag failed">×</span>`);
  const rows = senders.map((s) => `<tr>
    <td><b>${esc(s.label || s.company)}</b></td>
    <td>${ok(Boolean(s.company?.trim()))} ${esc(s.company || "未登録")}</td>
    <td>${ok(Boolean(s.address?.trim()))} ${esc(s.address || "未登録")}</td>
    <td>${ok(Boolean(s.reply_email || s.email))} ${esc(s.reply_email || s.email || "未登録")}</td>
    <td>${s.unsubscribe_url ? `<span class="tag sent">○</span> 停止ページあり` : `<span class="tag queued">△</span> 返信で受付`}</td>
  </tr>`).join("");
  return `<h1>営業メールを送る前に（特定電子メール法）</h1>
<div class="card">
  <p>広告・宣伝を目的とするメールには、法律（特定電子メール法）で次の表示が必要です。ApoBoostは、下の内容を<b>自動で本文の末尾に入れます</b>。登録が足りないとメールは送れません。</p>
  <ol style="line-height:2;margin:8px 0 4px">
    <li><b>送信者の名称</b>（会社名）— 送信者プロフィールの「会社名」</li>
    <li><b>送信者の住所</b> — 送信者プロフィールの「住所」。<b>未登録だと送信できません</b></li>
    <li><b>受信拒否（配信停止）の連絡先</b> — 返信で受け付け。停止ページのURLを登録すると1クリックで済みます</li>
    <li><b>問い合わせを受け付けるメールアドレス</b> — 返信受付メール</li>
  </ol>
  <p class="muted">送らない方がよい相手: 配信停止を申し出た相手（自動で除外します）、個人のアドレス（BtoBの業務用アドレスを前提にしてください）、官公庁・学校（既定で除外）。</p>
</div>

<h2>いまの登録内容</h2>
<table>
  <tr><th>送信者</th><th>①名称</th><th>②住所</th><th>③④連絡先</th><th>配信停止</th></tr>
  ${rows || `<tr><td colspan="5">送信者がまだ登録されていません</td></tr>`}
</table>
<p class="muted">× がある送信者は、<a href="/senders">送信者</a>の画面で登録してください。${unsubscribeOk ? "" : "配信停止ページのURL（Googleフォーム等）を登録すると、相手が1クリックで停止でき、迷惑メール報告をされにくくなります。"}</p>

<div class="card" style="background:var(--honey-50);border-color:var(--honey)">
  <h2 style="margin-top:0">送る内容についての注意</h2>
  <ul style="line-height:1.9;margin:0">
    <li>件名に「広告」などの偽りがないこと（送信者を偽らない）</li>
    <li>相手が「不要」と言ったら、以後送らないこと（返信から自動で除外リストに入りますが、見落としに注意）</li>
    <li>「営業お断り」と書いてあるサイトには送らないこと（自動で検知してスキップします）</li>
    <li>送信記録は残しておくこと（ApoBoostが保存しています）</li>
  </ul>
</div>

<form method="post" action="/law/ack" data-busy>
  <label style="display:flex;gap:8px;align-items:center;font-weight:700"><input type="checkbox" name="ack" value="1" required style="width:auto">上の内容を確認しました</label>
  <p class="muted small">確認すると、この画面は次から出ません（${acked ? `前回の確認: ${esc(acked)}` : "まだ未確認"}）。</p>
  <button class="btn primary">確認して送信に進む</button>
</form>`;
}

// ---- 初回セットアップ（#41）----
// 送信者 → メール設定 → 法令確認 → キャンペーン → リスト → 開始 の順に、1画面ずつ案内する。
// 「どこから手を付ければいいか分からない」で止まるのを防ぐ。
export type SetupState = {
  senderOk: boolean; senderLabel: string; addressOk: boolean; smtpOk: boolean; smtpTested: boolean;
  lawOk: boolean; campaignOk: boolean; campaignId: number; listCount: number; scannedOk: boolean; sentCount: number;
};

export function setupView(st: SetupState): string {
  const step = (n: number, done: boolean, title: string, body: string) => `<div class="card" style="${done ? "opacity:.75" : "border-color:var(--honey);border-width:2px"}">
  <h2 style="margin-top:0">${done ? IC_CHECK : `${n}.`} ${esc(title)}</h2>${body}</div>`;
  const next = !st.senderOk ? 1 : !st.smtpOk ? 2 : !st.lawOk ? 3 : !st.campaignOk ? 4 : !st.listCount ? 5 : 6;
  return `<h1>はじめの設定</h1>
<div class="card" style="background:var(--honey-50)">
  <p>この6つを上から順に済ませれば、送信を始められます。<b>いまは ${next} 番</b>です。途中でやめても、ここに戻れば続きから進められます。</p>
  <p class="muted small">用意するもの: ①営業用のメールアドレス ②そのアドレスの2段階認証（アプリパスワード） ③自社の住所（営業メールには法律で必要です）</p>
</div>
${step(1, st.senderOk, "送信者を登録する（会社名・担当者・住所）", `
  <p class="muted">相手に表示される差出人です。住所が無いとメールは送れません。</p>
  ${st.senderOk ? `<p>登録済み: <b>${esc(st.senderLabel)}</b>${st.addressOk ? "" : ` <span style="color:var(--ng)">住所が未登録です</span>`}</p>` : ""}
  <a class="btn ${st.senderOk ? "sub" : ""}" href="/senders">${st.senderOk ? "送信者を見る・直す" : "送信者を登録する"}</a>`)}
${step(2, st.smtpOk, "送信用メールを設定する（Gmailのアプリパスワード）", `
  <p class="muted">Googleアカウント → セキュリティ → 2段階認証プロセス → アプリパスワード で16文字のパスワードを作り、送信者の画面に貼り付けてください。フォームだけ送る場合は飛ばせます。</p>
  ${st.smtpOk ? `<p>設定済み${st.smtpTested ? "（接続テストに成功しています）" : ""}</p>` : ""}
  <a class="btn ${st.smtpOk ? "sub" : ""}" href="/senders">${st.smtpOk ? "設定を見る" : "メールを設定する"}</a>`)}
${step(3, st.lawOk, "営業メールの決まりを確認する", `
  <p class="muted">名称・住所・配信停止の連絡先の表示が法律で必要です。ApoBoostが自動で入れますが、1回だけ内容をご確認ください。</p>
  <a class="btn ${st.lawOk ? "sub" : ""}" href="/law">${st.lawOk ? "もう一度見る" : "確認する"}</a>`)}
${step(4, st.campaignOk, "キャンペーン（送信プロジェクト）を作る", `
  <p class="muted">「誰に・どんな文面で送るか」のひとまとまりです。文面のひな形から選べます。</p>
  <a class="btn ${st.campaignOk ? "sub" : ""}" href="${st.campaignOk ? `/campaigns/${st.campaignId}` : "/campaigns/new"}">${st.campaignOk ? "キャンペーンを開く" : "キャンペーンを作る"}</a>`)}
${step(5, st.listCount > 0, "会社リストを取り込む", `
  <p class="muted">企業名と企業URL（ホームページ）の2列があれば取り込めます。見本のCSVも用意しています。</p>
  ${st.listCount ? `<p>取り込み済み: <b>${st.listCount}社</b></p>` : ""}
  <a class="btn ${st.listCount ? "sub" : ""}" href="${st.campaignId ? `/campaigns/${st.campaignId}` : "/campaigns/new"}">リストを取り込む</a>
  <a class="btn sub" href="/template.csv">見本のCSV</a>`)}
${step(6, st.sentCount > 0, "事前チェックして、送信を始める", `
  <p class="muted">事前チェックでフォームの有無・営業お断り・画像認証を先に判定します（任意）。そのあと「開始」で送信が始まります。</p>
  ${st.sentCount ? `<p>送信済み: <b>${st.sentCount}件</b>。おつかれさまでした。あとは<a href="/todo">要対応</a>と<a href="/stats">送信数</a>を見ていけば大丈夫です。</p>` : ""}
  <a class="btn ${st.sentCount ? "sub" : ""}" href="${st.campaignId ? `/campaigns/${st.campaignId}` : "/"}">キャンペーンを開く</a>`)}
<p><a class="btn small" href="/checklist">導入チェックリストを印刷する</a> <a class="btn small" href="/guide">くわしい使い方（ご利用ガイド）</a> <a class="btn small" href="/health">動作チェック</a></p>`;
}

// ---- 導入チェックリスト（#138）----
// 渡すときの説明資料を毎回手で作っていたので、画面から1枚で出せるようにする。
// PDFにしたい場合は、ブラウザの印刷から「PDFとして保存」を選ぶ（追加のソフトは入れない方針）。
export function checklistView(st: SetupState, version: string): string {
  const box = (done: boolean) => `<span style="display:inline-block;width:18px;height:18px;border:2px solid var(--c-ink);border-radius:4px;text-align:center;line-height:15px;font-weight:800;margin-right:8px;vertical-align:-3px">${done ? "✓" : ""}</span>`;
  const item = (done: boolean, title: string, note: string) => `<li style="margin:0 0 12px;list-style:none">${box(done)}<b>${esc(title)}</b><div class="small" style="margin-left:30px;color:var(--c-ink-2)">${esc(note)}</div></li>`;
  return `<h1>導入チェックリスト</h1>
<p class="small">ApoBoost v${esc(version)}　／　このページは印刷できます（ブラウザの印刷 →「PDFとして保存」でPDFにもなります）。 <button class="btn small" onclick="window.print()">印刷する</button></p>
<div class="card"><h2 style="margin-top:0">はじめる前に用意するもの</h2>
<ul style="padding:0;margin:0">
${item(false, "営業用のメールアドレス", "ふだん使いとは分けることをおすすめします（Gmail / Google Workspace）")}
${item(false, "そのアドレスの2段階認証とアプリパスワード", "Googleアカウント → セキュリティ → 2段階認証プロセス → アプリパスワード（16文字）")}
${item(false, "自社の住所", "営業メールには住所の表示が法律で必要です。未登録だとメールは送れません")}
${item(false, "送り先の会社リスト", "企業名と企業URLの2列があれば取り込めます（見本CSVあり）")}
</ul></div>
<div class="card"><h2 style="margin-top:0">設定の手順（6ステップ）</h2>
<ul style="padding:0;margin:0">
${item(st.senderOk && st.addressOk, "1. 送信者を登録する", "会社名・担当者・住所・電話。設定 → 送信者")}
${item(st.smtpOk, "2. 送信用メールを設定する", "アプリパスワードを貼り付けて保存すると、接続テストが自動で走ります")}
${item(st.lawOk, "3. 営業メールの決まりを確認する", "名称・住所・配信停止の連絡先の表示（自動で入ります）")}
${item(st.campaignOk, "4. キャンペーンを作る", "文面はひな形から選んで【 】の中を書き換えます")}
${item(st.listCount > 0, "5. 会社リストを取り込む", "CSV / Excel / スプレッドシート")}
${item(st.sentCount > 0, "6. 事前チェックをして、送信を始める", "開始を押すと、送信時間帯の中で自動で送ります")}
</ul></div>
<div class="card"><h2 style="margin-top:0">毎日見るところ</h2>
<ul style="padding:0;margin:0">
${item(false, "ホーム", "今日の進み具合・アポ・要対応・次にやること")}
${item(false, "要対応 →「今日やる10件」", "自動で送れなかった会社のうち、手を打つ価値の高いものから")}
${item(false, "成果", "業種別・時間帯別の反応率、週次レポート")}
</ul></div>
<div class="card"><h2 style="margin-top:0">気をつけること</h2>
<ul class="small" style="line-height:2;margin:0">
<li>黒い画面（ターミナル）は閉じない。閉じると送信が止まります（設定 → 動作チェックで「ログイン時に自動で起動」をオンにできます）</li>
<li>新しいメールアカウントは、最初の2週間は送信数が自動で抑えられます（ウォームアップ）</li>
<li>「不要」と言われた相手には以後送りません（自動で除外リストに入ります）</li>
<li>うまく動かないときは、設定 → 動作チェック →「診断ファイル」を配布元に送ってください</li>
</ul></div>`;
}
