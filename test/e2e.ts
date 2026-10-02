// ダミーサイトを立てて、送信エンジンを通しで検証する。`npm test`
import http from "node:http";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

process.env.FO_NO_NOTIFY = "1"; // テスト中は通知を出さない
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fo-test-"));

const { getDb } = await import("../src/db.js");
const { importRowsToCampaign } = await import("../src/csv.js");
const { launchBrowser, scanCompany } = await import("../src/engine.js");
const { processJob } = await import("../src/worker.js");
const { DEFAULT_TEMPLATE: RAW_TEMPLATE } = await import("../src/message.js");
// 初期文面の【ここに…】は書き換えないと送信できない（文面チェックで止まる）ので、テスト用に埋めておく
const DEFAULT_TEMPLATE = RAW_TEMPLATE.replace(/【ここに[^】]*】/g, "テスト用のサービス説明です");

const received: Record<string, Record<string, string>> = {};
const simpleHits: Record<string, string>[] = [];
let ariaChoice = "", hiraKana = "", hira2Kana = "", hira2Posts = 0, backerrKana = "";
let itadakiHits = 0, cfm1Hits = 0, cfm2Hits = 0, recapHits = 0, modalHits = 0, resetHits = 0, reset2Hits = 0;

const page = (title: string, body: string) => `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${title}</title></head><body><header><nav><a href="/">ホーム</a> <a href="/company">会社概要</a> <a href="/recruit">採用情報</a> <a href="/simple">お問い合わせ</a></nav></header>${body}<footer>© Test Co.</footer></body></html>`;

