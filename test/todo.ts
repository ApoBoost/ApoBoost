// 要対応に溜まっていた失敗の型を、ダミーサイトで再現して確かめる。`npm test` の一部。
// 本番の失敗470件を調べて分かった型（電話番号が必須なのに空のまま／エラー文言の見逃し／
// 確認画面で送信ボタンを見つけられない／サイト側の拒否 など）を1つずつ置いてある。
// 新しい失敗の型が見つかったら、ここにダミーのページと期待する結果を足す。
import http from "node:http";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

process.env.FO_NO_NOTIFY = "1";
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fo-todo-"));

const { getDb } = await import("../src/db.js");
const { launchBrowser, submitToCompany } = await import("../src/engine.js");

const got: Record<string, Record<string, string>[]> = {};
const hit = (k: string, b: Record<string, string>) => { (got[k] ??= []).push(b); };

const page = (title: string, body: string, head = "") => `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${title}</title>${head}</head><body><header><form action="/search" role="search"><input type="search" name="q"><button class="sb-search-submit"></button></form></header>${body}</body></html>`;
const esc = (s: string) => String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const hidden = (b: Record<string, string>) => Object.entries(b).map(([k, v]) => `<input type="hidden" name="${k}" value="${esc(v)}">`).join("");
const rawBody = (req: http.IncomingMessage): Promise<string> => new Promise((resolve) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => resolve(d)); });
// よくある入力欄（電話番号の見出しだけ差し替える）
const fields = (telLabel: string, v: Record<string, string> = {}) => `
<table>
<tr><th>お名前</th><td><input type="text" name="nm" value="${esc(v.nm ?? "")}"></td></tr>
<tr><th>メールアドレス</th><td><input type="text" name="em" value="${esc(v.em ?? "")}"></td></tr>
<tr>${telLabel}<td><input type="text" name="tel" value="${esc(v.tel ?? "")}"></td></tr>
<tr><th>お問い合わせ内容</th><td><textarea name="msg">${esc(v.msg ?? "")}</textarea></td></tr>
</table>`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  const p = url.pathname;
  const send = (html: string, code = 200) => { res.writeHead(code, { "content-type": "text/html; charset=utf-8" }); res.end(html); };
  const post = req.method === "POST";
  const raw = post ? await rawBody(req) : "";
  const b: Record<string, string> = Object.fromEntries(new URLSearchParams(raw));
  const done = (k: string) => { hit(k, b); return send(page("完了", "<h1>送信完了</h1><p>お問い合わせを受け付けました。</p>")); };

  // 1) 必須の印が「※」（電話番号※）。最初から電話番号を入れる
  if (p === "/kome") return post ? done("kome") : send(page("お問い合わせ", `<h1>お問い合わせ</h1><p>※は必須項目です。</p><form method="post">${fields("<th>電話番号<span style='color:red'>※</span></th>")}<button type="submit">送信する</button></form>`));

  // 2) 必須の印が画像（alt=必須）で、別のセルにある
  if (p === "/imgreq") return post ? done("imgreq") : send(page("お問い合わせ", `<h1>お問い合わせ</h1><form method="post">${fields("<th>電話番号</th><td><img alt='必須' src='data:image/gif;base64,R0lGODlhAQABAAAAACw=' width='30' height='14'></td>")}<button type="submit">送信する</button></form>`));

  // 3) 必須の印が無いのに電話番号が必須。確認ボタンを押すと同じ画面のまま赤字で「未入力です。」
  //    注意書きに最初から「入力してください」があるサイト（新しいエラーを見逃していた型）
  if (p === "/minyuryoku") {
    if (!post) return send(page("お問い合わせ", `<h1>お問い合わせ</h1><p>以下の項目を入力してください。</p><form method="post">${fields("<th>電話番号</th>")}<input type="submit" value="確認画面へ"></form>`));
    if (!b.tel) return send(page("お問い合わせ", `<h1>お問い合わせ</h1><p>以下の項目を入力してください。</p><form method="post">${fields("<th>電話番号</th>", b).replace('name="tel" value="">', 'name="tel" value=""><br><font color="red">未入力です。</font>')}<input type="submit" value="確認画面へ"></form>`));
    return send(page("確認", `<h1>入力内容の確認</h1><p>下記の内容で送信します。</p><form method="post" action="/minyuryoku/send">${hidden(b)}<input type="submit" value="戻る" formaction="/minyuryoku"><input type="submit" value="送信する"></form>`));
  }
  if (p === "/minyuryoku/send" && post) return done("minyuryoku");

  // 4) 警告のポップアップ（alert）で止めるサイト。画面には何も出ない
  if (p === "/alert") return post ? done("alert") : send(page("お問い合わせ", `<h1>お問い合わせ</h1><form method="post" onsubmit="if(!this.tel.value){alert('お電話を入力してください');return false;}">${fields("<th>お電話</th>")}<input type="submit" value="入力内容確認"></form>`));

  // 5) 確認ボタンを押すと、入力欄の無いエラーページ（色も class も無い）＋「前画面に戻る」
  if (p === "/plainerr") {
    if (!post) return send(page("お問い合わせ", `<h1>お問い合わせ</h1><form method="post">${fields("<th>電話番号</th>")}<input type="submit" value="確認"></form>`));
    if (!b.tel) return send(page("エラー", `<p>入力にエラーがあります。下記をご確認の上「戻る」ボタンにて修正をお願い致します。</p><p>【電話番号】は必須項目です。</p><input type="button" value="前画面に戻る" onclick="history.back()">`));
    return send(page("確認", `<h1>確認</h1><p>以下の内容でよろしければ送信してください。</p><form method="post" action="/plainerr/send">${hidden(b)}<input type="submit" value="送信"></form>`));
  }
  if (p === "/plainerr/send" && post) return done("plainerr");

  // 6) 確認画面の送信ボタンが、alt の無い画像ボタン（[戻る][送信] の順）
  if (p === "/imgbtn") {
    if (!post) return send(page("お問い合わせ", `<h1>お問い合わせ</h1><form method="post">${fields("<th>電話番号（必須）</th>")}<input type="submit" value="確認画面へ進む"></form>`));
    const px = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";
    return send(page("確認", `<h1>内容をご確認下さい。</h1><form method="post" action="/imgbtn/send">${hidden(b)}<input type="image" src="${px}#btn_back.gif" name="back" width="80" height="30" formaction="/imgbtn/back"><input type="image" src="${px}#btn_soushin.gif" width="80" height="30"></form>`));
  }
  if (p === "/imgbtn/send" && post) return done("imgbtn");
  if (p === "/imgbtn/back") { hit("imgbtn_back", b); return send(page("戻った", "<p>戻りました</p>")); }

  // 7) 確認画面の送信が、ただのリンク（<a href="javascript:…">送信する</a>）
  if (p === "/alink") {
    if (!post) return send(page("お問い合わせ", `<h1>お問い合わせ</h1><form method="post">${fields("<th>電話番号（必須）</th>")}<input type="submit" value="入力内容の確認"></form>`));
    return send(page("確認", `<h1>入力内容の確認</h1><p>送信内容をご確認の上、「送信する」ボタンをクリックしてください。</p><form method="post" action="/alink/send" name="f">${hidden(b)}</form><p><a href="javascript:history.back()">戻る</a> <a href="javascript:document.f.submit()">送信する</a></p>`));
  }
  if (p === "/alink/send" && post) return done("alink");

  // 8) サイト側の拒否（Contact Form 7 の送信失敗）。入力を直しても通らない
  if (p === "/cf7ng") return send(page("お問い合わせ", `<h1>お問い合わせ</h1><form method="post">${fields("<th>電話番号（必須）</th>", b)}<input type="submit" value="送信する">${post ? '<div class="wpcf7-response-output">メッセージの送信に失敗しました。後でまたお試しください。</div>' : ""}</form>`));

  // 9) 古いライブラリ（MooTools）が Array.from を書き換えているサイト。Array.from(new Set(…)) が [Set] になる
  if (p === "/proto") return post ? done("proto") : send(page("お問い合わせ", `<h1>お問い合わせ</h1><form method="post">${fields("<th>電話番号（必須）</th>")}<input type="submit" value="送信する"></form>`, `<script>Array.from = function (x) { return x == null ? [] : (typeof x.length === "number" && typeof x !== "string") ? Array.prototype.slice.call(x) : [x]; };</script>`));

  // 10) フリガナに空白があると「カタカナ以外の文字が入力されています」（赤字でも class でもない）
  if (p === "/kana") {
    if (post && !/[\s　]/.test(b.kana ?? "")) return done("kana");
    return send(page("お問い合わせ", `<h1>お問い合わせ</h1><form method="post"><p>フリガナ <input type="text" name="kana" value="${esc(b.kana ?? "")}">${post ? "<br>フリガナ にカタカナ以外の文字が入力されています。" : ""}</p>${fields("<th>電話番号（必須）</th>", b)}<input type="submit" value="送信する"></form>`));
  }

  // 11) 確認画面に「入力内容の確認」という見出しボタンと「送信」が両方ある（確認を押し続けていた型）
  if (p === "/both") {
    if (!post) return send(page("お問い合わせ", `<h1>お問い合わせ</h1><form method="post">${fields("<th>電話番号（必須）</th>")}<button type="submit">確認画面へ</button></form>`));
    return send(page("確認", `<h1>確認</h1><form method="post" action="/both">${hidden(b)}<button type="submit">確認画面へ</button></form><form method="post" action="/both/send">${hidden(b)}<button type="submit">この内容で送信する</button></form>`));
  }
  if (p === "/both/send" && post) return done("both");

  // 12) 人材会社: リストのURLが「スタッフ登録」フォーム。サイト内の「企業の方のお問い合わせ」を探して、そちらに送る
  if (p === "/staff/entry") return post ? (hit("staff_entry", b), send(page("登録完了", "<p>ご登録ありがとうございます。</p>"))) : send(page("スタッフ登録", `<h1>スタッフ登録フォーム</h1><p>お仕事をお探しの方はこちらからご登録ください。</p><form method="post"><table>
<tr><th>お名前</th><td><input name="nm"></td></tr><tr><th>生年月日</th><td><input name="birth"></td></tr><tr><th>性別</th><td><input type="radio" name="sex" value="m">男 <input type="radio" name="sex" value="f">女</td></tr>
<tr><th>希望職種</th><td><input name="job"></td></tr><tr><th>最寄駅</th><td><input name="st"></td></tr><tr><th>メールアドレス</th><td><input name="em"></td></tr><tr><th>電話番号</th><td><input name="tel"></td></tr>
<tr><th>備考</th><td><textarea name="msg"></textarea></td></tr></table><button type="submit">登録する</button></form>`));
  if (p === "/staff/") return send(page("人材派遣のダミー", `<h1>ダミー人材サービス</h1><p><a href="/staff/entry">スタッフ登録はこちら</a></p><footer><a href="/staff/contact">企業の方のお問い合わせ</a></footer>`));
  if (p === "/staff/contact") return post ? done("staff") : send(page("お問い合わせ", `<h1>企業の方のお問い合わせ</h1><form method="post">${fields("<th>電話番号（必須）</th>")}<button type="submit">送信する</button></form>`));
  // 13) 登録フォームしか無いサイト → 送らない
  if (p === "/only-entry/") return send(page("ダミー派遣", `<h1>ダミー派遣</h1><p><a href="/only-entry/regist">お問い合わせ・ご登録</a></p>`));
  if (p === "/only-entry/regist") return post ? (hit("only_entry", b), send(page("完了", "<p>登録を受け付けました。</p>"))) : send(page("ご登録", `<h1>お仕事をお探しの方 ご登録フォーム</h1><form method="post">${fields("<th>電話番号（必須）</th>")}<button type="submit">登録する</button></form>`));
  // ---- ここから「送れていないのに送信済み」「二重送信」「誤った値」の型 ----
  // 14) ヘッダーに固定表示の申込ボタン（<a class="btn" href="/apply">）と、フォームより前にスライダーの「Next」ボタン。
  //     ページ全体のDOM順で選ぶと、スライダーを押し続けるか、申込ページへ移って「フォームが消えた＝送信済み」になっていた
  const cta = `<div style="position:fixed;top:0;right:0;z-index:100"><a class="btn" href="/apply">お申し込み</a></div><div class="slick-slider"><button type="button" class="slick-next">Next</button></div>`;
  if (p === "/apply") { hit("apply", b); return send(page("お申し込み", "<h1>お申し込み</h1><p>サービスの紹介ページです。</p>")); }
  if (p === "/cta") {
    if (!post) return send(page("お問い合わせ", `${cta}<h1>お問い合わせ</h1><form method="post">${fields("<th>電話番号（必須）</th>")}<button type="submit">確認画面へ</button></form>`));
    return send(page("確認", `${cta}<h1>確認</h1><p>以下の内容でよろしければ送信してください。</p><form method="post" action="/cta/send">${hidden(b)}<button type="submit">送信する</button></form>`));
  }
  if (p === "/cta/send" && post) return done("cta");

  // 15) iframe の中のフォーム。送信ボタンを押しても何も起きない（JSで止める）。親ページには入力欄が無い
  if (p === "/ifr") return send(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>お問い合わせ</title></head><body><h1>お問い合わせ</h1><iframe src="/ifr/form" width="800" height="700"></iframe></body></html>`);
  if (p === "/ifr/form") return post ? done("ifr") : send(`<!doctype html><html lang="ja"><head><meta charset="utf-8"></head><body><form method="post" onsubmit="return false">${fields("<th>電話番号（必須）</th>")}<button type="submit">送信する</button></form></body></html>`);
  // 16) iframe の中のフォームに、見える reCAPTCHA。親ページからは見えない
  if (p === "/ifrcap") return send(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>お問い合わせ</title></head><body><h1>お問い合わせ</h1><iframe src="/ifrcap/form" width="800" height="700"></iframe></body></html>`);
  if (p === "/ifrcap/form") return post ? done("ifrcap") : send(`<!doctype html><html lang="ja"><head><meta charset="utf-8"></head><body><form method="post">${fields("<th>電話番号（必須）</th>")}<div class="g-recaptcha" data-sitekey="x" style="width:304px;height:78px;border:1px solid #ccc"></div><button type="submit">送信する</button></form></body></html>`);

  // 17) URLに「success」を含む（/customer-success/contact）。入力ページにも確認画面にも「確認メールをお送りします」の予告文。
  //     確認画面にだけ同意のチェック（チェックしないとブラウザが送信を止める）。完了画面は JS ですぐトップへ移る
  if (p === "/customer-success/contact") {
    const note = "<p>送信後、ご入力のメールアドレスに確認メールをお送りします。</p>";
    if (!post) return send(page("お問い合わせ", `<h1>お問い合わせ</h1>${note}<form method="post">${fields("<th>電話番号（必須）</th>")}<button type="submit">確認画面へ</button></form>`));
    return send(page("確認", `<h1>入力内容の確認</h1><p>以下の内容で送信します。</p>${note}<form method="post" action="/customer-success/contact/send">${hidden(b)}<label><input type="checkbox" name="agree2" value="1" required> 個人情報の取り扱いに同意する</label><button type="submit">送信する</button></form>`));
  }
  if (p === "/customer-success/contact/send" && post) { hit("success", b); return send(page("完了", `<p>しばらくお待ちください</p><script>setTimeout(function(){ location.href = "/"; }, 300);</script>`)); }
  if (p === "/") return send(page("トップ", "<h1>ダミー株式会社</h1><p>私たちはダミーです。</p>"));
  // 18) 確認画面に弱い完了文言（「ご入力ありがとうございます」「確認メールをお送りします」）。入力ページにはお礼の挨拶。
  //     完了画面の「届かない場合は再度ご入力ください」を入力エラーと誤読して、戻って送り直していた
  if (p === "/weak") {
    if (!post) return send(page("お問い合わせ", `<h1>お問い合わせ</h1><p>お問い合わせいただきありがとうございます。</p><form method="post">${fields("<th>電話番号（必須）</th>")}<button type="submit">確認する</button></form>`));
    return send(page("確認", `<h1>確認</h1><p>ご入力ありがとうございます。内容をご確認ください。送信後、確認メールをお送りします。</p><form method="post" action="/weak/send">${hidden(b)}<button type="submit">送信する</button></form>`));
  }
  if (p === "/weak/send" && post) { hit("weak", b); return send(page("完了", `<h1>お問い合わせを受け付けました</h1><p>お問い合わせいただきありがとうございます。自動返信メールをお送りしました。</p><p>メールが届かない場合は、お手数ですが再度ご入力ください。</p>`)); }

  // 19) 電話欄が2つ（電話番号と携帯電話）・未選択の項目が value="" の select・都道府県が「東京」表記・必須の見出しを共有するチェックボックス群
  if (p === "/sel") {
    if (post) { hit("sel", b); hit("sel_svc", { n: String(new URLSearchParams(raw).getAll("svc").length) }); return send(page("完了", "<h1>送信完了</h1><p>お問い合わせを受け付けました。</p>")); }
    return send(page("お問い合わせ", `<h1>お問い合わせ</h1><form method="post"><table>
<tr><th>お名前</th><td><input type="text" name="nm"></td></tr>
<tr><th>メールアドレス</th><td><input type="text" name="em"></td></tr>
<tr><th>電話番号（必須）</th><td><input type="text" name="tel"></td></tr>
<tr><th>携帯電話（必須）</th><td><input type="text" name="mobile"></td></tr>
<tr><th>ご用件</th><td><select name="kind"><option value="">選択して下さい</option><option value="doc">資料請求</option><option value="job">採用について</option></select></td></tr>
<tr><th>業種</th><td><select name="ind"><option value="">-- 選択 --</option><option value="x">製造業</option><option value="y">小売業</option></select></td></tr>
<tr><th>都道府県</th><td><select name="pref"><option value="">お選びください</option><option>北海道</option><option>東京</option><option>大阪</option></select></td></tr>
<tr><th>ご興味のあるサービス<span>必須</span></th><td><label><input type="checkbox" name="svc" value="A">サービスA</label><label><input type="checkbox" name="svc" value="B">サービスB</label><label><input type="checkbox" name="svc" value="C">サービスC</label></td></tr>
<tr><th>お問い合わせ内容</th><td><textarea name="msg"></textarea></td></tr>
</table><button type="submit">送信する</button></form>`));
  }
  // 20) 電話番号にハイフンがあると「ハイフンなしで入力してください」（赤字ではない素の文字）
  if (p === "/telfmt") {
    if (post && /^\d+$/.test(b.tel ?? "")) return done("telfmt");
    return send(page("お問い合わせ", `<h1>お問い合わせ</h1><form method="post">${fields("<th>電話番号（必須）</th>", b)}${post ? "<p>電話番号はハイフンなしで入力してください。</p>" : ""}<button type="submit">送信する</button></form>`));
  }

  // 21) 送信ボタンを押したあと、ページが移り続けて中身を読めない（読み取りが例外で落ちる）。
  //     「例外」のまま返すと自動の再試行に回って二重送信になるので、「送信後の判定不能」で返す
  if (p === "/spin") return post ? (hit("spin", b), send(`<!doctype html><meta charset="utf-8"><script>location.replace("/spin/go?" + Date.now())</script>`)) : send(page("お問い合わせ", `<h1>お問い合わせ</h1><form method="post">${fields("<th>電話番号（必須）</th>")}<button type="submit">送信する</button></form>`));
  if (p === "/spin/go") return send(`<!doctype html><meta charset="utf-8"><script>setTimeout(function(){ location.replace("/spin/go?" + Date.now()); }, 30)</script>`);

  if (p === "/search") { hit("search", Object.fromEntries(url.searchParams)); return send(page("検索", "<p>検索結果</p>")); }
  send("not found", 404);
});
await new Promise<void>((r) => server.listen(0, r));
const port = (server.address() as { port: number }).port;

