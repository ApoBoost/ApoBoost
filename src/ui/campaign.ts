// キャンペーンの作成・編集フォームと、キャンペーン画面（準備／送信／結果）
import { thumb, ZOOM_SNIPPET, moreMenu } from "./parts.js";
import { STATUS_LABEL, OUTCOME_LABEL, CHANNEL_LABEL, channelMode, jst, type Campaign, type Job, type SenderProfile, type JobStatus } from "../db.js";
import { AI_MODELS, type Lint } from "../message.js";
import { TEMPLATE_LIBRARY } from "../templates.js";
import { esc, layout, n, type NavUser, IC_MAIL, IC_FORM, IC_WARN } from "./layout.js";
import { statusTag, errKindTag, scoreTag, statusCell, MODE_LABEL, campaignStatusTag, STATUS_LEGEND, post } from "./parts.js";

export function campaignForm(senders: SenderProfile[], defaults: Partial<Campaign>, provider: string, editId?: number, groups: string[] = [], others: { id: number; name: string; group_name: string }[] = []) {
  const d = (k: keyof Campaign, fb: unknown = "") => esc(defaults[k] ?? fb);
  return `<h1>${editId ? `キャンペーンを編集: ${d("name")}` : "新しいキャンペーン"}</h1>
${editId ? `<p><a href="/campaigns/${editId}">← キャンペーンに戻る</a></p><p class="muted">配信チャネルの変更は、<b>これから取り込む会社</b>に適用されます（取り込み済みの会社の振り分けは変わりません）。</p>` : ""}
<form method="post" action="${editId ? `/campaigns/${editId}/edit` : "/campaigns"}" class="card" enctype="multipart/form-data" data-draft="campaign-${editId ?? "new"}" id="campform">
${editId ? "" : `<div id="stepbar" class="tabs" style="margin-top:0"><a class="on" data-go="1">① 名前と送り方</a><a data-go="2">② 文面</a><a data-go="3">③ 上限と時間帯</a></div>`}
<div data-step="1"><h2 style="margin-top:0">① 名前と送り方</h2>
<label>グループ（任意）</label><input type="text" name="group_name" value="${d("group_name")}" list="fo-groups" placeholder="例：福岡 飲食 9月（空欄なら自動で決めます）" style="max-width:420px"><datalist id="fo-groups">${groups.map((g) => `<option value="${esc(g)}">`).join("")}</datalist>
<p class="muted small" style="margin:4px 0 6px">同じグループのキャンペーン同士では、<b>同じ会社に重ねて送りません</b>（フォーム用とメール用に分けたときなど）。別のキャンペーンで<b>待機中・送信済み</b>の会社は取り込み時に除外し、送信直前にも確認します。<b>フォーム無し・失敗・画像認証</b>だった会社は連絡できていないので、同じグループの別キャンペーンで送れます。</p>
${(() => {
    const list = others.filter((o) => o.id !== editId);
    if (!list.length) return "";
    const mine = String(defaults.group_name ?? "");
    return `<details ${mine ? "open" : ""} style="margin:0 0 12px"><summary style="cursor:pointer;font-weight:700">同じグループに入れるキャンペーンを選ぶ（昔のキャンペーンも選べます）</summary>
<div style="max-height:220px;overflow:auto;border:1px solid var(--line,#e5e0d5);border-radius:8px;padding:8px 10px;margin-top:6px">${list.map((o) => `<label class="inline small" style="display:flex;gap:6px;align-items:center;font-weight:400;margin:3px 0"><input type="checkbox" name="group_members" value="${o.id}" ${mine && o.group_name === mine ? "checked" : ""} style="width:auto"> ${esc(o.name)}${o.group_name ? ` <span class="tag">グループ: ${esc(o.group_name)}</span>` : ` <span class="muted">（グループなし）</span>`}</label>`).join("")}</div>
<p class="muted small" style="margin:4px 0 0">チェックしたキャンペーンをこのキャンペーンと同じグループにします。チェックを外したキャンペーンはこのグループから外れます。グループ名が空欄なら、チェックした中のグループ名、無ければこのキャンペーンの名前をグループ名にします。</p></details>`;
  })()}
<div class="row"><div><label>キャンペーン名</label><input type="text" name="name" value="${d("name")}" required placeholder="福岡 飲食 9月"></div>
<div><label>送信者</label><select name="sender_id" required>${senders.map((s) => `<option value="${s.id}" ${defaults.sender_id === s.id ? "selected" : ""}>${esc(s.label)}（${esc(s.company)} ${esc(s.person)}）</option>`).join("")}</select>${senders.length ? "" : '<p class="muted">先に<a href="/senders">送信者</a>を登録してください</p>'}</div></div>
<label>配信チャネル</label>
<select name="channel">
<option value="form_first" ${channelMode(String(defaults.channel ?? "")) === "form_first" ? "selected" : ""}>フォーム優先（フォームが無ければメール）— おすすめ</option>
<option value="email_first" ${channelMode(String(defaults.channel ?? "")) === "email_first" ? "selected" : ""}>メール優先（メールが無ければフォーム）</option>
<option value="email_only" ${channelMode(String(defaults.channel ?? "")) === "email_only" ? "selected" : ""}>メールのみ（メールがある会社だけ）</option>
<option value="form_only" ${channelMode(String(defaults.channel ?? "")) === "form_only" ? "selected" : ""}>フォームのみ（フォームがある会社だけ）</option>
</select>
<label>文面モード</label>
<select name="mode">
<option value="ai" ${provider === "none" && defaults.mode !== "ai" ? "disabled" : ""} ${defaults.mode === "ai" || (provider !== "none" && !defaults.mode) ? "selected" : ""}>全文AI生成 — 成功率は最高。想定外の質問欄にもAIが回答${provider === "none" ? "（AI設定が必要）" : ""}</option>
<option value="tpl_ai" ${provider === "none" && defaults.mode !== "tpl_ai" ? "disabled" : ""} ${defaults.mode === "tpl_ai" ? "selected" : ""}>テンプレ＋質問だけAI — おすすめ。文面はテンプレ(0円)、想定外の質問欄だけAIが回答。安くて成功率が高い${provider === "none" ? "（AI設定が必要）" : ""}</option>
<option value="hybrid" ${provider === "none" && defaults.mode !== "hybrid" ? "disabled" : ""} ${defaults.mode === "hybrid" ? "selected" : ""}>ハイブリッド — 冒頭だけAI生成で安いが、想定外の質問欄には対応できない${provider === "none" ? "（AI設定が必要）" : ""}</option>
<option value="template" ${defaults.mode === "template" || (provider === "none" && defaults.mode !== "ai" && defaults.mode !== "hybrid") ? "selected" : ""}>テンプレートのみ（差し込みだけ・AI不使用・0円）</option>
</select>
<p class="muted small">
<b>全文AI生成:</b> 企業ごとに全文を書き、「ご予算」「何で知りましたか」など想定外の質問欄にもAIが回答するため、送信が成功しやすくなります。料金は1件あたり約0.5〜0.8円（Haiku）。月1,000件で約400〜800円。<br>
<b>テンプレ＋質問だけAI（おすすめ）:</b> 文面はテンプレ（0円）のまま、想定外の質問欄が出たときだけAIが回答します。全文生成をしないぶん<b>全文AIの1/5〜1/10の費用</b>で、成功率はテンプレのみより大きく上がります（AIを呼ぶのは想定外の質問が出た一部の会社だけ）。<br>
<b>ハイブリッド:</b> 冒頭1〜2文だけAIが書くので安い（約0.2円/件）ぶん、想定外の質問欄には対応できず、そのフォームは失敗になりやすくなります。<br>
※ チェック欄・選択肢はどのモードでも自動対応します。画像認証（CAPTCHA）はどのモードでも突破しません。</p>
${provider === "none" ? '<p class="muted small" data-nohelp>AIを使うモードは、<a href="/settings#s-ai">設定でAPIキーを登録</a>すると選べます（<a href="/guide#ai" target="_blank" rel="noopener">料金と手順</a>）。未登録のあいだはテンプレートで送られます。</p>' : ""}
</div><div data-step="2"><h2>② 文面</h2>
<label>件名（件名欄があるフォーム用）</label><input type="text" name="subject_text" value="${d("subject_text", "【ここに件名】のご案内")}">
<label>本文テンプレート</label>
<p class="muted">使える差し込み: {{会社名}} {{代表者}}（無ければ「ご担当者様」） {{業種}} {{都道府県}} {{自社名}} {{担当者}} {{自社メール}} {{自社電話}} {{自社URL}} {{AI冒頭}} {{資料リンク}}</p>
<div style="margin-bottom:6px"><label class="inline small">例文を挿入:
<select id="tplpreset" style="width:auto;padding:4px 8px;max-width:360px"><option value="">業種・目的から選ぶと、件名と本文に入ります…</option>${TEMPLATE_LIBRARY.map((t) => `<option value="${esc(t.id)}">${esc(t.label)}</option>`).join("")}</select></label>
<span class="muted small">※ 今の本文がある場合は置き換わります。【 】の中だけ自分の言葉に書き換えてください</span>
<div id="tplnote" class="muted small" style="margin:4px 0 6px"></div></div>
<textarea name="template_text" id="tpltext" style="min-height:320px">${d("template_text")}</textarea>
<script>
(() => {
  // 業種別のひな形（#63）。選ぶと件名と本文に入る
  const T = ${JSON.stringify(Object.fromEntries(TEMPLATE_LIBRARY.map((t) => [t.id, { subject: t.subject, body: t.body, note: t.note }])))};
  const sel = document.getElementById("tplpreset"), ta = document.getElementById("tpltext"), note = document.getElementById("tplnote");
  const subj = document.querySelector("[name=subject_text]");
  if (sel && ta) sel.addEventListener("change", () => {
    const v = T[sel.value];
    if (!v) { if (note) note.textContent = ""; return; }
    if (note) note.textContent = v.note;
    if (!ta.value.trim() || confirm("件名と本文をひな形で置き換えますか？（今の内容は消えます）")) {
      ta.value = v.body;
      if (subj && (!subj.value.trim() || subj.value.indexOf("【ここに") >= 0)) subj.value = v.subject;
    }
  });
})();
</script>
<details style="margin:12px 0" ${Number(defaults.ab_enabled ?? 0) ? "open" : ""}><summary style="cursor:pointer;font-weight:700">文面のA/Bテスト・件名の使い分け（任意）</summary>
<div style="border:1px solid var(--hive-200);border-radius:8px;padding:10px 12px;margin-top:8px">
<label style="display:flex;align-items:center;gap:8px"><input type="checkbox" name="ab_enabled" value="1" ${Number(defaults.ab_enabled ?? 0) ? "checked" : ""} style="width:auto">2つの文面を半分ずつ送って、反応を比べる（A/Bテスト）</label>
<p class="muted small" style="margin:4px 0 8px">会社ごとに交互にA・Bを割り当てて送り、キャンペーン画面に「どちらが返信・アポを取れたか」を表示します。文面Bが空のときはAだけを送ります。</p>
<label>件名（B）</label><input type="text" name="subject_b" value="${d("subject_b")}" placeholder="空ならAと同じ件名を使います">
<label>本文（B）</label><textarea name="template_b" style="min-height:220px" placeholder="Aとは別の切り口の文面を入れてください">${d("template_b")}</textarea>
<label>件名の別案（1行に1つ・任意）</label><textarea name="subject_alts" style="min-height:70px" placeholder="同じ件名を大量に送ると迷惑メール扱いされやすくなります。別案を入れると順番に使います">${d("subject_alts")}</textarea>
</div></details>
<label>AIへの追加指示（任意）</label><input type="text" name="ai_instruction" value="${d("ai_instruction")}" placeholder="例: 採用課題に寄せる／飲食店向けに集客の話をする">
</div><div data-step="3"><h2>③ 上限と時間帯</h2>
${editId ? "" : `<p class="muted" data-nohelp>ここは最初のままで大丈夫です。あとから「設定を変える」でいつでも変更できます。</p>`}
<div class="row3"><div><label>1日の上限（フォーム／メール）</label><div class="row"><input type="number" name="daily_limit" value="${d("daily_limit", 300)}" title="フォーム" placeholder="フォーム"><input type="number" name="email_daily_limit" value="${d("email_daily_limit", 100)}" title="メール" placeholder="メール"></div></div><div><label>送信時間帯（開始・終了 時）</label><div class="row"><input type="number" name="send_window_start" value="${d("send_window_start", 9)}" min="0" max="23"><input type="number" name="send_window_end" value="${d("send_window_end", 18)}" min="1" max="24"></div></div><div><label>平日のみ</label><select name="weekdays_only"><option value="1" ${Number(defaults.weekdays_only ?? 1) ? "selected" : ""}>はい</option><option value="0" ${defaults.weekdays_only !== undefined && !Number(defaults.weekdays_only) ? "selected" : ""}>土日も送る</option></select></div></div>
<div class="small" style="margin:-4px 0 14px;padding:10px 12px;background:var(--honey-50);border:1px solid var(--honey);border-radius:8px;line-height:1.7">
<b>${IC_WARN} メールの上限は少なめに（Gmailのアカウント停止を防ぐため）</b><br>
短時間に大量に送ると、Googleに「普段と違う利用」と判断され、<b>アカウントが一時停止</b>されます（通常1時間〜最大24時間。停止中は送信も返信の確認もできません）。上限の数だけでなく、次の条件が重なると止められやすくなります。<br>
・<b>作ったばかりのアカウント</b>：最初の1週間は1日<b>50〜100通</b>、問題なければ2週目に200通…と少しずつ増やしてください（いきなり500通以上は危険）<br>
・<b>深夜・早朝の連続送信</b>：送信時間帯は平日の日中（例: 9〜18時）にしてください<br>
・<b>重い添付ファイル</b>：数MB以上のPDFを毎通添付すると負荷が大きく、受け取れずに戻ってくる会社もあります。資料は添付せず、本文にGoogleドライブ等のリンクを載せるのがおすすめです<br>
・<b>届かないアドレスが多い</b>：戻ってくるメール（アドレス不明など）が多いと迷惑メール送信者とみなされやすくなります。古いリストは送る前に見直してください<br>
<span class="muted">目安: Gmail（無料）は1日約500通、Google Workspace は1日約2,000通が Google 側の上限ですが、上の条件次第でそれよりずっと少ない数でも止まります。フォーム送信はメールアカウントを使わないため、この制限はありません。</span>
</div>
<label style="display:flex;align-items:center;gap:8px;margin:10px 0 2px"><input type="checkbox" name="email_warmup" value="1" ${Number(defaults.email_warmup ?? 1) ? "checked" : ""} style="width:auto">メールの送信数を少しずつ増やす（ウォームアップ・推奨）</label>
<p class="muted small" style="margin:0 0 10px">送り始めの数日は1日30〜50通に自動で抑え、問題がなければ2週間かけて上の上限まで引き上げます。新しいアカウントがGoogleに止められるのを防ぎます。途中で止められた場合は自動で1段階下げます。</p>
${senders.length > 1 ? `<label>メールで使う送信アカウントを増やす（任意）</label>
<p class="muted small" style="margin:0 0 6px">上限に達したアカウントの代わりに、ここで選んだアカウントから続けて送ります（1日に送れる数が増えます）。署名・住所も、実際に送ったアカウントのものになります。</p>
<div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:12px">${senders.filter((x) => x.id !== Number(defaults.sender_id ?? 0)).map((x) => `<label class="small" style="display:flex;align-items:center;gap:6px;font-weight:400"><input type="checkbox" name="email_sender_ids" value="${x.id}" ${String(defaults.email_sender_ids ?? "").split(",").includes(String(x.id)) ? "checked" : ""} style="width:auto">${esc(x.label || x.company)}（${esc(x.smtp_user || x.email)}）</label>`).join("")}</div>` : ""}
<div class="row3"><div><label>同じ会社への再送を止める期間（日・0で制限なし）</label><input type="number" name="resend_days" value="${d("resend_days", 90)}" min="0"></div><div><label>「営業お断り」のサイト</label><select name="ignore_refusal"><option value="0" ${Number(defaults.ignore_refusal ?? 0) ? "" : "selected"}>送らない（推奨）</option><option value="1" ${Number(defaults.ignore_refusal ?? 0) ? "selected" : ""}>送る（クレームの恐れあり）</option></select></div><div></div></div>
<h2>資料の添付（任意）</h2>
<p class="muted">メール送信では下のファイルを添付します。フォーム送信ではファイルを添付できないため、代わりに「資料の公開リンク」を本文末尾に自動で載せます（本文に {{資料リンク}} を書けばその位置に入ります）。</p>
<div class="row"><div><label>資料ファイル（メール添付用・PDF等）</label><input type="file" name="material_file" accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.png,.jpg">${defaults.attach_name ? `<p class="muted small" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">現在の添付: <b>${d("attach_name")}</b>（新しいファイルを選ぶと置き換わります）${editId ? `<input type="hidden" name="remove_attach" value="0"><button type="button" class="btn sub small" data-n="${d("attach_name")}" onclick="if(confirm('添付ファイル「' + this.dataset.n + '」を削除します。以後のメールは添付なしで送られます（画面のほかの変更も一緒に保存されます）。よろしいですか？')){var f=this.form;f.querySelector('input[name=remove_attach]').value='1';f.querySelectorAll('[required]').forEach(function(x){x.removeAttribute('required')});if(f.requestSubmit){f.requestSubmit()}else{f.submit()}}">添付を削除</button>` : ""}</p>` : ""}</div><div><label>資料の公開リンク（フォーム本文用・URL）</label><input type="url" name="material_url" value="${d("material_url")}" placeholder="https://（Googleドライブ等の共有リンク）"><label class="inline small" style="display:flex;gap:6px;align-items:center;margin-top:6px;font-weight:400"><input type="checkbox" name="material_url_in_email" value="1" style="width:auto" ${Number((defaults as { material_url_in_email?: number }).material_url_in_email ?? 0) ? "checked" : ""}> メールの本文にもこのリンクを載せる</label><p class="muted small" style="margin:2px 0 0">重い資料を添付すると、相手が受け取れずに戻ってきたり、Gmailが一時停止されやすくなります。メールでもリンクで送る場合は、ここにチェックを入れて上の添付を削除してください。</p><p class="muted small">このアプリは各自のPCで動くため、アップロードしたファイルに外部から見えるURLは付けられません。フォーム用にはドライブ等で共有した公開リンクを貼ってください。</p></div></div>
</div>
<p id="stepnav" style="display:flex;gap:8px;align-items:center;margin-top:18px">
${editId ? "" : `<button type="button" class="btn" id="stepback" hidden>← 戻る</button><button type="button" class="btn primary" id="stepnext">次へ →</button>`}
<button class="btn primary" id="stepsubmit">${editId ? "保存する" : "作成する"}</button></p></form>
${editId ? "" : `<script>
// 新しいキャンペーンは3ステップで作る（#109）。30項目が1画面に並んでいて、どこまで入れればよいか分からなかったため。
// 入力内容は1つのフォームのままなので、途中で画面を離れても下書きとして残る。
(()=>{
  const steps=[1,2,3].map(i=>document.querySelector('[data-step="'+i+'"]'));
  const bar=document.getElementById("stepbar"),next=document.getElementById("stepnext"),back=document.getElementById("stepback"),submit=document.getElementById("stepsubmit");
  let cur=1;
  const show=(i)=>{cur=i;steps.forEach((el,k)=>{el.hidden=(k+1!==i)});bar.querySelectorAll("a").forEach(a=>a.classList.toggle("on",Number(a.dataset.go)===i));back.hidden=i===1;next.hidden=i===3;submit.hidden=i!==3;window.scrollTo({top:0,behavior:"smooth"});};
  // いまのステップの必須欄が空なら先に進ませない
  const valid=()=>{const bad=Array.from(steps[cur-1].querySelectorAll("input,select,textarea")).find(el=>!el.checkValidity());if(bad){bad.reportValidity();return false;}return true;};
  next.addEventListener("click",()=>{if(valid())show(cur+1)});
  back.addEventListener("click",()=>show(cur-1));
  bar.querySelectorAll("a").forEach(a=>{a.style.cursor="pointer";a.addEventListener("click",()=>{const to=Number(a.dataset.go);if(to<cur||valid())show(to)})});
  // 途中のステップに必須欄の未入力があるまま送信しようとした場合は、そのステップを開く
  document.getElementById("campform").addEventListener("invalid",(e)=>{const st=e.target.closest("[data-step]");if(st)show(Number(st.dataset.step))},true);
  show(1);
})();
</script>`}
${editId ? `<div class="card" style="border-color:var(--ng);margin-top:18px"><h2 style="margin-top:0;color:var(--ng)">キャンペーンを削除</h2>
<p class="muted small">このキャンペーンと、取り込んだ会社・送信履歴・スクリーンショット・添付資料をすべて削除します。<b>元に戻せません。</b><br>送信済みの記録も消えるため、その会社への「再送を止める期間」のチェックが効かなくなります。除外リスト（営業お断り等）は全キャンペーン共通なので残ります。</p>
<form method="post" action="/campaigns/${editId}/delete" data-n="${d("name")}" onsubmit="return confirm('キャンペーン「' + this.dataset.n + '」を削除します。取り込んだ会社・送信履歴もすべて消え、元に戻せません。よろしいですか？')"><button class="btn danger">このキャンペーンを削除する</button></form></div>` : ""}`;
}