function parseBody(req: http.IncomingMessage): Promise<Record<string, string>> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(Object.fromEntries(new URLSearchParams(data))));
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  const send = (html: string, code = 200) => { res.writeHead(code, { "content-type": "text/html; charset=utf-8" }); res.end(html); };
  const p = url.pathname;

  if (p === "/" || p === "/index.html") return send(page("テスト株式会社", `<h1>テスト株式会社</h1><p>私たちは福岡で飲食店を3店舗運営しています。</p><p><a href="/contact-page">お問い合わせはこちら</a></p><p>メール: <a href="mailto:info@test.co.jp">info@test.co.jp</a> / 採用: recruit@test.co.jp</p>`));
  if (p === "/contact-page") { res.writeHead(302, { location: "/simple" }); return res.end(); }

  // 1. 単一ページ型（Contact Form 7 風）
  if (p === "/simple" && req.method === "GET") return send(page("お問い合わせ", `
    <h1>お問い合わせ</h1><form method="post" action="/simple">
    <p><label>会社名 <input type="text" name="your-company"></label></p>
    <p><label>お名前 <span class="required">必須</span><input type="text" name="your-name" required></label></p>
    <p><label>フリガナ <input type="text" name="your-kana"></label></p>
    <p><label>メールアドレス <input type="email" name="your-email" required></label></p>
    <p><label>電話番号 <input type="tel" name="your-tel"></label></p>
    <p><label>件名 <input type="text" name="your-subject"></label></p>
    <p><label>お問い合わせ内容 <textarea name="your-message" required></textarea></label></p>
    <p><label><input type="checkbox" name="agree" value="1" required> 個人情報の取り扱いに同意する</label></p>
    <p><input type="submit" value="送信する"></p></form>
    <form action="/search"><input type="search" name="q" placeholder="サイト内検索"><button>検索</button></form>`));
  if (p === "/simple" && req.method === "POST") { received.simple = await parseBody(req); simpleHits.push(received.simple); return send(page("完了", `<h1>お問い合わせを受け付けました</h1><p>ありがとうございます。</p>`)); }

  // 2. 確認画面あり・テーブル型・分割項目
  if (p === "/confirm" && req.method === "GET") return send(page("お問い合わせフォーム", `
    <h1>お問い合わせフォーム</h1><form method="post" action="/confirm/check"><table>
    <tr><th>貴社名 <em>*</em></th><td><input type="text" name="company"></td></tr>
    <tr><th>ご担当者名 <em>*</em></th><td>姓 <input type="text" name="sei"> 名 <input type="text" name="mei"></td></tr>
    <tr><th>フリガナ</th><td>セイ <input type="text" name="sei_kana"> メイ <input type="text" name="mei_kana"></td></tr>
    <tr><th>メールアドレス</th><td><input type="text" name="email"></td></tr>
    <tr><th>メールアドレス（確認）</th><td><input type="text" name="email_confirm"></td></tr>
    <tr><th>電話番号</th><td><input type="text" name="tel1" size="4"> - <input type="text" name="tel2" size="4"> - <input type="text" name="tel3" size="4"></td></tr>
    <tr><th>郵便番号</th><td>〒 <input type="text" name="zip1" size="3"> - <input type="text" name="zip2" size="4"></td></tr>
    <tr><th>都道府県</th><td><select name="pref"><option value="">選択してください</option><option>東京都</option><option>福岡県</option></select></td></tr>
    <tr><th>ご住所</th><td><input type="text" name="address"></td></tr>
    <tr><th>お問い合わせ種別</th><td><label><input type="radio" name="kind" value="recruit">採用について</label><label><input type="radio" name="kind" value="service">サービスについて</label><label><input type="radio" name="kind" value="other">その他</label></td></tr>
    <tr><th>お問い合わせ内容</th><td><textarea name="body"></textarea></td></tr>
    </table><p><button type="button" onclick="history.back()">戻る</button> <button type="submit">確認画面へ</button></p></form>`));
  if (p === "/confirm/check" && req.method === "POST") {
    const b = await parseBody(req);
    const hidden = Object.entries(b).map(([k, v]) => `<input type="hidden" name="${k}" value="${String(v).replace(/"/g, "&quot;")}">`).join("");
    return send(page("入力内容の確認", `<h1>入力内容の確認</h1><table>${Object.entries(b).map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join("")}</table>
      <form method="post" action="/confirm/send">${hidden}<button type="submit" name="back" value="1" formaction="/confirm">修正する</button> <button type="submit">送信する</button></form>`));
  }
  if (p === "/confirm/send" && req.method === "POST") { received.confirm = await parseBody(req); res.writeHead(302, { location: "/confirm/thanks" }); return res.end(); }
  if (p === "/confirm/thanks") return send(page("送信完了", `<h1>送信完了</h1><p>お問い合わせいただきありがとうございました。</p>`));

  // 3. 営業お断り
  if (p === "/refused") return send(page("お問い合わせ", `<h1>お問い合わせ</h1><p class="note">※営業目的のお問い合わせはお断りしております。</p><form method="post"><input type="text" name="name" placeholder="お名前"><input type="email" name="email" placeholder="メール"><textarea name="msg"></textarea><button>送信</button></form>`));

  // 4. CAPTCHA
  if (p === "/captcha") return send(page("お問い合わせ", `<h1>お問い合わせ</h1><form method="post"><input type="text" name="name" placeholder="お名前"><input type="email" name="email" placeholder="メール"><textarea name="msg"></textarea><div class="g-recaptcha" data-sitekey="x" style="width:304px;height:78px;background:#eee">reCAPTCHA</div><button>送信</button></form>`));

  // 5. 入力エラーで弾かれる
  // ---- v0.3.91 以降に足したパターン（#119〜#122）----
  // A. 見た目だけの選択肢（Googleフォーム風の role=radio）。必須で、選ばないと「この質問は必須です」
  if (p === "/aria" && req.method === "GET") return send(page("お問い合わせ", `<h1>お問い合わせ</h1><form method="post" action="/aria"><p><label>お名前 <input type="text" name="name"></label></p><p><label>メール <input type="email" name="email"></label></p>
<div role="listitem"><div role="heading">ご用件 *</div><div role="radiogroup" aria-required="true"><div role="radio" aria-checked="false" data-value="採用について" tabindex="0">採用について</div><div role="radio" aria-checked="false" data-value="その他" tabindex="0">その他</div></div></div>
<input type="hidden" name="choice" id="choice"><p><label>内容 <textarea name="msg"></textarea></label></p><button>送信</button></form>
<script>document.querySelectorAll('[role=radio]').forEach(r=>r.addEventListener('click',()=>{document.querySelectorAll('[role=radio]').forEach(x=>x.setAttribute('aria-checked','false'));r.setAttribute('aria-checked','true');document.getElementById('choice').value=r.dataset.value;}));</script>`));
  if (p === "/aria" && req.method === "POST") { const b = await parseBody(req); if (!b.choice) return send(page("お問い合わせ", `<p class="error">この質問は必須です</p><form method="post" action="/aria"><textarea name="msg">${b.msg ?? ""}</textarea><button>送信</button></form>`)); ariaChoice = b.choice; return send(page("完了", "<p>送信が完了しました。</p>")); }
  // B. ひらがな指定（ラベルからは分からず、送ってみて「ひらがなで入力してください」と言われる）
  if (p === "/hira" && req.method === "GET") return send(page("お問い合わせ", `<h1>お問い合わせ</h1><form method="post" action="/hira"><p><label>お名前 <input type="text" name="name"></label></p><p><label>フリガナ <input type="text" name="kana"></label></p><p><label>メール <input type="email" name="email"></label></p><p><label>内容 <textarea name="msg"></textarea></label></p><button>送信</button></form>`));
  if (p === "/hira" && req.method === "POST") { const b = await parseBody(req); if (!/^[ぁ-ん]+$/.test(b.kana ?? "")) return send(page("お問い合わせ", `<p class="error">フリガナはひらがなで入力してください</p><form method="post" action="/hira"><p><label>お名前 <input type="text" name="name" value="${b.name ?? ""}"></label></p><p><label>フリガナ <input type="text" name="kana" value="${b.kana ?? ""}"></label></p><p><label>メール <input type="email" name="email" value="${b.email ?? ""}"></label></p><p><label>内容 <textarea name="msg">${b.msg ?? ""}</textarea></label></p><button>送信</button></form>`)); hiraKana = b.kana; return send(page("完了", "<p>送信が完了しました。</p>")); }
  // B'. ラベルに「ひらがな」と書いてある（最初からひらがなで入れる）
  if (p === "/hira2" && req.method === "GET") return send(page("お問い合わせ", `<h1>お問い合わせ</h1><form method="post" action="/hira2"><p><label>お名前 <input type="text" name="name"></label></p><p><label>ふりがな（ひらがな） <input type="text" name="kana"></label></p><p><label>メール <input type="email" name="email"></label></p><p><label>内容 <textarea name="msg"></textarea></label></p><button>送信</button></form>`));
  if (p === "/hira2" && req.method === "POST") { const b = await parseBody(req); hira2Kana = b.kana ?? ""; hira2Posts++; return send(page("完了", "<p>送信が完了しました。</p>")); }
  // C. 確認画面のあとで「前画面に戻って正しく入力してください」（フリガナにスペースがあると弾く）
  if (p === "/backerr" && req.method === "GET") return send(page("お問い合わせ", `<h1>お問い合わせ</h1><form method="post" action="/backerr"><p><label>お名前 <input type="text" name="name"></label></p><p><label>フリガナ <input type="text" name="kana"></label></p><p><label>メール <input type="email" name="email"></label></p><p><label>内容 <textarea name="msg"></textarea></label></p><button>確認する</button></form>`));
  if (p === "/backerr" && req.method === "POST") { const b = await parseBody(req); const h = (k: string) => `<input type="hidden" name="${k}" value="${(b[k] ?? "").replace(/"/g, "&quot;")}">`; return send(page("確認", `<h1>入力内容のご確認</h1><p>以下の内容で送信します。</p><form method="post" action="/backerr/send">${h("name")}${h("kana")}${h("email")}${h("msg")}<button>送信する</button></form><p><a href="/backerr">戻る</a></p>`)); }
  if (p === "/backerr/send" && req.method === "POST") { const b = await parseBody(req); if (/[\s　]/.test(b.kana ?? "")) return send(page("エラー", `<p class="error">前画面に戻って正しく入力してください</p><p><a href="/backerr">戻る</a></p>`)); backerrKana = b.kana ?? ""; return send(page("完了", "<p>送信が完了しました。</p>")); }
  // D. 送信ボタンが有効にならない（8桁の会員番号が必要）。送れないのが正しく、どの欄で止まったかを残せること
  if (p === "/disabled") return send(page("お問い合わせ", `<h1>お問い合わせ</h1><form method="post" action="/disabled"><p><label>お名前 <input type="text" name="name"></label></p><p><label>メール <input type="email" name="email"></label></p><p><label>会員番号 <input type="text" name="member" id="member" required pattern="\\d{8}"></label></p><p><label>内容 <textarea name="msg"></textarea></label></p><button id="go" disabled>送信</button></form>
<script>const m=document.getElementById('member'),g=document.getElementById('go');m.addEventListener('input',()=>{g.disabled=!/^\d{8}$/.test(m.value)});</script>`));

  if (p === "/strict" && req.method === "GET") return send(page("お問い合わせ", `<h1>お問い合わせ</h1><form method="post" action="/strict"><p><label>お名前 <input type="text" name="name"></label></p><p><label>メール <input type="email" name="email"></label></p><p><label>ご希望の来店日 <input type="text" name="visit_date"></label></p><p><label>内容 <textarea name="msg"></textarea></label></p><button>送信</button></form>`));
  if (p === "/strict" && req.method === "POST") { const b = await parseBody(req); return send(page("お問い合わせ", `<h1>お問い合わせ</h1><p class="error">ご希望の来店日を入力してください</p><form method="post" action="/strict"><input type="text" name="name" value="${b.name ?? ""}"><textarea name="msg">${b.msg ?? ""}</textarea><button>送信</button></form>`)); }


  // 7. dl型 + placeholderのみ + 埋め込みiframe の親ページ
  if (p === "/embed") return send(page("お問い合わせ", `<h1>お問い合わせ</h1><p>下のフォームからどうぞ</p><iframe src="/embed-form" style="width:100%;height:600px;border:0"></iframe>`));
  if (p === "/embed-form" && req.method === "GET") return send(`<!doctype html><html lang="ja"><head><meta charset="utf-8"></head><body><form method="post" action="/embed-form"><dl>
    <dt>会社名</dt><dd><input type="text" name="f1" placeholder="例）株式会社◯◯"></dd>
    <dt>お名前</dt><dd><input type="text" name="f2"></dd>
    <dt>メールアドレス</dt><dd><input type="text" name="f3"></dd>
    <dt>ご質問・ご相談内容</dt><dd><textarea name="f4"></textarea></dd></dl>
    <button type="submit">送信</button></form></body></html>`);
  if (p === "/embed-form" && req.method === "POST") { received.embed = await parseBody(req); return send(`<!doctype html><html><body><p>送信が完了しました。</p></body></html>`); }

  // 8. SPA風: formタグ無し、JSで送信、画面遷移なしで完了メッセージ。ハニーポット付き
  if (p === "/spa") return send(page("Contact", `<h1>Contact</h1>
    <div id="app">
      <label for="c">貴社名</label><input id="c">
      <label for="n">ご担当者名</label><input id="n">
      <label for="e">Email</label><input id="e" type="email">
      <label for="t">お電話番号</label><input id="t" type="tel">
      <label for="m">お問い合わせ内容</label><textarea id="m"></textarea>
      <input type="text" name="website2" style="position:absolute;left:-9999px" tabindex="-1" autocomplete="off">
      <input type="text" name="fax" placeholder="FAX番号">
      <label><input type="checkbox" id="ag"> プライバシーポリシーに同意する</label>
      <button id="go" type="button">送信する</button>
      <div id="done" style="display:none"></div>
    </div>
    <script>
      document.getElementById('go').onclick = async () => {
        if (!document.getElementById('ag').checked) { alert('同意が必要です'); return; }
        const hp = document.querySelector('[name=website2]').value;
        const body = new URLSearchParams({ c: c.value, n: n.value, e: e.value, t: t.value, m: m.value, hp });
        const r = await fetch('/spa/submit', { method: 'POST', body });
        document.getElementById('app').innerHTML = '<p>' + (await r.text()) + '</p>';
      };
    </script>`));
  if (p === "/spa/submit" && req.method === "POST") { const b = await parseBody(req); if (b.hp) { res.writeHead(400); return res.end("エラーが発生しました"); } received.spa = b; res.writeHead(200, { "content-type": "text/plain; charset=utf-8" }); return res.end("お問い合わせありがとうございます。送信完了しました。"); }

  // 9. 2段階（JSで次へ）: step1 会社・名前・メール → 次へ → step2 内容・連絡方法(必須ラジオ)・件名(select) → 送信 → /thanks へ（完了文言なし・URLで判定）
  if (p === "/steps" && req.method === "GET") return send(page("お問い合わせ", `<h1>お問い合わせ</h1><form method="post" action="/steps" id="f">
    <div id="s1"><p>会社名<br><input name="company"></p><p>お名前<br><input name="name"></p><p>メール<br><input name="email"></p><button type="button" id="next">次へ</button></div>
    <div id="s2" style="display:none">
      <p>件名<br><select name="subject"><option value="">選択してください</option><option>採用について</option><option>製品について</option><option>その他</option></select></p>
      <p>ご希望の連絡方法（必須）<br><label><input type="radio" name="how" value="mail" required>メール</label> <label><input type="radio" name="how" value="tel">電話</label></p>
      <p>内容<br><textarea name="body"></textarea></p>
      <button type="submit">送信</button></div>
    <script>document.getElementById('next').onclick=()=>{document.getElementById('s1').style.display='none';document.getElementById('s2').style.display='block';};</script></form>`));
  if (p === "/steps" && req.method === "POST") { received.steps = await parseBody(req); res.writeHead(302, { location: "/steps/thanks" }); return res.end(); }
  if (p === "/steps/thanks") return send(page("Thanks", `<h1>Thanks</h1><p>Your message has been received.</p>`));

  // 10. トップに英語の CONTACT リンクだけ（/inquiry）、カスタムチェックボックス（inputは非表示・ラベルクリック）
  if (p === "/en") return send(`<!doctype html><html lang="ja"><head><meta charset="utf-8"></head><body><h1>EN Corp</h1><footer><a href="/inquiry">CONTACT</a></footer></body></html>`);
  if (p === "/inquiry" && req.method === "GET") return send(page("INQUIRY", `<h1>INQUIRY</h1><form method="post" action="/inquiry">
    <table><tr><th>Company</th><td><input name="company"></td></tr><tr><th>Name</th><td><input name="name"></td></tr><tr><th>E-mail</th><td><input name="email"></td></tr><tr><th>Message</th><td><textarea name="message"></textarea></td></tr></table>
    <style>.cb input{position:absolute;opacity:0;width:0;height:0}.cb label{display:inline-block;padding:4px 8px;border:1px solid #333}</style>
    <div class="cb"><input type="checkbox" id="agree" name="agree" value="yes"><label for="agree">利用規約に同意する</label></div>
    <button type="submit">Send</button></form>`));
  if (p === "/inquiry" && req.method === "POST") { received.en = await parseBody(req); return send(page("Sent", `<h1>Thank you for contacting us!</h1>`)); }

  // 11. 必須の都道府県select + 「お問い合わせ種別」チェックボックス群 + 完了はページ内テキスト差し替え（同URL）
  if (p === "/multi" && req.method === "GET") return send(page("お問い合わせ", `<h1>お問い合わせ</h1><form method="post" action="/multi">
    <p>会社名 <input name="co" required></p><p>担当者 <input name="nm" required></p><p>メール <input name="ml" required></p>
    <p>都道府県 <select name="pref" required><option value="">--</option><option>東京都</option><option>大阪府</option></select></p>
    <p>お問い合わせ種別 <label><input type="checkbox" name="kind[]" value="a">資料請求</label><label><input type="checkbox" name="kind[]" value="b">お見積り</label><label><input type="checkbox" name="kind[]" value="c">その他</label></p>
    <p>内容 <textarea name="msg" required></textarea></p><button>送信する</button></form>`));
  if (p === "/multi" && req.method === "POST") { received.multi = await parseBody(req); return send(page("お問い合わせ", `<h1>お問い合わせ</h1><div class="done">お問い合わせを送信しました。担当者よりご連絡いたします。</div>`)); }


  // 12. 本文が input[type=text]、送信は input[type=image]、reCAPTCHA v3（invisible）、Cookieバナーが送信ボタンに被さる
  if (p === "/overlay" && req.method === "GET") return send(page("お問い合わせ", `<h1>お問い合わせ</h1><form method="post" action="/overlay">
    <p>会社名 <input name="company"></p><p>お名前 <input name="name"></p><p>メール <input name="email"></p>
    <p>お問い合わせ内容 <input type="text" name="naiyo"></p>
    <div class="g-recaptcha" data-size="invisible" data-sitekey="x"></div>
    <input type="image" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="送信する"></form>
    <div id="cookie" style="position:fixed;left:0;right:0;bottom:0;height:120px;background:#333;color:#fff;z-index:9999">Cookieを使用しています <button type="button" onclick="this.parentNode.remove()">OK</button></div>`));
  if (p === "/overlay" && req.method === "POST") { received.overlay = await parseBody(req); return send(page("完了", `<h1>送信完了しました</h1>`)); }


  // 13. 電話は半角数字のみ（maxlength=11）、本文は maxlength=120、フォームページに「ありがとうございます」が最初からある
  if (p === "/strictnum" && req.method === "GET") return send(page("お問い合わせ", `<h1>お問い合わせ</h1><p>いつもご利用ありがとうございます。お問い合わせは下記フォームからお願いします。</p><form method="post" action="/strictnum">
    <p>会社名 <input name="company"></p><p>お名前 <input name="name"></p><p>メール <input name="email"></p>
    <p>電話番号（半角数字のみ） <input name="tel" maxlength="11" inputmode="numeric"></p>
    <p>内容 <textarea name="msg" maxlength="120"></textarea></p><button>送信</button></form>`));
  if (p === "/strictnum" && req.method === "POST") { const b = await parseBody(req); if (!/^\d+$/.test(b.tel ?? "")) return send(page("お問い合わせ", `<h1>お問い合わせ</h1><p>いつもご利用ありがとうございます。</p><p class="error">電話番号は半角数字で入力してください</p>`)); received.strictnum = b; return send(page("完了", `<h1>送信完了</h1>`)); }

  // 15. 「姓・名」ラベル1つに入力欄2つ（di-v.co.jp の実例）＋「フリガナ（セイ・メイ）」も同じ形。
  //     欄を単独判定すると2欄とも「姓」になり「山田 山田」と入る事故があった。同じ値ならエラーにする
  if (p === "/seimei" && req.method === "GET") return send(page("お問い合わせ", `<h1>お問い合わせ</h1><form method="post" action="/seimei"><table>
    <tr><th>会社名</th><td><input type="text" name="co"></td></tr>
    <tr><th>姓・名</th><td><input type="text" name="nm1"> <input type="text" name="nm2"></td></tr>
    <tr><th>フリガナ（セイ・メイ）</th><td><input type="text" name="kn1"> <input type="text" name="kn2"></td></tr>
    <tr><th>メールアドレス</th><td><input type="email" name="mail"></td></tr>
    <tr><th>お問い合わせ内容</th><td><textarea name="msg"></textarea></td></tr></table><button>送信</button></form>`));
  if (p === "/seimei" && req.method === "POST") { const b = await parseBody(req); if (!b.nm1 || !b.nm2 || b.nm1 === b.nm2 || (b.kn1 && b.kn1 === b.kn2)) return send(page("お問い合わせ", `<h1>お問い合わせ</h1><p class="error">姓と名を正しく入力してください</p>`)); received.seimei = b; return send(page("完了", `<h1>送信完了</h1><p>お問い合わせを受け付けました。</p>`)); }

  // 16. 完了ページが同じURLで「お問い合わせいただきありがとうございます。担当者より、追ってご連絡いたします。」だけ（aidas.co.jp の実例）。
  //     以前は完了と判定できず「判定不能→失敗」になり、自動再試行で二重送信していた。POST回数も数える
  if (p === "/itadaki" && req.method === "GET") return send(page("お問い合わせ", `<h1>お問い合わせ</h1><p>お電話でのお問い合わせ：03-0000-0000</p><form method="post" action="/itadaki"><p>会社名 <input name="co"></p><p>お名前 <input name="nm"></p><p>メール <input type="email" name="mail"></p><p>内容 <textarea name="msg"></textarea></p><button>送信</button></form>`));
  if (p === "/itadaki" && req.method === "POST") { received.itadaki = await parseBody(req); itadakiHits++; return send(page("お問い合わせ", `<h1>お問い合わせ</h1><p>お電話でのお問い合わせ：03-0000-0000</p><p>お問い合わせいただきありがとうございます。<br>担当者より、追ってご連絡いたします。</p>`)); }

  // 17. ボタン名が「送信内容を確認する」→ 確認画面 →「送信する」（b-coach.jp の実例）。確認画面を送信済みと誤判定していた
  if (p === "/cfm1" && req.method === "GET") return send(page("お問い合わせ", `<h1>CONTACT</h1><form method="post" action="/cfm1/check"><p>お名前 <input name="nm"></p><p>メール <input type="email" name="mail"></p><p>内容 <textarea name="msg"></textarea></p><button>送信内容を確認する</button></form>`));
  if (p === "/cfm1/check" && req.method === "POST") { const b = await parseBody(req); return send(page("お問い合わせ", `<h1>CONTACT</h1><p>下記の内容で送信します。</p><p>入力内容をご確認の上、「送信する」ボタンを押してください。</p><form method="post" action="/cfm1/done"><input type="hidden" name="nm" value="${b.nm ?? ""}"><input type="hidden" name="msg" value="${(b.msg ?? "").replace(/"/g, "&quot;")}"><p>お名前: ${b.nm ?? ""}</p><button>送信する</button></form>`)); }
  if (p === "/cfm1/done" && req.method === "POST") { received.cfm1 = await parseBody(req); cfm1Hits++; return send(page("お問い合わせ", `<h1>送信完了</h1><p>送信が完了しました。</p>`)); }
  // 18. ボタン名は「送信する」だが実は確認画面に進む（ボタン名では見分けられない）→ 確認画面の文言で検知して「この内容で送信」
  if (p === "/cfm2" && req.method === "GET") return send(page("お問い合わせ", `<h1>お問い合わせ</h1><form method="post" action="/cfm2/check"><p>お名前 <input name="nm"></p><p>メール <input type="email" name="mail"></p><p>内容 <textarea name="msg"></textarea></p><button>送信する</button></form>`));
  if (p === "/cfm2/check" && req.method === "POST") return send(page("お問い合わせ", `<h1>お問い合わせ</h1><p>以下の内容で送信します。よろしければボタンを押してください。</p><form method="post" action="/cfm2/done"><input type="hidden" name="ok" value="1"><button>この内容で送信</button></form>`));
  if (p === "/cfm2/done" && req.method === "POST") { cfm2Hits++; return send(page("お問い合わせ", `<h1>送信完了</h1><p>お問い合わせを受け付けました。</p>`)); }
  // 19. 送信を押すと reCAPTCHA の画像認証ポップアップが出て送れない（sugoikaizen.com の実例）。送信済みと誤判定していた
  if (p === "/recap" && req.method === "GET") return send(page("お問い合わせ", `<h1>お問い合わせ</h1>
    <div style="position:absolute;top:-10000px;visibility:hidden"><iframe src="about:blank#recaptcha/api2/bframe" width="400" height="580"></iframe></div>
    <form id="f" method="post" action="/recap"><p>お名前 <input name="nm"></p><p>メール <input type="email" name="mail"></p><p>内容 <textarea name="msg"></textarea></p><button id="sb">送信</button></form>
    <script>document.getElementById('f').addEventListener('submit',function(e){e.preventDefault();document.getElementById('f').style.display='none';var d=document.createElement('div');d.style.cssText='position:fixed;top:40px;left:40px;z-index:9999';d.innerHTML='<iframe src="about:blank#recaptcha/api2/bframe" width="400" height="580"></iframe>';document.body.appendChild(d);});</script>`));
  if (p === "/recap" && req.method === "POST") { recapHits++; return send(page("完了", `<h1>送信完了</h1>`)); }

  // 20. 送信ボタン → ページ内ポップアップ「この内容で送信します。よろしいですか？」→ ポップアップ内の「送信」（di-v.co.jp の実例）。
  //     ポップアップの「送信」を押したときだけ confirmed=1 が付き、それ以外のPOSTはエラーにする（後ろの元ボタンを押しても通らない）
  if (p === "/modal" && req.method === "GET") return send(page("お問い合わせ", `<h1>お問い合わせ</h1>
    <form id="mf" method="post" action="/modal"><input type="hidden" name="confirmed" id="cf" value=""><p>会社名 <input name="co"></p><p>お名前 <input name="nm"></p><p>メール <input type="email" name="mail"></p><p>内容 <textarea name="msg"></textarea></p><button type="button" id="open">送信する</button></form>
    <script>document.getElementById('open').onclick=function(){if(document.getElementById('ov'))return;var d=document.createElement('div');d.id='ov';d.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000;display:flex;align-items:center;justify-content:center';d.innerHTML='<div style="background:#fff;padding:20px"><p>この内容で送信します。よろしいですか？</p><button type="button" id="cancel">キャンセル</button> <button type="button" id="go">送信</button></div>';document.body.appendChild(d);document.getElementById('cancel').onclick=function(){d.remove();};document.getElementById('go').onclick=function(){document.getElementById('cf').value='1';document.getElementById('mf').submit();};};</script>`));
  if (p === "/modal" && req.method === "POST") { const b = await parseBody(req); if (b.confirmed !== "1") return send(page("お問い合わせ", `<h1>お問い合わせ</h1><p class="error">確認画面から送信してください</p>`)); modalHits++; return send(page("完了", `<h1>送信完了</h1><p>お問い合わせを受け付けました。</p>`)); }

  // 22. 送信ボタンを押すと、同じページのまま入力内容が全部消えて「ご回答ありがとうございました。」だけが出る（実例）。
  //     /reset2 は定型の完了文言も無く「ありがとうございました。」だけ。どちらもヘッダーに送信前から「ありがとうございます」がある
  for (const [rp, thanks] of [["/reset", "ご回答ありがとうございました。"], ["/reset2", "ありがとうございました。"]] as const) {
    if (p === rp && req.method === "GET") return send(page("お問い合わせ", `<h1>お問い合わせ</h1><p>弊社にご興味をお持ちいただきまして、ありがとうございます。</p><p id="done"></p>
      <form id="rf"><p>会社名 <input name="co"></p><p>お名前 <input name="nm"></p><p>メール <input type="email" name="mail"></p><p>内容 <textarea name="msg"></textarea></p><button id="sb">送信</button></form><p>営業日にご対応します</p>
      <script>document.getElementById('rf').addEventListener('submit',function(e){e.preventDefault();fetch('${rp}',{method:'POST',body:new URLSearchParams(new FormData(this))}).then(function(){document.getElementById('rf').reset();document.getElementById('done').textContent='${thanks}';});});</script>`));
    if (p === rp && req.method === "POST") { await parseBody(req); if (rp === "/reset") resetHits++; else reset2Hits++; return send("ok"); }
  }

  // 14. Cloudflare 風のブラウザ確認ページ
  if (p === "/challenge") return send(`<!doctype html><html><head><meta charset="utf-8"><title>Just a moment...</title></head><body><h1>Checking your browser before accessing the site.</h1><form><textarea name="x"></textarea><input name="y"><button>Continue</button></form></body></html>`);

  // 21. メール送信の会社の社名補完用（ブラウザを使わずにHPの文字だけを読む）。
  //     /legal-utf8: フッターに正式名称。/legal-sjis: 古いサイトに多い Shift_JIS（文字コード判定の確認）。
  //     /legal-sub: トップには無く /company/ にだけ正式名称（会社概要ページまで見に行くかの確認）
  if (p === "/legal-utf8") return send(`<!doctype html><html><head><meta charset="utf-8"><title>ホーム</title></head><body><p>ようこそ</p><footer>Copyright &copy; 2026 株式会社メール補完 All Rights Reserved.</footer></body></html>`);
  if (p === "/legal-sjis") { res.writeHead(200, { "content-type": "text/html" }); return res.end(Buffer.from("3c21646f63747970652068746d6c3e3c68746d6c3e3c686561643e3c6d65746120636861727365743d2253686966745f4a4953223e3c7469746c653e837a815b83803c2f7469746c653e3c2f686561643e3c626f64793e3c703e82e682a482b182bb3c2f703e3c666f6f7465723e436f707972696768742026636f70793b2032303236208a948eae89ef8ed0835683748367835783588fa48e9620416c6c205269676874732052657365727665642e3c2f666f6f7465723e3c2f626f64793e3c2f68746d6c3e", "hex")); }
  if (p === "/company" || p === "/company/") return send(page("会社概要", `<h1>会社概要</h1><p>商号 合同会社サブページ</p>`));
  if (p === "/recruit") return send(page("採用情報", `<h1>採用情報</h1><form method="post" action="/recruit"><input name="name"><textarea name="pr"></textarea><button>応募する</button></form>`));
  send(page("404", "<h1>Not Found</h1>"), 404);
});