getDb(); // スクリーンショット置き場などの準備
// 「電話番号は必須の欄にだけ入れる」設定の送信者（本番で失敗が多かった条件）
const sender = { id: 1, label: "t", company: "株式会社サンプル商事", industry: "", person: "山田 太郎", person_kana: "ヤマダ タロウ", email: "sales@example.com", reply_email: "", tel: "03-1234-5678", postal: "114-0001", address: "東京都北区1-2-3", url: "https://example.com", from_email: "", smtp_host: "", smtp_port: 0, smtp_user: "", smtp_pass: "", tel_required_only: 1, reply_check: 0, tls_insecure: 0, unsubscribe_url: "", inbox_sort: 0 } as unknown as import("../src/db.js").SenderProfile;

// TODO_ONLY=cta,sel のように指定すると、その型だけを流す（直している途中の確認用）
const only = process.env.TODO_ONLY?.split(",");
const browser = await launchBrowser();
const out: Record<string, { status: string; detail: string; log: string[] }> = {};
let n = 0;
try {
  const cases: [string, string, string][] = [...["kome", "imgreq", "minyuryoku", "alert", "plainerr", "imgbtn", "alink", "cf7ng", "proto", "kana", "both"].map((k): [string, string, string] => [k, `/${k}`, ""]),
    ["staff", "/staff/entry", "/staff/"], ["onlyentry", "", "/only-entry/"],
    ...["cta", "ifr", "ifrcap", "customer-success/contact", "weak", "sel", "telfmt", "spin"].map((k): [string, string, string] => [k.split("/")[0], `/${k}`, ""])];
  for (const [k, formPath, sitePath] of cases) {
    n++;
    if (only && !only.includes(k)) continue;
    // 会社ごとに別のホスト名にする（同じドメインへの連続送信の扱いに引っかからないように）
    const host = `http://t${n}.localhost:${port}`;
    const r = await submitToCompany(browser, { jobId: 9000 + n, formUrl: formPath ? host + formPath : "", siteUrl: sitePath ? host + sitePath : "", sender, subject: "ご案内", message: "はじめまして。サービスのご案内です。\nよろしくお願いいたします。" });
    out[k] = { status: r.status, detail: r.detail, log: r.log };
    console.log(`- ${k}: ${r.status} | ${r.detail.split("\n")[0]}`);
    if (process.env.FO_DEBUG) console.log(r.log.join("\n"));
  }
} finally {
  await browser.close();
  server.close();
}