/** CSV取込の結果。何件入ったかだけでなく、除外された会社名まで出す */
export function importReport(r: import("../csv.js").ImportSummary): string {
  const skipped = r.excludedRows;
  return `<div class="flash" style="margin-top:12px">登録 <b>${r.added}</b>件（フォーム${r.addedForm}・メール${r.addedEmail}） / 送らない <b>${r.excluded + r.suppressed + r.duplicated + r.noUrl}</b>件${r.noEntity && r.noEntity.length ? `<br><span style="color:var(--warn)">${IC_WARN} 法人格（株式会社など）が無い社名 ${r.noEntity.length}社。事前チェックでHPから自動補完します。</span>` : ""}</div>
${skipped.length ? `<details open style="margin-top:10px"><summary style="cursor:pointer;font-weight:700">送らない会社 ${skipped.length}件の内訳</summary>
<table style="margin-top:6px"><tr><th>会社名</th><th>理由</th><th>送信先</th></tr>
${skipped.map((x) => `<tr><td>${esc(x.company)}</td><td class="small">${esc(x.reason)}</td><td class="small">${esc((x.where || "").slice(0, 60))}</td></tr>`).join("")}
</table></details>` : ""}`;
}

export function campaignView(c: Campaign & { sender: SenderProfile }, jobs: Job[], counts: Record<string, number>, running: boolean, provider: string, extra: { preview?: { job: Job; subject: string; message: string; aiUsed: boolean; lint?: Lint[]; emailHtml?: string } | null; windowOk: boolean; sentToday: number; emailSentToday: number; scanning: boolean; unscanned: number; scanned: number; statusFilter?: string; qFilter?: string; outcomeFilter?: string; impFilter?: string; sortKey?: string; eta?: string; tab?: "prep" | "send" | "result"; page?: number; pageSize?: number; total?: number; companyTotal?: number; companyAll?: number; warmup?: { sent: number; limit: number; note: string } | null; ab?: { variant: string; sent: number; replied: number; appo: number }[]; undo?: { id: number; label: string; rows_count: number } | null; matched?: { n: number; sent: number }; attempts?: Record<string, number>; companyCounts?: Record<string, number>; outcomes: Record<string, number>; lastImport?: import("../csv.js").ImportSummary | null; retryTargets?: { id: number; company_name: string; status: string; result_text: string }[]; emailQueued?: number; period?: { todayForm: number; todayEmail: number; monthForm: number; monthEmail: number }; emailPaused?: { until: number; reason: string } | null; reactions?: { id: number; company_name: string; domain: string; email: string; channel: string; outcome: string; outcome_note: string; updated_at: string }[]; imports?: { key: string; label: string; at: string; total: number; sent: number; queued: number }[]; replyScan?: { enabled: boolean; checkedAt: string | null; error: string; checking: boolean } }) {
  // 「反応」欄の下に出す、返信の自動確認の状態（送信用メールの受信箱を15分ごとに読んで反応を自動記録している）
  const replyScanLine = () => {
    const r = extra.replyScan;
    if (!r) return "";
    if (!r.enabled) return `<p class="muted small" style="margin:4px 0 0">反応（返信／アポ／断り）は、送信者プロフィールに送信用メールアカウント（アプリパスワード）を設定すると、受信箱から自動で記録されます。今は会社の詳細画面のボタンで手動記録です。</p>`;
    const when = r.checkedAt ? new Date(r.checkedAt.replace(" ", "T") + "Z").toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "まだ";
    return `<form method="post" action="/replies/check" style="margin:4px 0 0;display:flex;gap:8px;align-items:center;flex-wrap:wrap"><input type="hidden" name="back" value="/campaigns/${c.id}"><span class="muted small">${IC_MAIL} 反応は受信箱の返信から自動で記録（15分ごと・キーワードで振り分け。最終確認: ${esc(when)}）。違っていたら会社の詳細画面で直せます</span><button class="btn sub small" ${r.checking ? "disabled" : ""}>${r.checking ? "確認中…" : "今すぐ返信を確認"}</button></form>`;
  };
  // 受信箱を読めないときは、画面の上に帯で出す（以前は赤い1行がタブの上に浮いていて、見落としやすかった）
  const replyScanError = extra.replyScan?.enabled && extra.replyScan.error ? `<div class="flash" style="background:var(--c-ng-bg);color:var(--c-ng);display:flex;gap:10px;align-items:center;flex-wrap:wrap">${IC_WARN} <span>${esc(extra.replyScan.error)}</span> <a class="btn small" href="/senders">送信者の設定を直す</a></div>` : "";
  const cnt = (s: string) => counts[s] ?? 0;
  const nRetry = extra.retryTargets?.length ?? 0; // 「失敗した会社を再送信」の対象数（会社単位・最新の結果が失敗のものだけ）
  // 「全体」は会社の実数（同じ会社は1つ）。状態ごとの合計だと、送り直しで状態が複数ある会社を二重に数えてしまい、
  // 一覧の件数と合わなかった（#125）
  const total = extra.companyAll ?? Object.values(counts).reduce((a, b) => a + b, 0);
  // 進捗バー用: 事前チェックは「チェック済み/対象」、本送信は「処理済み/全件」
  const scanTotal = extra.scanned + extra.unscanned;
  const scanPct = scanTotal ? Math.round((extra.scanned / scanTotal) * 100) : 0;
  const processed = total - cnt("queued");
  const sendPct = total ? Math.round((processed / total) * 100) : 0;
  // 3つのタブ（#98）。以前は全部が1画面に縦に並び、スクロール5画面分あった
  const tab = extra.tab ?? "prep";
  const show = (t: string) => (tab === t ? "" : " hidden");
  const tabLink = (t: string, label: string, cntText = "") => `<a class="${tab === t ? "on" : ""}" href="/campaigns/${c.id}?tab=${t}">${label}${cntText ? `<span class="cnt">${cntText}</span>` : ""}</a>`;
  const tabsNav = `<div class="tabs">${tabLink("prep", "① 準備", `${n(total)}社`)}${tabLink("send", "② 送信", cnt("queued") ? `待機 ${n(cnt("queued"))}社` : "")}${tabLink("result", "③ 結果", `送信済み ${n(cnt("sent"))}社`)}</div>`;
  // 反応の一覧（#126）。「どの会社が・何と言ったか」を先に、判定の根拠は折りたたみに
  const reactionsBlock = (() => {
    const list = extra.reactions ?? [];
    if (!list.length) return "";
    const order: Record<string, number> = { appointment: 0, replied: 1, declined: 2 };
    const sorted = [...list].sort((a, b) => (order[a.outcome] ?? 9) - (order[b.outcome] ?? 9));
    const said = (note: string) => (note.match(/本文「…?([\s\S]*?)…?」/)?.[1] ?? note).replace(/\s+/g, " ").trim().slice(0, 70);
    const nextStep: Record<string, string> = { appointment: "日程の返信をする", replied: "内容を確認して返信する", declined: "対応不要（今後は送りません）" };
    return `<div class="card" id="reactions"><h2 style="margin-top:0">反応（${n(list.length)}社）</h2>
<form method="post" action="/campaigns/${c.id}/outcomes/clear" onsubmit="return confirm(this.querySelectorAll('input[name=ids]:checked').length + '社の反応の判定を取り消します。よろしいですか？')">
<table class="resp"><tr><th style="width:34px"></th><th>会社</th><th style="width:110px">反応</th><th>相手の言葉</th><th style="width:210px">次にやること</th><th style="width:90px">日時</th></tr>
${sorted.map((r) => {
      const auto = r.outcome_note.startsWith("自動判定");
      return `<tr><td><input type="checkbox" name="ids" value="${r.id}"></td><td><a href="/jobs/${r.id}"><b>${esc(r.company_name)}</b></a><div class="muted" data-nohelp>${esc(r.email || r.domain)}</div></td>
<td><span class="tag ${r.outcome === "appointment" ? "sent" : r.outcome === "declined" ? "skip" : "sending"}">${esc(OUTCOME_LABEL[r.outcome] ?? r.outcome)}</span>${auto ? `<div class="muted" data-nohelp title="${esc(r.outcome_note)}">自動判定</div>` : ""}</td>
<td class="small">${esc(said(r.outcome_note)) || "—"}</td><td class="small">${esc(nextStep[r.outcome] ?? "")}</td><td class="small">${esc(jst(r.updated_at).slice(5))}</td></tr>`;
    }).join("")}
</table>
<div class="cards">${sorted.map((r) => `<div class="c"><h3><a href="/jobs/${r.id}">${esc(r.company_name)}</a></h3><span class="tag ${r.outcome === "appointment" ? "sent" : r.outcome === "declined" ? "skip" : "sending"}">${esc(OUTCOME_LABEL[r.outcome] ?? r.outcome)}</span><div class="small" style="margin-top:6px">${esc(said(r.outcome_note))}</div></div>`).join("")}</div>
<p style="margin:10px 0 0"><button class="btn small">選んだ判定を取り消す</button> <span class="muted" data-nohelp>自動判定が違っていたら、選んで取り消してください（判定の根拠は「自動判定」にマウスを乗せると出ます）</span></p>
</form></div>`;
  })();
  return `${extra.undo ? `<div class="card" style="background:#FFF3E0;border-color:var(--warn)"><b>直前の削除: ${esc(extra.undo.label)}（${extra.undo.rows_count}件）</b>
<form method="post" action="/undo/${extra.undo.id}" class="inline" style="margin-left:10px" data-busy><button class="btn">削除を元に戻す</button></form>
<p class="muted small" style="margin:6px 0 0">まちがえて消した場合は30分以内にここから戻せます（スクリーンショットの画像は戻りません）。</p></div>` : ""}
<p style="margin:0 0 6px"><a href="/campaigns">← キャンペーン一覧</a></p>
<div class="pagehead" style="margin-bottom:6px"><h1>${esc(c.name)} ${campaignStatusTag(c.status, running)}</h1>
<span style="display:flex;gap:8px;align-items:center">${running
    ? `<form method="post" action="/campaigns/${c.id}/pause" class="inline"><button class="btn danger">一時停止</button></form>`
    : cnt("queued") > 0 && tab !== "send" ? `<form method="post" action="/campaigns/${c.id}/start" class="inline" data-busy><input type="hidden" name="only" value="${esc(c.send_only ?? "")}"><button class="btn primary" data-busytext="送信を開始しています…" title="送信時間帯の中で、1日の上限を守って送ります。対象や時間帯を変えるときは「② 送信」タブから">開始する（${n(cnt("queued"))}社）</button></form>` : ""}
${moreMenu([`<a class="btn small" href="/campaigns/${c.id}/edit">設定を変える</a>`, `<a class="btn small" href="/campaigns/${c.id}/test">テスト送信</a>`, `<a class="btn small" href="/stats?campaign=${c.id}">日別・月別の推移</a>`, `<a class="btn small" href="/campaigns/${c.id}/export.json">設定をファイルに書き出す</a>`, "<hr>", `<button type="button" class="btn small" onclick="foHelpOpen({campaignId:${c.id}})">このキャンペーンについて質問する</button>`])}</span></div>
<p class="muted" data-nohelp style="margin:0 0 14px">${[
    `送信者 ${esc(c.sender.person || c.sender.company)}`,
    CHANNEL_LABEL[channelMode(c.channel)],
    `文面 ${esc(MODE_LABEL[c.mode] ?? c.mode)}`,
    `${c.send_window_start}〜${c.send_window_end}時${c.weekdays_only ? "（平日）" : ""}`,
    `1日の上限 フォーム${n(c.daily_limit)}・メール${n(c.email_daily_limit)}`,
    c.group_name ? `グループ ${esc(c.group_name)}` : "",
  ].filter(Boolean).join("　·　")}${extra.windowOk ? "" : ` <span class="tag queued" style="margin-left:6px">いまは送信時間帯外</span>`}</p>
${replyScanError}
${(() => {
    const att = extra.attempts ?? {};
    // 1社を1つの状態だけで数えた数（足すと「全体」と一致する）。経路側で用意が無ければ、状態ごとの数で代用する
    const cc = extra.companyCounts ?? counts;
    const cOf = (keys: string[]) => keys.reduce((a, k) => a + (cc[k] ?? 0), 0);
    const sentN = cOf(["sent"]);
    const waitN = cOf(["queued", "sending"]);
    const whyDefs: { label: string; keys: string[]; ng?: boolean; tip: string }[] = [
      { label: "画像認証", keys: ["skip_captcha"], tip: "画像認証（CAPTCHA）があり、自動では送れなかった会社。「要対応」から手作業で送れます" },
      { label: "営業お断りのサイト", keys: ["skip_refused"], tip: "サイトに「営業お断り」と書かれていたため、送らなかった会社" },
      { label: "除外・重複", keys: ["skip_suppressed", "skip_duplicate", "skip_optout", "skip_cancelled"], tip: "除外リスト・配信停止・再送を止める期間内・キャンセルで送らなかった会社" },
      { label: "フォーム無し", keys: ["skip_no_form"], tip: "問い合わせフォームもメールアドレスも見つからなかった会社" },
      { label: "失敗", keys: ["failed"], ng: true, tip: "送信の途中でエラーになった会社。送り直せます" },
    ];
    const whys = whyDefs.map((w) => ({ ...w, num: cOf(w.keys) })).filter((w) => w.num > 0);
    const ngN = Math.max(0, total - sentN - waitN);
    const pct = (x: number) => (total ? (x / total) * 100 : 0);
    const pctText = (x: number) => { const p = pct(x); return !total ? "" : x > 0 && p < 1 ? "1%未満" : `${Math.round(p)}%`; };
    const link = (status: string) => `/campaigns/${c.id}?tab=result&status=${status}`;
    const sentTries = att.sent ?? 0;
    const big = (cls: string, label: string, num: number, href: string, tip = "") => `<a class="ovnum ${cls}" href="${href}"${tip ? ` title="${esc(tip)}"` : ""}><span class="lbl"><i></i>${label}</span><b>${n(num)}<span class="unit">社</span></b><span class="pct">${pctText(num)}</span></a>`;
    // 反応。「アポ」と「返信で断られた」が一番知りたい数字。「営業お断りのサイト」（送らなかった理由）と混ざらないよう言い分ける
    const app = extra.outcomes.appointment ?? 0, dec = extra.outcomes.declined ?? 0, other = extra.outcomes.replied ?? 0;
    const all = app + dec + other;
    const sentAll = cnt("sent");
    const rate = sentAll ? (all / sentAll) * 100 : 0;
    const rateText = !sentAll ? "" : all === 0 ? "返信率 0%" : rate < 0.1 ? "返信率 0.1%未満" : `返信率 ${rate.toFixed(1)}%`;
    const p = extra.period;
    return `<div class="card ov" data-nohelp>
<div class="ovhead"><b>送信の進み具合</b><a href="/campaigns/${c.id}?tab=result">全体 ${n(total)}社</a></div>
<div class="ovbar" role="img" aria-label="送信済み ${n(sentN)}社・待機 ${n(waitN)}社・送れなかった ${n(ngN)}社">${sentN ? `<i class="ok" style="width:${pct(sentN).toFixed(2)}%"></i>` : ""}${waitN ? `<i class="wait" style="width:${pct(waitN).toFixed(2)}%"></i>` : ""}${ngN ? `<i class="off" style="width:${pct(ngN).toFixed(2)}%"></i>` : ""}</div>
<div class="ovnums">${big("ok", "送信済み", sentN, link("sent"), sentTries > sentN ? `送り直しを含めた送信の回数: ${n(sentTries)}回` : "")}${big("wait", "待機（これから送る）", waitN, link("queued"))}${big("off", "送れなかった", ngN, `/campaigns/${c.id}?tab=result`, "下の「理由」を押すと、その会社の一覧が開きます")}</div>
${whys.length ? `<div class="ovwhy"><span class="muted">送れなかった理由</span>${whys.map((w) => `<a class="chip${w.ng ? " ng" : ""}" href="${link(w.keys[0])}" title="${esc(w.tip)}">${w.label} <b>${n(w.num)}</b></a>`).join("")}</div>` : ""}
<div class="ovwhy" style="gap:6px 22px"><a href="/campaigns/${c.id}?tab=result#reactions" style="color:inherit;text-decoration:none"><span class="muted">返信</span> <b>${n(all)}</b>社${all ? `<span class="muted">（</span>アポ <b style="color:var(--c-ok)">${n(app)}</b><span class="muted">・</span>断り <b${dec ? ' style="color:var(--c-ng)"' : ""}>${n(dec)}</b><span class="muted">・</span>その他 <b>${n(other)}</b><span class="muted">）</span>` : ""}${rateText ? ` <span class="muted">${rateText}</span>` : ""}</a>${p ? `<a href="/stats?campaign=${c.id}" style="color:inherit;text-decoration:none"><span class="muted">今日</span> <b>${n(p.todayForm + p.todayEmail)}</b>社　<span class="muted">今月</span> <b>${n(p.monthForm + p.monthEmail)}</b>社</a>` : ""}</div>
</div>`;
  })()}

${tabsNav}
<div data-tab="prep"${show("prep")}>

<div class="card testcard"><h2 style="margin-top:0">テスト送信（本送信とは別）</h2>
<p class="muted">自社のフォームや自分のメール宛てに動作を試すための機能です。営業リストには送られず、下の送信フローとも無関係です。送信前に一度だけ確認しておくと安心です。</p>
<a class="btn" href="/campaigns/${c.id}/test">テスト送信ページを開く</a></div>

<div class="card"><h2 style="margin-top:0">① リストを取り込む</h2>
<p class="muted"><b>最低限、企業名と企業URL（HP）の2列があれば取り込めます。</b>問い合わせフォームは、HPから自動で探して送信します（AIは不要）。<br>使える見出し: 企業名 / 企業URL / 問い合わせフォーム / メール / 大業界 / 小業界 / 都道府県 / 代表者名（順不同・必要な列だけでOK）。問い合わせフォームのURLも入れておくと成功率が上がります。同一ドメイン・再送禁止期間内・除外リスト・官公庁等は自動で振り分けます。</p>
<form method="post" action="/campaigns/${c.id}/import" enctype="multipart/form-data">
<label>① ファイルから（CSV / Excel .xlsx）</label>
<input type="file" name="csv" accept=".csv,.xlsx,text/csv">
<label>② スプレッドシート・Excelからコピーして貼り付け（1行目は見出し）</label>
<textarea name="pasted" style="min-height:90px" placeholder="企業名（タブ区切り）問い合わせフォーム 企業URL メール …"></textarea>
<label>③ または Google スプレッドシートのURL</label>
<input type="url" name="sheet_url" placeholder="https://docs.google.com/spreadsheets/d/…">
<p class="muted small">URLで取り込むには、スプレッドシートの共有を「リンクを知っている全員（閲覧可）」にしてください。</p>
<p><button class="btn primary">取り込む</button> <a class="btn sub small" href="/template.csv">見本のCSVをダウンロード</a> <a class="small" href="/guide#step-list" target="_blank" rel="noopener">フォーム無し・失敗を減らすには？（AIでリストを整えるプロンプト）</a></p></form>
${extra.lastImport ? importReport(extra.lastImport) : ""}
${(() => {
    // 取り込み履歴。間違えて取り込んだ分を、取り込み1回ぶん丸ごと消せる（一覧は200件までなので、選択削除では消しきれない）
    const list = extra.imports ?? [];
    if (!list.length) return "";
    const busy = running || extra.scanning;
    const allTotal = list.reduce((a, b) => a + b.total, 0);
    const allSent = list.reduce((a, b) => a + b.sent, 0);
    const warnSent = (n: number) => (n ? `\\n\\n※ うち送信済み ${n}件の記録も消えます。消すとその会社への「${c.resend_days}日以内の再送防止」が効かなくなります。` : "");
    const when = (at: string) => { const d = new Date(String(at).replace(" ", "T") + "Z"); return isNaN(d.getTime()) ? esc(at) : d.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }); };
    return `<p style="margin:14px 0 0"><a class="btn sub small" href="/campaigns/${c.id}?imp=${encodeURIComponent(list[0].key)}#list">前回の取り込み（${when(list[0].at)}・${list[0].total}件）を一覧で見る・まとめて削除</a></p>
<details style="margin-top:10px" ${list.length ? "open" : ""}><summary style="cursor:pointer;font-weight:700">取り込み履歴（${list.length}回・${allTotal}件）</summary>
<p class="muted small" style="margin:6px 0">間違えて取り込んだ場合は、その回の「全件削除」で、その取り込みで入った会社をまとめて消せます（送信一覧・全件の数からも消えます）。${busy ? "<b>送信中・事前チェック中は削除できません。先に止めてください。</b>" : ""}</p>
<div style="overflow-x:auto"><table><tr><th>取り込んだ日時</th><th>取り込み元</th><th>件数</th><th>送信済み</th><th>待機</th><th></th></tr>
${list.map((b) => `<tr><td class="small">${when(b.at)}</td><td class="small">${esc(b.label)}</td><td>${b.total}</td><td>${b.sent}</td><td>${b.queued}</td><td><a class="btn sub small" href="/campaigns/${c.id}?imp=${encodeURIComponent(b.key)}#list">一覧を見る</a> <form method="post" action="/campaigns/${c.id}/imports/delete" class="inline" onsubmit="return confirm('${when(b.at)} に取り込んだ ${b.total}件を全件削除します（取り消せません）。${warnSent(b.sent)}\\n\\nよろしいですか？')"><input type="hidden" name="key" value="${esc(b.key)}"><button class="btn danger small" ${busy ? "disabled" : ""}>全件削除</button></form></td></tr>`).join("")}
</table></div>
<form method="post" action="/campaigns/${c.id}/jobs/delete-all" style="margin-top:8px" onsubmit="return confirm('このキャンペーンの会社 ${allTotal}件をすべて削除します（キャンペーンの設定・文面は残ります。取り消せません）。${warnSent(allSent)}\\n\\nよろしいですか？')"><button class="btn sub small" ${busy ? "disabled" : ""}>このキャンペーンの会社を全件削除（${allTotal}件）</button></form></details>`;
  })()}</div>

<div class="card"><h2 style="margin-top:0">② 事前チェック（送る前に連絡先を確認）${extra.scanning ? '<span class="tag sending"><span class="spin"></span>チェック中</span>' : extra.unscanned === 0 && extra.scanned > 0 ? '<span class="tag sent">チェック完了</span>' : ""}</h2>
<p class="muted">送らずに各社のサイトを見て、フォームの有無・営業お断り・画像認証を先に判定し、サイトのメールアドレスを拾います。フォームが無い会社はメールに自動で切り替わります（チャネルが「フォーム優先＋メール」のとき）。1社5〜10秒。</p>
${extra.emailQueued ? `<p class="small" style="margin:6px 0 10px;padding:8px 10px;background:var(--honey-50);border-radius:8px">${IC_MAIL} <b>メールで送る会社 ${extra.emailQueued}社</b>は事前チェックの対象外です（フォームを探す機能のため、下の件数には含まれません）。メールはそのまま「送信」タブの「開始」で送れます。1日に送る数は「1日の上限（メール）」までです。</p>` : ""}
${scanTotal > 0 ? `<div class="bar"><i id="scanfill" style="width:${scanPct}%"></i></div><div class="small muted" id="scantext">${extra.scanned} / ${scanTotal} 社チェック済み（${scanPct}%）</div>` : ""}
${extra.scanning ? `<form method="post" action="/campaigns/${c.id}/stop-scan" class="inline"><button class="btn danger">チェックを止める</button></form>` : `<form method="post" action="/campaigns/${c.id}/scan" class="inline"><button class="btn sub" ${extra.unscanned === 0 || running ? "disabled" : ""}>事前チェックを実行（未チェック ${extra.unscanned}社）</button></form>`}
${cnt("skip_no_form") > 0 && !extra.scanning && !running ? `<form method="post" action="/campaigns/${c.id}/rescan-noform" class="inline" onsubmit="return confirm('「フォーム無し」の ${cnt("skip_no_form")} 社を、もう一度チェックし直します（サイトマップ・フッター・外部フォームサービスにも対応した探し方で探します）。このあと「事前チェックを実行」を押してください。よろしいですか？')"><button class="btn sub">フォーム無しの ${cnt("skip_no_form")} 社をもう一度チェックする</button></form>
<p class="muted small" style="margin:6px 0 0">フォームの探し方を強化しています（サイトマップ・フッターのリンク・会社概要ページ経由・外部フォームサービス・URLの言い換え）。以前「フォーム無し」になった会社も、もう一度探すと見つかることがあります。</p>` : ""}</div>

<div class="card"><h2 style="margin-top:0">③ 文面を確認する</h2>
<form method="post" action="/campaigns/${c.id}/preview" class="inline" data-busy onsubmit="foPreviewProgress(${(c.mode === "ai" || c.mode === "hybrid") && provider !== "none"})"><button class="btn sub" data-busytext="文面を作成中…">先頭の1社で文面をプレビュー</button></form>
<div id="prevprog" hidden style="margin-top:10px"><div class="bar"><i id="prevfill" style="width:0%"></i></div><div class="small muted" id="prevpct">文面を作成しています… 0%</div></div>
<script>
function foPreviewProgress(useAi){
  if(!useAi) return; // テンプレのみは一瞬なので進捗は出さない
  const box=document.getElementById("prevprog"),fill=document.getElementById("prevfill"),pct=document.getElementById("prevpct");
  box.hidden=false; let p=0;
  // AI生成中は実測トークンが取れないため、なめらかに進めて完了間際で止める推定表示（ページ遷移で100%）
  const t=setInterval(()=>{p=Math.min(92,p+Math.max(1,(92-p)*0.08));fill.style.width=p+"%";pct.textContent="文面を作成しています… "+Math.round(p)+"%";},250);
  addEventListener("pagehide",()=>clearInterval(t),{once:true});
}
</script>
${extra.preview ? `<p class="muted">${esc(extra.preview.job.company_name)}（${esc(extra.preview.job.industry)}）向け ${extra.preview.aiUsed ? "・AI生成あり" : "・テンプレのみ"}</p><p><b>件名:</b> ${esc(extra.preview.subject)}</p>${(extra.preview.lint ?? []).map((l) => `<div class="small" style="color:${l.level === "error" ? "var(--ng)" : "var(--warn)"}">${l.level === "error" ? "✕" : "△"} ${esc(l.text)}</div>`).join("")}<pre>${esc(extra.preview.message)}</pre>
${extra.preview.emailHtml ? `<h2 style="font-size:14px;margin-top:16px">相手のメールソフトでの見え方（#70）</h2>
<div style="border:1px solid var(--hive-200);border-radius:10px;overflow:hidden;max-width:660px">
  <div style="background:var(--c-surface-2);padding:10px 12px;border-bottom:1px solid var(--hive-200);font-size:12px;line-height:1.8">
    <div><b>差出人:</b> ${esc(c.sender.company)} &lt;${esc(c.sender.from_email || c.sender.smtp_user || c.sender.email)}&gt;</div>
    <div><b>宛先:</b> ${esc(extra.preview.job.email || "（この会社のメールアドレス）")}</div>
    <div><b>件名:</b> ${esc(extra.preview.subject)}</div>
  </div>
  <div style="padding:14px;background:#fff">${extra.preview.emailHtml}</div>
</div>
<p class="muted small">署名・住所・配信停止の案内は、法律で必要なため自動で入ります。フォーム送信では本文だけが送られます。</p>` : ""}` : ""}
</div>

</div>
<div data-tab="send"${show("send")}>
${extra.warmup ? `<div class="card"><b>メールの上限（今日）: ${n(extra.warmup.sent)} / ${n(extra.warmup.limit)}通</b>
<div class="bar"><i style="width:${extra.warmup.limit ? Math.min(100, Math.round((extra.warmup.sent / extra.warmup.limit) * 100)) : 0}%"></i></div>
<div class="muted" data-nohelp>${extra.warmup.note ? esc(extra.warmup.note) : "通常の上限で送っています"}${extra.warmup.note ? "。新しいアカウントが止められないよう、2週間かけて自動で上限を引き上げます（設定を変える → ウォームアップ）" : ""}</div></div>` : ""}
<div class="card"><h2 style="margin-top:0">送信する${running ? ' <span class="tag sending"><span class="spin"></span>送信中</span>' : ""}${c.send_only ? ` <span class="tag">対象: ${c.send_only === "email" ? "メールの会社だけ" : "フォームの会社だけ"}</span>` : ""}</h2>
${extra.emailPaused ? `<div class="flash" style="background:var(--c-warn-bg);color:var(--c-warn);margin:0 0 12px"><b>メール送信を一時停止中</b>（${esc(new Date(extra.emailPaused.until).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }))} に自動で再開）<br><span class="small">${esc(extra.emailPaused.reason)}</span><br><span class="small muted">この送信者のメールの会社は「待機」のまま残しています（失敗にはしていません）。フォームの送信は続きます。原因を直したら「今すぐ再開」を押してください。Gmailが一時停止されている場合は、解除されるまで待ってから再開してください。</span>
<form method="post" action="/campaigns/${c.id}/email-resume" style="margin-top:6px"><button class="btn sub small">今すぐ再開</button></form></div>` : ""}
${total > 0 && running ? `<div class="bar"><i id="sendfill" style="width:${sendPct}%"></i></div><div class="small muted" id="sendtext">処理済み ${processed} / ${total} 社（${sendPct}%）</div>` : ""}${total > 0 && extra.eta ? `<div class="small muted" style="margin-bottom:8px">${esc(extra.eta)}</div>` : ""}
${running ? `<form method="post" action="/campaigns/${c.id}/pause" class="inline"><button class="btn danger">一時停止</button></form>` : `<form method="post" action="/campaigns/${c.id}/start" class="inline" data-busy><button class="btn primary" data-busytext="送信を開始しています…">開始する（${n(cnt("queued"))}社）</button> <label class="inline small">対象: <select name="only" style="width:auto;padding:4px 8px"><option value="" ${c.send_only ? "" : "selected"}>すべて（フォーム＋メール）</option><option value="email" ${c.send_only === "email" ? "selected" : ""}>メールの会社だけ</option><option value="form" ${c.send_only === "form" ? "selected" : ""}>フォームの会社だけ</option></select></label> <label class="inline small"><input type="checkbox" name="ignore_window" value="1"> 時間帯を無視して今すぐ送る</label></form>
<p class="muted small" style="margin:6px 0 0">フォームは「準備」タブの事前チェックを済ませてから送ると、フォーム無しの会社に無駄な時間を使いません。<b>メールだけ先に送りたいときは「対象: メールの会社だけ」</b>を選んでください（この設定は次に開始し直すまで続きます）。</p>`}
<div class="actrow">${nRetry > 0 ? `<form method="post" action="/campaigns/${c.id}/requeue-failed" class="inline" onsubmit="return confirm('失敗・フォーム無しの ${nRetry} 社を待機中に戻します（会社ごとに最新の結果が失敗のものだけ）。このあと「開始」で再送信できます。よろしいですか？')"><button class="btn sub">失敗した${n(nRetry)}社を送り直す</button></form> ${extra.retryTargets && extra.retryTargets.length ? `<details class="small" style="display:inline-block;vertical-align:middle;margin-right:8px"><summary style="cursor:pointer;color:var(--ng)">対象の会社を見る（${extra.retryTargets.length}社）</summary><ul style="margin:6px 0 0;padding-left:1.2em;max-height:220px;overflow:auto;text-align:left">${extra.retryTargets.map((t) => `<li><a href="/jobs/${t.id}">${esc(t.company_name)}</a> <span class="muted">${(STATUS_LABEL as Record<string, string>)[t.status] ?? t.status}：${esc((t.result_text || "").split("\n")[0].slice(0, 50))}</span></li>`).join("")}</ul></details>` : ""}` : ""}<details class="more"><summary class="btn sub">その他の操作</summary><div class="morebody">
<button class="btn sub" id="csvbtn" onclick="foExportCsv()">結果をCSVで書き出す</button>
<a class="btn sub" href="/campaigns/${c.id}/manual.csv" title="画像認証・失敗で送れなかった会社を、URLと文面つきで書き出します">手作業で送る会社のリストを書き出す</a>
${cnt("queued") > 0 ? `<form method="post" action="/campaigns/${c.id}/cancel-queued" class="inline" onsubmit="return confirm('待機中の ${cnt("queued")} 社をすべてキャンセルします。よろしいですか？（送信済みには影響しません）')"><button class="btn danger">待機中の${n(cnt("queued"))}社をすべてキャンセル</button></form>` : ""}
</div></details></div>
${running ? `<p class="muted" data-nohelp>送信中は進み具合が自動で更新され、終わると自動でページが切り替わります。</p>` : ""}</div>

</div>
<div data-tab="result"${show("result")}>
${reactionsBlock}
${replyScanLine()}
<h2 id="list">送信一覧（${n(extra.companyTotal ?? jobs.length)}社）</h2>
${(extra.total ?? 0) > (extra.companyTotal ?? 0) ? `<p class="muted" data-nohelp style="margin:-6px 0 8px">送り直した会社は、送るたびに1行ずつ残るので、一覧は ${n(extra.total)}行あります。</p>` : ""}
${STATUS_LEGEND}
<form method="get" action="/campaigns/${c.id}" class="inline" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><input type="hidden" name="tab" value="result">
<label class="inline small">状態:
<select name="status" onchange="this.form.submit()" style="width:auto;padding:4px 8px">
<option value="">すべて</option>
${(Object.entries(STATUS_LABEL) as [string, string][]).map(([k, l]) => `<option value="${k}" ${extra.statusFilter === k ? "selected" : ""}>${l}</option>`).join("")}
</select></label>
<label class="inline small">反応:
<select name="outcome" onchange="this.form.submit()" style="width:auto;padding:4px 8px">
<option value="">すべて</option>
<option value="replied" ${extra.outcomeFilter === "replied" ? "selected" : ""}>返信あり</option>
<option value="appointment" ${extra.outcomeFilter === "appointment" ? "selected" : ""}>アポ獲得</option>
<option value="declined" ${extra.outcomeFilter === "declined" ? "selected" : ""}>断り</option>
<option value="none" ${extra.outcomeFilter === "none" ? "selected" : ""}>反応なし</option>
</select></label>
${(extra.imports ?? []).length ? `<label class="inline small">取り込み:
<select name="imp" onchange="this.form.submit()" style="width:auto;padding:4px 8px">
<option value="">すべて</option>
${(extra.imports ?? []).map((b, i) => { const d = new Date(String(b.at).replace(" ", "T") + "Z"); const w = isNaN(d.getTime()) ? b.at : d.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }); return `<option value="${esc(b.key)}" ${extra.impFilter === b.key ? "selected" : ""}>${i === 0 ? "前回の取り込み：" : ""}${esc(w)} ${esc(b.label)}（${b.total}件）</option>`; }).join("")}
</select></label>` : ""}
<label class="inline small">会社名: <input type="text" name="q" value="${esc(extra.qFilter ?? "")}" placeholder="会社名・ドメイン" style="width:180px;padding:4px 8px"></label>
<button class="btn sub small">絞り込む</button>
${extra.statusFilter || extra.outcomeFilter || extra.qFilter || extra.impFilter ? `<a class="btn sub small" href="/campaigns/${c.id}?tab=result">解除</a>` : ""}
</form>
${extra.matched && extra.matched.n > 0 ? (() => {
    // 表示中の200件に限らず、いまの絞り込み条件に一致する全件を消す（条件なしなら全件）
    const filtered = Boolean(extra.statusFilter || extra.outcomeFilter || extra.qFilter || extra.impFilter);
    const busy = running || extra.scanning;
    const label = filtered ? `この絞り込みに一致する全件を削除（${extra.matched.n}件）` : `送信一覧の全件を削除（${extra.matched.n}件）`;
    const warn = extra.matched.sent ? `\\n\\n※ うち送信済み ${extra.matched.sent}件の記録も消えます。消すとその会社への「${c.resend_days}日以内の再送防止」が効かなくなります。` : "";
    // 全件削除は危ない操作なので、畳んでおく（以前は一覧のすぐ上に赤いボタンが常に出ていた）
    return `<details style="margin:8px 0"><summary class="muted small" style="cursor:pointer">一覧をまとめて削除する</summary><form method="post" action="/campaigns/${c.id}/delete-filtered" class="inline" style="margin:8px 0;display:block" onsubmit="return confirm('${filtered ? "いまの絞り込みに一致する" : "このキャンペーンの"}会社 ${extra.matched.n}件をすべて削除します（表示されていない分も含みます。取り消せません）。${warn}\\n\\nよろしいですか？')">