await new Promise<void>((r) => server.listen(0, r));
const port = (server.address() as { port: number }).port;
const base = `http://127.0.0.1:${port}`;
console.log("dummy site:", base);

const db = getDb();
const senderId = db.prepare(`INSERT INTO sender_profiles(label,company,industry,person,person_kana,email,tel,postal,address,url) VALUES(?,?,?,?,?,?,?,?,?,?)`)
  .run("test", "株式会社サンプル商事", "動画制作", "山田 太郎", "ヤマダ タロウ", "sales@example.com", "03-1234-5678", "114-0001", "東京都北区1-2-3", "https://example.com").lastInsertRowid;
const campaignId = db.prepare(`INSERT INTO form_campaigns(name,sender_id,mode,subject_text,template_text) VALUES(?,?,?,?,?)`)
  .run("e2e", senderId, "template", "{{会社名}}様へ ショート動画のご案内", DEFAULT_TEMPLATE).lastInsertRowid as number;

const rows: import("../src/csv.js").CompanyRow[] = [
  { company_name: "シンプル商事", form_url: `${base}/simple`, site_url: base, email: "", industry: "飲食", sub_industry: "居酒屋", prefecture: "福岡県", representative: "山田太郎" },
  { company_name: "確認画面工業", form_url: `${base}/confirm`, site_url: "", email: "", industry: "製造", sub_industry: "", prefecture: "", representative: "" },
  { company_name: "お断り物産", form_url: `${base}/refused`, site_url: "", email: "", industry: "", sub_industry: "", prefecture: "", representative: "" },
  { company_name: "キャプチャ株式会社", form_url: `${base}/captcha`, site_url: "", email: "", industry: "", sub_industry: "", prefecture: "", representative: "" },
  { company_name: "厳格クリニック", form_url: `${base}/strict`, site_url: "", email: "", industry: "", sub_industry: "", prefecture: "", representative: "" },
  { company_name: "リンク探索社", form_url: "", site_url: base, email: "", industry: "", sub_industry: "", prefecture: "", representative: "" },
  { company_name: "役所", form_url: "https://www.city.example.lg.jp/contact", site_url: "", email: "", industry: "", sub_industry: "", prefecture: "", representative: "" },
  { company_name: "埋め込みフォーム社", form_url: `${base}/embed`, site_url: "", email: "", industry: "", sub_industry: "", prefecture: "", representative: "" },
  { company_name: "SPA株式会社", form_url: `${base}/spa`, site_url: "", email: "", industry: "", sub_industry: "", prefecture: "", representative: "" },
  { company_name: "二段階商会", form_url: `${base}/steps`, site_url: "", email: "", industry: "", sub_industry: "", prefecture: "", representative: "" },
  { company_name: "EN Corp", form_url: "", site_url: `${base}/en`, email: "", industry: "", sub_industry: "", prefecture: "", representative: "" },
  { company_name: "マルチ選択社", form_url: `${base}/multi`, site_url: "", email: "", industry: "", sub_industry: "", prefecture: "", representative: "" },
  { company_name: "オーバーレイ社", form_url: `${base}/overlay`, site_url: "", email: "", industry: "", sub_industry: "", prefecture: "", representative: "" },
  { company_name: "半角数字社", form_url: `${base}/strictnum`, site_url: "", email: "", industry: "", sub_industry: "", prefecture: "", representative: "" },
  { company_name: "チャレンジ社", form_url: `${base}/challenge`, site_url: "", email: "", industry: "", sub_industry: "", prefecture: "", representative: "" },
  { company_name: "姓名一体社", form_url: `${base}/seimei`, site_url: "", email: "", industry: "", sub_industry: "", prefecture: "", representative: "" },
  { company_name: "御礼文言社", form_url: `${base}/itadaki`, site_url: "", email: "", industry: "", sub_industry: "", prefecture: "", representative: "" },
  { company_name: "確認ボタン社", form_url: `${base}/cfm1`, site_url: "", email: "", industry: "", sub_industry: "", prefecture: "", representative: "" },
  { company_name: "確認画面文言社", form_url: `${base}/cfm2`, site_url: "", email: "", industry: "", sub_industry: "", prefecture: "", representative: "" },
  { company_name: "送信後認証社", form_url: `${base}/recap`, site_url: "", email: "", industry: "", sub_industry: "", prefecture: "", representative: "" },
  { company_name: "確認ポップアップ社", form_url: `${base}/modal`, site_url: "", email: "", industry: "", sub_industry: "", prefecture: "", representative: "" },
  { company_name: "同ページ完了社", form_url: `${base}/reset`, site_url: "", email: "", industry: "", sub_industry: "", prefecture: "", representative: "" },
  { company_name: "お礼だけ社", form_url: `${base}/reset2`, site_url: "", email: "", industry: "", sub_industry: "", prefecture: "", representative: "" },
  { company_name: "見た目選択社", form_url: `${base}/aria`.replace("127.0.0.1", "e30.localhost"), site_url: "", email: "", industry: "", sub_industry: "", prefecture: "", representative: "" },
  { company_name: "ひらがな社", form_url: `${base}/hira`.replace("127.0.0.1", "e31.localhost"), site_url: "", email: "", industry: "", sub_industry: "", prefecture: "", representative: "" },
  { company_name: "ひらがな表記社", form_url: `${base}/hira2`.replace("127.0.0.1", "e32.localhost"), site_url: "", email: "", industry: "", sub_industry: "", prefecture: "", representative: "" },
  { company_name: "前画面エラー社", form_url: `${base}/backerr`.replace("127.0.0.1", "e33.localhost"), site_url: "", email: "", industry: "", sub_industry: "", prefecture: "", representative: "" },
  { company_name: "ボタン無効社", form_url: `${base}/disabled`.replace("127.0.0.1", "e34.localhost"), site_url: "", email: "", industry: "", sub_industry: "", prefecture: "", representative: "" },
];
// 同一ドメインは1件に寄せられるため、ドメイン重複を避けるために localhost 名を変えて登録
rows[5].site_url = `http://localhost:${port}/`;
const alias = (i: number, host: string) => { rows[i].form_url = rows[i].form_url.replace("127.0.0.1", host); };
// 以前は 127.0.0.2〜14 を使っていたが、macOSでは sudo ifconfig lo0 alias が必要で再起動のたびに消えるため、
// 何も設定しなくても 127.0.0.1 に解決される <名前>.localhost 方式に変更した。
alias(1, "e2.localhost"); alias(2, "e3.localhost"); alias(3, "e4.localhost"); alias(4, "e5.localhost");
alias(7, "e7.localhost"); alias(8, "e8.localhost"); alias(9, "e9.localhost"); rows[10].site_url = rows[10].site_url.replace("127.0.0.1", "e10.localhost"); alias(11, "e11.localhost"); alias(12, "e12.localhost"); alias(13, "e13.localhost"); alias(14, "e14.localhost"); alias(15, "e15.localhost"); alias(16, "e16.localhost"); alias(17, "e17.localhost"); alias(18, "e18.localhost"); alias(19, "e19.localhost"); alias(20, "e20.localhost"); alias(21, "e21.localhost"); alias(22, "e22.localhost");