const sentOnce = (k: string, why: string) => { assert.equal(out[k].status, "sent", `${k}: ${why} → ${out[k].detail}\n${out[k].log.join("\n")}`); assert.equal(got[k]?.length, 1, `${k}: 送信は1回だけ（${got[k]?.length ?? 0}回）`); };
if (!only) {
sentOnce("kome", "※ を必須の印として読む"); assert.equal(got.kome[0].tel, "03-1234-5678");
assert.ok(!out.kome.log.some((l) => l.includes("電話は任意")), "kome: 最初から電話番号を入れる");
sentOnce("imgreq", "画像の「必須」を読む"); assert.equal(got.imgreq[0].tel, "03-1234-5678");
assert.ok(!out.imgreq.log.some((l) => l.includes("電話は任意")), "imgreq: 最初から電話番号を入れる");
sentOnce("minyuryoku", "「未入力です。」を拾って電話番号を入れ直す"); assert.equal(got.minyuryoku[0].tel, "03-1234-5678");
sentOnce("alert", "警告のポップアップを入力エラーとして扱う"); assert.equal(got.alert[0].tel, "03-1234-5678");
assert.ok(out.alert.log.some((l) => l.includes("サイトの警告: お電話を入力してください")), "alert: 警告の文言を記録に残す");
sentOnce("plainerr", "素のエラーページから戻って入れ直す"); assert.equal(got.plainerr[0].tel, "03-1234-5678");
sentOnce("imgbtn", "alt の無い画像の送信ボタンを押す"); assert.equal(got.imgbtn_back, undefined, "imgbtn: 戻るボタンは押さない");
sentOnce("alink", "リンクの送信ボタンを押す");
assert.equal(out.cf7ng.status, "failed"); assert.ok(out.cf7ng.detail.startsWith("サイト側で受け付けられませんでした"), `cf7ng: ${out.cf7ng.detail}`);
sentOnce("proto", "Array.from を書き換えるサイトでも動く");
sentOnce("kana", "「カタカナ以外の文字」を拾ってフリガナの空白を除く"); assert.equal(got.kana[0].kana, "ヤマダタロウ");
sentOnce("both", "確認画面では送信を優先して押す");
assert.equal(got.search, undefined, "検索フォームのボタンは押さない");
sentOnce("staff", "スタッフ登録フォームではなく、企業向けの問い合わせに送る"); assert.equal(got.staff_entry, undefined, "staff: 登録フォームには入力しない");
assert.equal(out.onlyentry.status, "skip_no_form"); assert.ok(out.onlyentry.detail.includes("問い合わせ以外のフォーム"), `onlyentry: ${out.onlyentry.detail}`); assert.equal(got.only_entry, undefined, "onlyentry: 登録フォームには入力しない");
}