<input type="hidden" name="status" value="${esc(extra.statusFilter ?? "")}"><input type="hidden" name="outcome" value="${esc(extra.outcomeFilter ?? "")}"><input type="hidden" name="q" value="${esc(extra.qFilter ?? "")}"><input type="hidden" name="imp" value="${esc(extra.impFilter ?? "")}">
<button class="btn danger small" ${busy ? "disabled" : ""}>${label}</button>${busy ? ' <span class="muted small">送信中・事前チェック中は削除できません</span>' : ""}</form></details>`;
  })() : ""}
${(extra.ab ?? []).length >= 2 ? `<div class="card"><h2 style="margin-top:0">A/Bテストの結果</h2>
<table><tr><th>文面</th><th>送信</th><th>返信＋アポ</th><th>アポ</th><th>反応率</th></tr>
${(extra.ab ?? []).map((r) => `<tr><td><b>${esc(r.variant)}</b>${r.variant === "A" ? "（本文）" : "（本文B）"}</td><td>${r.sent}</td><td>${r.replied}</td><td>${r.appo}</td><td>${r.sent ? `${((r.replied / r.sent) * 100).toFixed(1)}%` : "-"}</td></tr>`).join("")}
</table>
<p class="muted small" style="margin:8px 0 0">件数が少ないうちは差が出ても偶然のことがあります。目安として、どちらも100件以上送ってから比べてください。</p></div>` : ""}
${(() => {
    // 並び替え・ページ送り（#51 #103）。いまの絞り込みは保ったまま付け替える
    const q = `tab=result&status=${encodeURIComponent(extra.statusFilter ?? "")}&outcome=${encodeURIComponent(extra.outcomeFilter ?? "")}&q=${encodeURIComponent(extra.qFilter ?? "")}&imp=${encodeURIComponent(extra.impFilter ?? "")}`;
    const base = `/campaigns/${c.id}?${q}`;
    const sortKey = extra.sortKey ?? "";
    const link = (key: string, label: string) => `<a href="${base}&sort=${key}&size=${extra.pageSize ?? 100}" style="text-decoration:${sortKey === key ? "underline" : "none"}">${label}${sortKey === key ? " ▾" : ""}</a>`;
    const page = extra.page ?? 1, size = extra.pageSize ?? 100, total = extra.total ?? jobs.length;
    const pages = Math.max(1, Math.ceil(total / size));
    const pageUrl = (pg: number, sz = size) => `${base}&sort=${sortKey}&size=${sz}&page=${pg}`;
    const pager = `<div class="pager">${page > 1 ? `<a class="btn small" href="${pageUrl(page - 1)}">← 前へ</a>` : ""}<span>${page} / ${pages} ページ</span>${page < pages ? `<a class="btn small" href="${pageUrl(page + 1)}">次へ →</a>` : ""}