const summary = importRowsToCampaign(campaignId, rows);
console.log("import:", summary);
assert.equal(summary.added, 27);
assert.equal(summary.excluded, 1);

const browser = await launchBrowser();
const results: Record<string, string> = {};
try {
  const jobs = db.prepare("SELECT id, company_name FROM form_jobs WHERE campaign_id=? AND status='queued'").all(campaignId) as { id: number; company_name: string }[];
  for (const j of jobs) {
    const r = await processJob(browser, j.id);
    results[j.company_name] = r.status;
    console.log(`- ${j.company_name}: ${r.status} | ${r.result_text.split("\n")[0]}`); if (process.env.FO_DEBUG) console.log(r.result_text);
  }
} finally {
  await browser.close();
}

assert.equal(results["シンプル商事"], "sent");
// #119 見た目だけの選択肢: 必須の設問に「その他」を選んで送れる
assert.equal(results["見た目選択社"], "sent");
assert.equal(ariaChoice, "その他");
// #120 ひらがな: エラーで言われたら入れ直す／ラベルに書いてあれば最初からひらがな
assert.equal(results["ひらがな社"], "sent");
assert.equal(hiraKana, "やまだたろう");
assert.equal(results["ひらがな表記社"], "sent");
assert.ok(/^[ぁ-ん\s　]+$/.test(hira2Kana), `ひらがなで入っていない: ${hira2Kana}`);
assert.equal(hira2Posts, 1);
// #121 「前画面に戻って正しく入力してください」: 戻って直してから送れる
assert.equal(results["前画面エラー社"], "sent");
assert.equal(backerrKana, "ヤマダタロウ");
// #122 送信ボタンが有効にならない: 送れないのが正しく、どの欄で止まったかが残る
assert.equal(results["ボタン無効社"], "failed");
{
  const t = (db.prepare("SELECT result_text FROM form_jobs WHERE company_name='ボタン無効社'").get() as { result_text: string }).result_text;
  assert.ok(/引っかかっている欄: .*会員番号/.test(t), `止まった欄が残っていない: ${t.slice(0, 200)}`);
}
assert.ok(simpleHits.length >= 2);
received.simple = simpleHits[0];
assert.equal(received.simple["your-company"], "株式会社サンプル商事");
assert.equal(received.simple["your-name"], "山田 太郎");
assert.equal(received.simple["your-kana"], "ヤマダ タロウ");
assert.equal(received.simple["your-email"], "sales@example.com");
assert.equal(received.simple["your-tel"], "03-1234-5678");
assert.equal(received.simple["your-subject"], "シンプル商事様へ ショート動画のご案内");
assert.ok(received.simple["your-message"].includes("シンプル商事") && received.simple["your-message"].includes("山田太郎様"), "差し込み");
assert.ok(received.simple["your-message"].includes("居酒屋の事業"), "AI冒頭のフォールバック");
assert.equal(received.simple.agree, "1");
assert.equal(received.simple.q, undefined, "検索フォームは触らない");