// ---- 送れていないのに送信済み／二重送信／誤った値 ----
if (!only || only.includes("cta")) {
  sentOnce("cta", "ヘッダーの申込ボタンやスライダーではなく、フォームのボタンを押す");
  assert.equal(got.apply, undefined, "cta: /apply には移らない");
}
if (!only || only.includes("ifr")) {
  assert.notEqual(out.ifr.status, "sent", `ifr: iframe の送信が止まっているのに送信済みにしない → ${out.ifr.detail}`);
  assert.equal(got.ifr, undefined);
}
if (!only || only.includes("ifrcap")) {
  assert.equal(out.ifrcap.status, "skip_captcha", `ifrcap: iframe の中の reCAPTCHA を見つける → ${out.ifrcap.detail}`);
  assert.equal(got.ifrcap, undefined, "ifrcap: 送信しない");
}
if (!only || only.includes("customer-success")) {
  assert.equal(out["customer-success"].status, "sent", `customer-success: ${out["customer-success"].detail}\n${out["customer-success"].log.join("\n")}`);
  assert.equal(got.success?.length, 1, `customer-success: 確認画面で止まらず、送信は1回だけ（${got.success?.length ?? 0}回）`);
  assert.equal(got.success[0].agree2, "1", "customer-success: 確認画面の同意にチェックを入れる");
}
if (!only || only.includes("weak")) {
  assert.equal(out.weak.status, "sent", `weak: ${out.weak.detail}\n${out.weak.log.join("\n")}`);
  assert.equal(got.weak?.length, 1, `weak: 確認画面の予告文で送信済みにせず、完了画面の「再度ご入力ください」で送り直さない（${got.weak?.length ?? 0}回）`);
}
if (!only || only.includes("sel")) {
  sentOnce("sel", "電話2欄・select・都道府県");
  const s0 = got.sel[0];
  assert.equal(s0.tel, "03-1234-5678", "sel: 電話番号は分割しない"); assert.equal(s0.mobile, "03-1234-5678", "sel: 携帯電話にも同じ番号（分割の後半だけを入れない）");
  assert.equal(s0.kind, "doc", "sel: 「選択して下さい」（value=\"\"）を選ばない"); assert.notEqual(s0.ind, "", "sel: 「-- 選択 --」を選ばない");
  assert.equal(s0.pref, "東京", "sel: 都道府県が「東京」表記でも合わせる");
  assert.equal(got.sel_svc[0].n, "1", "sel: 必須の見出しを共有するチェックボックスは1つだけ");
}
if (!only || only.includes("telfmt")) {
  sentOnce("telfmt", "「ハイフンなしで」を読んで電話番号を数字だけにする"); assert.equal(got.telfmt[0].tel, "0312345678");
}

if (!only || only.includes("spin")) {
  assert.equal(got.spin?.length, 1, `spin: 送信は1回だけ（${got.spin?.length ?? 0}回）`);
  // worker.ts の自動再試行の条件と同じ。押したあとの結果が、これに当たってはいけない
  const r = out.spin, text = [r.detail, ...r.log].join("\n");
  const retryable = r.status === "failed" && !/送信後の判定不能/.test(text) && /(例外|timeout|Timeout|net::|ECONN|socket|接続)/.test(text);
  assert.ok(!retryable, `spin: 送信ボタンを押したあとの結果が自動の再試行に回る → ${r.detail}`);
}

console.log("todo: ALL OK");
process.exit(0);