<span style="margin-left:auto">1ページの件数: ${[50, 100, 200].map((sz) => sz === size ? `<b>${sz}</b>` : `<a href="${pageUrl(1, sz)}">${sz}</a>`).join("・")}</span></div>`;

    // 同じ会社への複数回の送信は、最新の1行だけを代表として表示し、古い履歴は ▽(N件) に畳む
    type G = { rep: Job; hist: Job[] };
    const byKey = new Map<string, G>();
    const groups: G[] = [];
    for (const j of jobs) {
      const key = j.is_test ? `test-${j.id}` : (j.domain || j.company_name);
      const g = byKey.get(key);
      if (!g) { const ng = { rep: j, hist: [] as Job[] }; byKey.set(key, ng); groups.push(ng); }
      else g.hist.push(j);
    }
    // 行に出す操作は、その会社でいま意味のある1つだけ。削除は危ない操作なので行には置かず、チェック→下の帯から行う
    const acts = (j: Job) => j.status === "queued" ? `<form method="post" action="/jobs/${j.id}/cancel" class="inline"><button class="btn small">キャンセル</button></form>` : j.status === "failed" || j.status === "skip_no_form" ? `<a class="btn small" href="/jobs/${j.id}#fix">直して送る</a>` : "";
    const sub = (j: Job) => [j.channel === "email" ? IC_MAIL : IC_FORM, ...[j.sub_industry || j.industry, j.domain].filter(Boolean).map((x) => esc(x))].join(" ");
    // 1社＝1段。会社／状態／結果（1行に省略。全文は会社を開いた先で）／更新／操作
    const repRow = (j: Job, hist: Job[]) => { const t = (j.result_text || "").split("\n")[0]; return `<tr data-u="${esc(j.updated_at ?? "")}"><td>${j.is_test ? "" : `<input type="checkbox" name="ids" value="${j.id}" form="bulkdel" onchange="foBulkCount()">`}</td>