assert.equal(results["確認画面工業"], "sent");
assert.equal(received.confirm.company, "株式会社サンプル商事");
assert.equal(received.confirm.sei, "山田"); assert.equal(received.confirm.mei, "太郎");
assert.equal(received.confirm.sei_kana, "ヤマダ"); assert.equal(received.confirm.mei_kana, "タロウ");
assert.equal(received.confirm.email, "sales@example.com"); assert.equal(received.confirm.email_confirm, "sales@example.com");
assert.deepEqual([received.confirm.tel1, received.confirm.tel2, received.confirm.tel3], ["03", "1234", "5678"]);
assert.deepEqual([received.confirm.zip1, received.confirm.zip2], ["114", "0001"]);
assert.equal(received.confirm.pref, "東京都");
assert.equal(received.confirm.address, "東京都北区1-2-3");
assert.equal(received.confirm.kind, "other");
assert.ok(received.confirm.body.includes("確認画面工業") && received.confirm.body.includes("ご担当者様"));

assert.equal(results["お断り物産"], "skip_refused");
assert.ok(db.prepare("SELECT 1 FROM form_suppressions WHERE domain='e3.localhost'").get(), "お断りは除外リストに入る");
assert.equal(results["キャプチャ株式会社"], "skip_captcha");
assert.equal(results["厳格クリニック"], "failed");
assert.equal(results["リンク探索社"], "sent", "トップページのリンクからフォームを探索");

