// 送信者の一覧と編集フォーム
import { STATUS_LABEL, OUTCOME_LABEL, CHANNEL_LABEL, channelMode, jst, type Campaign, type Job, type SenderProfile, type JobStatus } from "../db.js";
import { AI_MODELS, type Lint } from "../message.js";
import { TEMPLATE_LIBRARY } from "../templates.js";
import { esc, layout, n, type NavUser, IC_MAIL, IC_FORM, IC_WARN } from "./layout.js";
import { post } from "./parts.js";

export function senderForm(s?: Partial<SenderProfile>) {
  const v = (k: keyof SenderProfile) => esc(s?.[k] ?? "");
  return `<form method="post" action="/senders${s?.id ? `/${s.id}` : ""}" data-draft="sender-${s?.id ?? "new"}">
<div class="row"><div><label>ラベル（管理用）</label><input type="text" name="label" value="${v("label")}" placeholder="社内用 / ○○社用" required></div><div><label>会社名 *</label><input type="text" name="company" value="${v("company")}" required></div></div>
<div class="row"><div><label>業種</label><input type="text" name="industry" value="${v("industry")}"></div><div><label>担当者名 *（姓と名の間にスペース）</label><input type="text" name="person" value="${v("person")}" placeholder="田中 太郎" required></div></div>
<div class="row"><div><label>担当者名フリガナ</label><input type="text" name="person_kana" value="${v("person_kana")}" placeholder="タナカ タロウ"></div><div><label>メール *（フォームに入力するアドレス）</label><input type="email" name="email" value="${v("email")}" required></div></div>
<div class="row"><div><label>返信受付メール（本文に載せる。空なら上と同じ）</label><input type="email" name="reply_email" value="${v("reply_email")}"></div><div><label>電話（ハイフン区切り）</label><input type="text" name="tel" value="${v("tel")}" placeholder="03-1234-5678"><p class="muted" style="color:var(--ng)">${IC_WARN} フォームでは電話番号が必須になっていることが多く、未入力のままだとかなりの確率で送信エラーになります。必ず入力してください。</p>
<label class="inline small" style="display:flex;gap:6px;align-items:flex-start;margin-top:6px;font-weight:400"><input type="checkbox" name="tel_required_only" value="1" ${s?.tel_required_only ? "checked" : ""} style="width:auto;margin-top:3px"> <span><b>電話番号が必須の欄にだけ入力する</b>（任意の欄には書かない）<br><span class="muted">電話番号を相手に伝えたくない場合に。サイト側で必須だった場合は、弾かれた後の埋め直しで入力して再送します。</span></span></label></div></div>
<div class="row3"><div><label>郵便番号</label><input type="text" name="postal" value="${v("postal")}" placeholder="114-0001"></div><div><label>住所（都道府県から）※メールで送る場合は必須</label><input type="text" name="address" value="${v("address")}"><p class="muted small" style="margin:2px 0 0">営業メールには送信者の名称・住所・配信停止の連絡先の表示が法律（特定電子メール法）で必要なため、メールの末尾に自動で載せます。</p></div><div><label>自社URL</label><input type="url" name="url" value="${v("url")}"></div></div>
<h2>メールで送る場合の設定（任意。フォームだけなら不要）</h2>
<p class="muted">Googleアカウントで<a href="https://myaccount.google.com/signinoptions/twosv" target="_blank" rel="noopener">2段階認証プロセス</a>をオンにし、<a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener">アプリパスワード</a>を発行して貼り付けてください（リンクを押すと、いまブラウザでログイン中のGoogleアカウントの設定ページが別タブで開きます。送信に使うアカウントでログインしているか確認してください）。営業専用のアドレスを使うのが安全です（無料Gmailは1日500通、Workspaceは2,000通まで）。</p>
<div class="row3"><div><label>送信用メールアドレス（Gmail等）</label><input type="text" name="smtp_user" value="${v("smtp_user")}" placeholder="sales@example.co.jp"></div><div><label>アプリパスワード（保存済みなら空のまま）</label><input type="password" name="smtp_pass" value="" placeholder="xxxx xxxx xxxx xxxx" autocomplete="off"></div><div><label>差出人として表示するアドレス（空なら左と同じ）</label><input type="text" name="from_email" value="${v("from_email")}"></div></div>
<label class="inline small" style="display:flex;gap:6px;align-items:flex-start;margin:6px 0;font-weight:400"><input type="checkbox" name="reply_check" value="1" ${s?.reply_check === 0 ? "" : "checked"} style="width:auto;margin-top:3px"> <span><b>受信箱を読んで、返信（返信あり／アポ／断り）と届かなかったメールを自動で記録する</b><br><span class="muted">オンにすると、ApoBoostが<b>この送信用メールアドレスの受信箱に届いたメールを15分ごとに読み取ります</b>（このPCの中だけで処理し、外部には送りません）。送った会社からのメール以外は記録しません。個人のメールと兼用していて読まれたくない場合はオフにしてください（反応は手動で記録）。</span></span></label>
<label class="inline small" style="display:flex;gap:6px;align-items:flex-start;margin:6px 0;font-weight:400"><input type="checkbox" name="inbox_sort" value="1" ${s?.inbox_sort === 0 ? "" : "checked"} style="width:auto;margin-top:3px"> <span><b>受信箱を自動で振り分ける</b>（おすすめ）<br><span class="muted">フォームに送った会社から届く「お問い合わせありがとうございます」等の自動返信と、届かなかったメールは、ラベル「ApoBoost/自動返信」「ApoBoost/届かなかった」に移して受信箱から外します。アポの返信にはラベル「ApoBoost/アポ」とスターを付けます。営業と関係のないメールには触りません。消すことはしません（ラベルから見られます）。</span></span></label>
<label>配信停止ページのURL（任意・入れておくと到達率が上がります）</label>
<input type="url" name="unsubscribe_url" value="${v("unsubscribe_url")}" placeholder="https://docs.google.com/forms/d/e/…/viewform">
<p class="muted small" style="margin:4px 0 10px">メールの末尾と「配信停止」ボタン（Gmail等が出すもの）に、このURLを使います。受け取った人が<b>1クリックで停止を申し出られる</b>ようになり、迷惑メール報告を押される代わりにこちらに届きます。<br>Googleフォームで「メールアドレス」を聞くだけの簡単なフォームを1つ作って、そのURLを貼ってください。空の場合は、これまでどおり「本メールに『配信停止』と返信」での受付になります。</p>
<label class="inline small" style="display:flex;gap:6px;align-items:flex-start;margin:6px 0;font-weight:400"><input type="checkbox" name="tls_insecure" value="1" ${s?.tls_insecure ? "checked" : ""} style="width:auto;margin-top:3px"> <span><b>セキュリティソフトの影響で送れない場合にチェック</b>（「self-signed certificate…」「certificate」を含むエラーが出るとき）<br><span class="muted">ESET・カスペルスキー等のメール保護や社内ネットワークが通信に割り込むと、証明書が差し替わって送信できません。チェックすると証明書の確認を省いて送れるようにします。<b>通信の安全性が下がる</b>ため、原因が分かっている場合だけにしてください（まずはセキュリティソフト側の「メール保護／SSLスキャン」をオフにする方が安全です）。</span></span></label>
<details class="small muted"><summary>Gmail以外のメールサーバー</summary><div class="row"><div><label>SMTPホスト</label><input type="text" name="smtp_host" value="${esc(s?.smtp_host ?? "smtp.gmail.com")}" placeholder="smtp.gmail.com"></div><div><label>ポート（465 or 587）</label><input type="number" name="smtp_port" value="${esc(s?.smtp_port ?? 465)}" placeholder="465"></div></div>
<p class="muted small" style="margin:6px 0 0"><b>SMTPホストとは：</b>メールを送り出すサーバーのアドレスです。プロバイダごとに決まっています。<br>
例）Gmail・Google Workspace＝<code>smtp.gmail.com</code>／Outlook・Microsoft365＝<code>smtp.office365.com</code>／Yahoo!メール＝<code>smtp.mail.yahoo.co.jp</code>／iCloud＝<code>smtp.mail.me.com</code><br>
<b>確認方法：</b>お使いのメールの設定画面で「送信サーバー（SMTP）」の欄を見るか、「（プロバイダ名） SMTP 設定」で検索してください。分からなければ、送信専用に無料のGmailを1つ作るのが一番かんたんです（その場合はこの欄は変更不要）。</p></details>
<p><button class="btn primary">保存</button>${s?.id ? ` <button class="btn sub" formaction="/senders/${s.id}/test" formmethod="post">メール設定を確認</button>` : ""}</p></form>`;
}