<td class="cut"><a href="/jobs/${j.id}"><b>${esc(j.company_name)}</b></a>${j.is_test ? " <span class='tag'>テスト</span>" : ""}<span class="muted" data-nohelp>${sub(j)}</span></td>
<td class="cut">${statusTag(j.status)}${j.outcome ? ` <span class="tag ${j.outcome === "appointment" ? "sent" : j.outcome === "declined" ? "failed" : "sending"}">${esc(OUTCOME_LABEL[j.outcome] ?? j.outcome)}</span>` : ""}${hist.length ? ` <button type="button" class="histbtn" data-t="${j.id}" data-n="${hist.length}" onclick="foHist(this)" title="この会社への過去の送信">▽(${hist.length}件)</button>` : ""}</td>
<td class="cut small" title="${esc(t)}">${j.status === "sent" && j.attempts > 1 ? `<span class="muted">${j.attempts}回目で送信　</span>` : ""}${esc(t.slice(0, 80))}</td>
<td class="small muted">${esc(jst(j.updated_at).slice(5, 10))}</td><td class="acts">${acts(j)}</td></tr>`; };
    const histRow = (repId: number, h: Job) => `<tr class="histrow hist-${repId}" hidden><td></td><td colspan="5" class="small muted">└ ${esc(jst(h.updated_at))} ${statusTag(h.status)} ${errKindTag(h)}${esc((h.result_text || "").split("\n")[0].slice(0, 60))} <a href="/jobs/${h.id}">詳細</a></td></tr>`;
    const card = (j: Job, hist: Job[]) => `<div class="c"><h3><a href="/jobs/${j.id}">${esc(j.company_name)}</a></h3>${statusTag(j.status)}${j.outcome ? ` <span class="tag sending">${esc(OUTCOME_LABEL[j.outcome] ?? j.outcome)}</span>` : ""}