assert.equal(results["埋め込みフォーム社"], "sent", "iframe埋め込み");
assert.equal(received.embed.f1, "株式会社サンプル商事"); assert.equal(received.embed.f2, "山田 太郎"); assert.equal(received.embed.f3, "sales@example.com"); assert.ok(received.embed.f4.includes("埋め込みフォーム社"));

assert.equal(results["SPA株式会社"], "sent", "SPA（formタグ無し・JS送信）");
assert.equal(received.spa.c, "株式会社サンプル商事"); assert.equal(received.spa.e, "sales@example.com"); assert.equal(received.spa.t, "03-1234-5678"); assert.ok(received.spa.m.includes("SPA株式会社"));
assert.equal(received.spa.hp, "", "ハニーポットは空のまま");

assert.equal(results["二段階商会"], "sent", "2段階フォーム → /thanks URL判定");
assert.equal(received.steps.company, "株式会社サンプル商事"); assert.equal(received.steps.subject, "その他"); assert.equal(received.steps.how, "mail"); assert.ok(received.steps.body.includes("二段階商会"));

assert.equal(results["EN Corp"], "sent", "英語CONTACTリンク探索 + カスタムチェックボックス");
assert.equal(received.en.company, "株式会社サンプル商事"); assert.equal(received.en.agree, "yes");