/** 送信者の一覧（#106 #130）。設定の足りないところを赤い札で出し、その場で編集できる。
 *  以前は「未設定」が薄い文字で、編集は別ページ、新規追加は一覧の下にあった */
export type SenderExtra = { sentToday: number; limit: number; note: string; paused: string };

export function sendersView(list: SenderProfile[], usage: Record<number, number> = {}, extra: Record<number, SenderExtra> = {}, openId = 0) {
  const issues = (s: SenderProfile): string[] => {
    const out: string[] = [];
    if (!s.address?.trim()) out.push("住所が未登録（メールを送れません）");
    if (!s.smtp_user || !s.smtp_pass) out.push("送信用メールが未設定");
    if (!s.tel?.trim()) out.push("電話が未登録（フォームで弾かれやすい）");
    return out;
  };
  return `<h1 style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">送信者 <a class="btn primary" href="#new" onclick="document.getElementById('newsender').open=true">＋ 送信者を追加</a></h1>
<p class="muted" data-nohelp>相手に表示される「差出人」です。会社名・担当者・住所と、メールで送る場合は送信用メールを登録します。</p>
${list.length ? list.map((s) => {
    const iss = issues(s);
    const ex = extra[s.id];
    const mailOk = Boolean(s.smtp_user && s.smtp_pass);
    return `<details class="card" style="padding:0" ${openId === s.id ? "open" : ""}>
<summary style="cursor:pointer;padding:16px 18px;display:flex;gap:10px 18px;align-items:center;flex-wrap:wrap;list-style:none">
  <span style="min-width:200px"><b>${esc(s.label || s.company)}</b><br><span class="muted" data-nohelp>${esc(s.company)} ${esc(s.person)}</span></span>
  <span class="small" style="min-width:210px">${mailOk ? `${IC_MAIL} ${esc(s.smtp_user)}` : `${IC_FORM} フォーム送信のみ`}</span>
  <span>${iss.length ? iss.map((i) => `<span class="tag failed" style="margin:2px 4px 2px 0">${esc(i)}</span>`).join("") : `<span class="tag sent">設定OK</span>`}${ex?.paused ? ` <span class="tag failed">メール一時停止中</span>` : ""}</span>
  ${mailOk && ex ? `<span class="small" style="margin-left:auto;text-align:right">今日のメール <b>${n(ex.sentToday)} / ${n(ex.limit)}通</b>${ex.note ? `<br><span class="muted" data-nohelp>${esc(ex.note)}</span>` : ""}</span>` : `<span style="margin-left:auto"></span>`}
  <span class="btn small">編集</span>
</summary>
<div style="padding:0 18px 18px;border-top:1px solid var(--c-line)">
${ex?.paused ? `<p class="small" style="color:var(--ng)">${IC_WARN} ${esc(ex.paused)}</p>` : ""}
<p class="muted" data-nohelp>利用中のキャンペーン: ${usage[s.id] ?? 0}件</p>
${senderForm(s)}
${mailOk ? `<form method="post" action="/senders/${s.id}/test" class="inline" data-busy data-busytext="接続を確認中…"><button class="btn small">メールの接続をテストする</button></form>` : ""}
</div></details>`;
  }).join("") : `<div class="card"><p>まだ送信者がありません。下のフォームから登録してください。</p></div>`}
<details class="card" id="newsender" ${list.length ? "" : "open"}><summary style="cursor:pointer;font-weight:700" id="new">＋ 新しい送信者を追加する</summary>
<div style="margin-top:12px">${senderForm()}</div></details>`;
}