<div class="muted" data-nohelp style="margin-top:4px">${sub(j)}</div><div class="small">${esc((j.result_text || "").split("\n")[0].slice(0, 80))}</div><div class="acts">${acts(j)}</div></div>`;
    return `${pager}
<table class="resp dense"><tr><th style="width:34px"><input type="checkbox" title="このページを全選択" onchange="foSelAll(this)"></th><th>${link("company", "会社")}</th><th style="width:210px">${link("status", "状態")}</th><th>結果</th><th style="width:64px">${link("updated", "更新")}</th><th style="width:110px"></th></tr>
${groups.map((g) => repRow(g.rep, g.hist) + g.hist.map((h) => histRow(g.rep.id, h)).join("")).join("")}
</table>
<div class="cards">${groups.map((g) => card(g.rep, g.hist)).join("")}</div>
${pager}
<form id="bulkdel" class="bulkbar" hidden method="post" action="/campaigns/${c.id}/bulk-delete" onsubmit="return confirm(document.querySelectorAll('input[name=ids][form=bulkdel]:checked').length + ' 社を送信一覧から削除します（取り消せません。送信済みの記録も消え、その会社への再送防止は効かなくなります）。よろしいですか？')"><b id="bulkcnt">0社を選択中</b><button class="btn danger small" id="bulkbtn">一覧から削除</button></form>
${ZOOM_SNIPPET}`;
  })()}
</div>
<script>
// 削除の帯は、会社を選んだときだけ出す
function foBulkCount(){var n=document.querySelectorAll('input[name=ids][form=bulkdel]:checked').length;var bar=document.getElementById('bulkdel');if(!bar)return;bar.hidden=!n;document.getElementById('bulkcnt').textContent=n+'社を選択中';}
function foSelAll(cb){document.querySelectorAll('input[name=ids][form=bulkdel]').forEach(function(x){x.checked=cb.checked;});foBulkCount();}
async function foExportCsv(){
  const b=document.getElementById("csvbtn");if(b.disabled)return;
  const orig=b.textContent;b.disabled=true;b.textContent="書き出し中…";
  try{
    const r=await fetch("/campaigns/${c.id}/export.csv");
    if(!r.ok)throw new Error("HTTP "+r.status);
    const blob=await r.blob();
    const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="campaign-${c.id}-results.csv";a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),5000);
    b.textContent="書き出し済みです ✓";
  }catch(e){b.textContent="書き出しに失敗しました";}
  setTimeout(()=>{b.textContent=orig;b.disabled=false;},4000);
}
</script>
<script>
// ▽(N件): 同じ送信先への過去の送信履歴を開閉する（開閉状態は保存しない）
function foHist(btn){
  const open = btn.classList.toggle("open");
  document.querySelectorAll(".hist-" + btn.dataset.t).forEach((r) => { r.hidden = !open; });
  btn.textContent = (open ? "△(" : "▽(") + btn.dataset.n + "件)";
}
// 前回表示から更新された行をハイライト（ブラウザごとに localStorage で覚える）
(()=>{try{
  const key="fo_seen_${c.id}";const last=localStorage.getItem(key)||"";let max=last;
  document.querySelectorAll("tr[data-u]").forEach(tr=>{const u=tr.getAttribute("data-u")||"";if(u>max)max=u;if(last&&u>last)tr.classList.add("hl");});
  if(max)localStorage.setItem(key,max);
}catch(e){}})();
</script>
${extra.scanning || running ? `<script>
// 実行中: 2.5秒ごとに進捗を取り、バーを動かす。状態が変わったら（完了・停止）ページを更新する。
const wasScanning=${extra.scanning},wasRunning=${running};
async function foPoll(){try{
  const r=await fetch("/campaigns/${c.id}/progress");if(!r.ok)return;const p=await r.json();
  const sf=document.getElementById("scanfill"),st=document.getElementById("scantext");
  if(sf&&p.scanTotal){const pct=Math.round(p.scanDone/p.scanTotal*100);sf.style.width=pct+"%";if(st)st.textContent=p.scanDone+" / "+p.scanTotal+" 社チェック済み（"+pct+"%）";}
  const ef=document.getElementById("sendfill"),et=document.getElementById("sendtext");
  if(ef&&p.total){const pct=Math.round(p.processed/p.total*100);ef.style.width=pct+"%";if(et)et.textContent="処理済み "+p.processed+" / "+p.total+" 社（"+pct+"%）";}
  if(p.scanning!==wasScanning||p.running!==wasRunning)location.reload();
}catch(e){}}
setInterval(foPoll,2500);
setTimeout(()=>location.reload(),15000); // 一覧の中身も15秒ごとに更新
</script>` : ""}`;
}