assert.equal(results["マルチ選択社"], "sent", "必須select + チェック群 + 同URL完了");
assert.equal(received.multi.pref, "東京都"); assert.ok(received.multi["kind[]"], "種別チェック"); assert.ok(received.multi.msg.includes("マルチ選択社"));

assert.equal(results["オーバーレイ社"], "sent", "input本文 + image送信 + invisible reCAPTCHA + Cookieバナー");
assert.ok(received.overlay.naiyo.includes("オーバーレイ社"), "本文がinputでも入る");

assert.equal(results["半角数字社"], "sent", "半角数字のみの電話 + maxlength本文");
assert.equal(received.strictnum.tel, "0312345678");
// 送信データの改行は \r\n（2文字）になるが、ブラウザの maxlength は改行を1文字で数えるので、\n にそろえて数える
{ const m = received.strictnum.msg.replace(/\r\n/g, "\n"); assert.ok(m.length <= 120 && m.length > 40, "本文がmaxlengthに収まる"); }
assert.equal(results["チャレンジ社"], "skip_captcha", "ブラウザ確認ページはスキップ");
assert.equal(results["姓名一体社"], "sent", "「姓・名」ラベル1つに欄2つ");
assert.equal(received.seimei.nm1, "山田", "左の欄は姓"); assert.equal(received.seimei.nm2, "太郎", "右の欄は名");
assert.equal(received.seimei.kn1, "ヤマダ", "左のカナはセイ"); assert.equal(received.seimei.kn2, "タロウ", "右のカナはメイ");
assert.equal(results["御礼文言社"], "sent", "「お問い合わせいただきありがとうございます。担当者より追ってご連絡」で完了判定");
assert.equal(itadakiHits, 1, "二重送信しない（POSTは1回だけ）");
assert.equal(results["確認ボタン社"], "sent", "「送信内容を確認する」は確認ボタン → 確認画面で「送信する」まで押す");
assert.equal(cfm1Hits, 1, "最終送信が1回だけ届く"); assert.ok(received.cfm1.msg.includes("確認ボタン社"));
assert.equal(results["確認画面文言社"], "sent", "ボタン名で分からなくても確認画面の文言で検知して最終送信");
assert.equal(cfm2Hits, 1, "確認画面を送信済みと誤判定せず最終送信まで届く");
assert.equal(results["送信後認証社"], "skip_captcha", "送信時に画像認証が出たら未送信（CAPTCHA）");
assert.equal(recapHits, 0, "画像認証で止まり実際には送られていない");
assert.equal(results["確認ポップアップ社"], "sent", "送信後のページ内ポップアップ「よろしいですか？」の中の送信を押す");
assert.equal(modalHits, 1, "ポップアップ経由で1回だけ届く");
assert.equal(results["同ページ完了社"], "sent", "同じページで入力が消えて「ご回答ありがとうございました。」→ 送信済み");
assert.equal(resetHits, 1, "二重送信しない（1回だけ届く）");
assert.equal(results["お礼だけ社"], "sent", "入力が消えて「ありがとうございました。」が新しく出た → 送信済み");
assert.equal(reset2Hits, 1, "二重送信しない（1回だけ届く）");