/** テスト送信の専用ページ。自社フォーム宛ての動作確認と、テスト履歴 */
/** 取り込みプレビュー: 実際に登録する前に、先頭数行と件数内訳を見せて確認してもらう */
export function importPreviewView(c: Campaign & { sender: SenderProfile }, rows: import("../csv.js").CompanyRow[], summary: import("../csv.js").ImportSummary, srcLabel: string): string {
  const sample = rows.slice(0, 8);
  const cell = (v: string) => `<td class="small">${esc((v || "").slice(0, 40)) || '<span class="muted">―</span>'}</td>`;
  const willSend = summary.added, willSkip = summary.excluded + summary.suppressed + summary.duplicated + summary.noUrl;
  return `<h1>取り込みプレビュー <span class="tag">${esc(srcLabel)}</span></h1>
<p><a href="/campaigns/${c.id}">← ${esc(c.name)}</a></p>
<div class="card"><h2 style="margin-top:0">この内容で取り込みますか？</h2>
<p>読み込んだ行数: <b>${rows.length}</b>件　→　登録予定: <b style="color:var(--ok)">${willSend}</b>件（フォーム${summary.addedForm}・メール${summary.addedEmail}）／ 送らない: <b>${willSkip}</b>件</p>
<p class="muted small">送らない内訳: 除外/官公庁 ${summary.excluded} ・ 除外リスト ${summary.suppressed} ・ 重複/再送禁止 ${summary.duplicated} ・ 送信先なし ${summary.noUrl}</p>
${summary.noEntity && summary.noEntity.length ? `<p class="small" style="color:var(--warn)">${IC_WARN} 「株式会社」などの法人格が無い社名 <b>${summary.noEntity.length}</b>社：${esc(summary.noEntity.slice(0, 12).join("、"))}${summary.noEntity.length > 12 ? " ほか" : ""}<br><span class="muted">事前チェックのときに各社のHPの表記（フッター・会社概要）から正式名称を自動で補います（AI不要・無料）。HPで確認できなかった社は、取り込み後に社名をご確認ください。</span></p>` : ""}
<form method="post" action="/campaigns/${c.id}/import-confirm" class="inline" data-busy><button class="btn primary" data-busytext="取り込み中…">この内容で取り込む（${rows.length}行）</button></form>
<form method="post" action="/campaigns/${c.id}/import-cancel" class="inline"><button class="btn sub">やめる</button></form>
</div>
<h2>先頭 ${sample.length} 行の読み取り結果（列がずれていないか確認してください）</h2>
<p class="muted small">下の各列に正しい値が入っていれば、見出しの対応は合っています。ずれている場合は、取り込み元の1行目の見出し（企業名 / 企業URL / 問い合わせフォーム / メール …）をご確認ください。</p>
<div style="overflow-x:auto"><table><tr><th>企業名</th><th>問い合わせフォーム</th><th>企業URL</th><th>メール</th><th>業種</th><th>都道府県</th><th>代表者</th></tr>
${sample.map((r) => `<tr>${cell(r.company_name)}${cell(r.form_url)}${cell(r.site_url)}${cell(r.email)}${cell(r.sub_industry || r.industry)}${cell(r.prefecture)}${cell(r.representative)}</tr>`).join("")}
</table></div>
${summary.excludedRows.length ? `<details style="margin-top:12px"><summary style="cursor:pointer;font-weight:700">送らない会社 ${summary.excludedRows.length}件の内訳を見る</summary>
<table style="margin-top:6px"><tr><th>会社名</th><th>理由</th><th>送信先</th></tr>
${summary.excludedRows.slice(0, 200).map((x) => `<tr><td>${esc(x.company)}</td><td class="small">${esc(x.reason)}</td><td class="small">${esc((x.where || "").slice(0, 60))}</td></tr>`).join("")}
</table></details>` : ""}`;
}

export function testView(c: Campaign & { sender: SenderProfile }, tests: Job[]) {
  return `<h1>テスト送信 <span class="tag">${esc(c.name)}</span></h1>
<p><a href="/campaigns/${c.id}">← キャンペーンに戻る</a></p>
<div class="card"><h2 style="margin-top:0">自社のフォームに送って動作確認</h2>
<p class="muted">実在の他社には送らないでください。テスト送信は本送信の件数・履歴とは別に記録されます。</p>
<form method="post" action="/campaigns/${c.id}/test"><div class="row"><div><label>テスト先フォームURL</label><input type="url" name="url" required placeholder="https://自社サイト/contact/"></div><div><label>会社名（差し込み確認用）</label><input type="text" name="company" value="テスト株式会社"></div></div>
<p><button class="btn sub" name="dry" value="1">入力だけ試す（送信しない）</button> <button class="btn">実際に送信する</button></p></form>
${channelMode(c.channel) !== "form_only" ? `<form method="post" action="/campaigns/${c.id}/test"><label>メールのテスト（自分のアドレスに1通送る）</label><div class="row"><input type="email" name="email" placeholder="自分のメールアドレス"><button class="btn">テストメールを送る</button></div></form>` : ""}</div>
<h2>テスト履歴（最新20件）</h2>
${tests.length ? `<table><tr><th>ID</th><th>宛先</th><th>送り方</th><th>状態</th><th>結果</th><th>日時</th></tr>
${tests.map((j) => `<tr><td><a href="/jobs/${j.id}">${j.id}</a></td><td>${esc(j.company_name)}<br><span class="muted small">${esc(j.form_url || j.email)}</span></td><td class="small">${j.channel === "email" ? IC_MAIL + " メール" : IC_FORM + " フォーム"}</td><td>${statusTag(j.status)}</td><td class="small">${esc((j.result_text || "").split("\n")[0].slice(0, 70))}</td><td class="small">${esc(jst(j.updated_at))}</td></tr>`).join("")}
</table>` : '<p class="muted">まだテストしていません。</p>'}`;
}