// 事前チェック（フォーム探索・お断り・メール発見）
{
  const b2 = await launchBrowser();
  try {
    const sc = await scanCompany(b2, { formUrl: "", siteUrl: base });
    assert.ok(sc.formUrl && sc.formUrl.endsWith("/simple"), "フォーム発見");
    assert.deepEqual(sc.emails.slice(0, 2), ["info@test.co.jp", "recruit@test.co.jp"], "メール発見（代表窓口が先頭）");
    const sc2 = await scanCompany(b2, { formUrl: `${base}/refused`, siteUrl: "" });
    assert.ok(sc2.refused, "お断り検知");
    const sc3 = await scanCompany(b2, { formUrl: `${base}/captcha`, siteUrl: "" });
    assert.ok(sc3.captcha, "CAPTCHA検知");
  } finally { await b2.close(); }
}

// 90日重複チェック
const again = importRowsToCampaign(campaignId, [rows[0]]);
assert.equal(again.duplicated, 1);

// キャンペーングループ: 同じグループの別キャンペーンで待機中・送信済みの会社は取り込まない。
// フォーム無し等（連絡できていない）の会社は取り込める。グループなしは従来どおり。フリーメールはアドレス単位で比べる
{
  const mk = (name: string, group: string) => db.prepare(`INSERT INTO form_campaigns(name,sender_id,mode,subject_text,template_text,group_name) VALUES(?,?,?,?,?,?)`).run(name, senderId, "template", "件名", DEFAULT_TEMPLATE, group).lastInsertRowid as number;
  const row = (company: string, site: string, email = ""): import("../src/csv.js").CompanyRow => ({ company_name: company, form_url: "", site_url: site, email, industry: "", sub_industry: "", prefecture: "", representative: "" });
  const gForm = mk("G-フォーム", "G1"), gMail = mk("G-メール", "G1"), other = mk("別グループ", "G2");
  importRowsToCampaign(gForm, [row("グループ重複社", "https://dup-group.example.jp/"), row("フォーム無し社", "https://noform-group.example.jp/")]);
  db.prepare("UPDATE form_jobs SET status='skip_no_form' WHERE campaign_id=? AND domain='noform-group.example.jp'").run(gForm);
  const s2 = importRowsToCampaign(gMail, [row("グループ重複社", "https://dup-group.example.jp/"), row("フォーム無し社", "https://noform-group.example.jp/")]);
  assert.equal(s2.duplicated, 1, "同じグループで待機中の会社は取り込まない");
  assert.ok(s2.excludedRows.some((x) => x.reason.includes("同じグループの「G-フォーム」")), "理由にキャンペーン名");
  assert.equal(s2.added, 1, "フォーム無しだった会社は同じグループでも取り込める");
  const s3 = importRowsToCampaign(other, [row("グループ重複社", "https://dup-group.example.jp/")]);
  assert.equal(s3.added, 1, "別グループなら取り込める");
  const f1 = mk("G-フリー1", "G3"), f2 = mk("G-フリー2", "G3");
  importRowsToCampaign(f1, [{ ...row("個人A", "", "a.taro@gmail.com") }]);
  const s4 = importRowsToCampaign(f2, [{ ...row("個人B", "", "b.hanako@gmail.com") }, { ...row("個人A", "", "a.taro@gmail.com") }]);
  assert.equal(s4.added, 1, "フリーメールは同じドメインでも別アドレスなら別の会社"); assert.equal(s4.duplicated, 1, "同じアドレスは重複");
}

// メール送信の会社でも、社名に法人格が無ければHPの表記から補う（AI不要）。送信は dryRun で行わない
{
  const cid = db.prepare(`INSERT INTO form_campaigns(name,sender_id,mode,subject_text,template_text,channel) VALUES(?,?,?,?,?,?)`).run("メール補完", senderId, "template", "件名", DEFAULT_TEMPLATE, "email_only").lastInsertRowid as number;
  const mkRow = (company: string, site: string, email: string): import("../src/csv.js").CompanyRow => ({ company_name: company, form_url: "", site_url: site, email, industry: "", sub_industry: "", prefecture: "", representative: "" });
  importRowsToCampaign(cid, [
    mkRow("メール補完", `http://m1.localhost:${port}/legal-utf8`, "info@m1.example.jp"),
    mkRow("シフトジス商事", `http://m2.localhost:${port}/legal-sjis`, "info@m2.example.jp"),
    mkRow("サブページ", `http://m3.localhost:${port}/top-without-name`, "info@m3.example.jp"),
    mkRow("株式会社そのまま", `http://m4.localhost:${port}/legal-utf8`, "info@m4.example.jp"),
    mkRow("見つからない社", `http://m5.localhost:${port}/legal-utf8`, "info@m5.example.jp"),
  ]);
  const b3 = await launchBrowser();
  try {
    for (const j of db.prepare("SELECT id FROM form_jobs WHERE campaign_id=?").all(cid) as { id: number }[]) await processJob(b3, j.id, { dryRun: true });
  } finally { await b3.close(); }
  const names = (db.prepare("SELECT company_name FROM form_jobs WHERE campaign_id=? ORDER BY id").all(cid) as { company_name: string }[]).map((r) => r.company_name);
  assert.equal(names[0], "株式会社メール補完", "メールの会社もHPのフッターから法人格を補う");
  assert.equal(names[1], "株式会社シフトジス商事", "Shift_JIS のサイトでも読める");
  assert.equal(names[2], "合同会社サブページ", "トップに無ければ会社概要ページ（/company/）から補う");
  assert.equal(names[3], "株式会社そのまま", "すでに法人格があれば変えない");
  assert.equal(names[4], "見つからない社", "HPに表記が無ければそのまま");
}

server.close();
console.log("\nALL OK");
