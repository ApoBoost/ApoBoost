// 返信の自動振り分け（受信箱は使わず、届いたメールを直接渡して確認する）。`npm test` の最初に流れる
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

process.env.FO_NO_NOTIFY = "1"; // テスト中は通知を出さない
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fo-replies-"));

const { getDb } = await import("../src/db.js");
const { applyIncomingMail, classifyReply, stripQuoted, imapHostFor, inboxCategory } = await import("../src/replies.js");

const db = getDb();
const MAILBOX = "sales@sender.example";
const senderId = db.prepare(`INSERT INTO sender_profiles(label,company,person,email,smtp_user,smtp_pass) VALUES(?,?,?,?,?,?)`)
  .run("営業", "株式会社サンプル商事", "田中 太郎", MAILBOX, MAILBOX, "abcdefghijklmnop").lastInsertRowid as number;
const otherSender = db.prepare(`INSERT INTO sender_profiles(label,company,person,email,smtp_user,smtp_pass) VALUES(?,?,?,?,?,?)`)
  .run("別アカウント", "株式会社サンプル商事", "佐藤", "other@sender.example", "other@sender.example", "abcdefghijklmnop").lastInsertRowid as number;
const camp = db.prepare(`INSERT INTO form_campaigns(name,sender_id,mode,subject_text,template_text) VALUES(?,?,?,?,?)`).run("返信テスト", senderId, "template", "件名", "本文").lastInsertRowid as number;
const camp2 = db.prepare(`INSERT INTO form_campaigns(name,sender_id,mode,subject_text,template_text) VALUES(?,?,?,?,?)`).run("別アカウント", otherSender, "template", "件名", "本文").lastInsertRowid as number;

const SENT_MSG = "株式会社サンプル\nご担当者様\n\n人事担当者との商談機会についてご提案です。\n※本メッセージが不要な場合は、お手数ですが上記メールまでその旨ご連絡ください。以後のご連絡は控えさせていただきます。";
const job = (campaign: number, name: string, email: string, domain: string, channel = "email") =>
  db.prepare(`INSERT INTO form_jobs(campaign_id,company_name,email,domain,channel,status,sent_at,message_used) VALUES(?,?,?,?,?,'sent','2026-09-10 01:00:00',?)`)
    .run(campaign, name, email, domain, channel, SENT_MSG).lastInsertRowid as number;
const jA = job(camp, "アポ株式会社", "info@appo.co.jp", "appo.co.jp");
const jD = job(camp, "断り株式会社", "info@kotowari.jp", "kotowari.jp");
const jR = job(camp, "返信だけ株式会社", "", "henshin.com", "form");
const jQ = job(camp, "引用株式会社", "info@inyou.co.jp", "inyou.co.jp");
const jAuto = job(camp, "自動返信株式会社", "", "auto-reply.co.jp", "form");
const jManual = job(camp, "手動記録株式会社", "info@manual.co.jp", "manual.co.jp");
const jOther = job(camp2, "別受信箱株式会社", "info@other.co.jp", "other.co.jp");
db.prepare("UPDATE form_jobs SET outcome='replied', outcome_note='電話で話した' WHERE id=?").run(jManual);

const at = new Date("2026-09-12T03:00:00Z");
const get = (id: number) => db.prepare("SELECT outcome, outcome_note FROM form_jobs WHERE id=?").get(id) as { outcome: string; outcome_note: string };
const mail = (from: string, subject: string, text: string, autoHeader = false) => ({ from, subject, text, date: at, autoHeader });

// アポ: 日程の話 → アポ獲得
assert.equal(applyIncomingMail(MAILBOX, mail("tanaka@appo.co.jp", "Re: 人事担当者との商談機会について", "ご連絡ありがとうございます。\n一度お話を伺いたく、来週でご都合のよい日程をいくつかいただけますか。")), jA);
assert.equal(get(jA).outcome, "appointment", "日程・お話を伺いたい → アポ");
assert.ok(get(jA).outcome_note.startsWith("自動判定"), "メモに自動判定と残す");

// 断り: 別のアドレスでも同じドメイン（サブドメイン）なら同じ会社 → 断り＋今後送らない
assert.equal(applyIncomingMail(MAILBOX, mail("soumu@mail.kotowari.jp", "Re: ご提案", "弊社では現在検討しておりませんので、今後のご連絡は不要です。")), jD);
assert.equal(get(jD).outcome, "declined", "不要です → 断り");
assert.ok(db.prepare("SELECT 1 FROM form_suppressions WHERE domain='kotowari.jp'").get(), "断りは除外リストに入る");
assert.ok(db.prepare("SELECT 1 FROM email_optouts WHERE email='info@kotowari.jp'").get(), "断りは配信停止にも入る");

// 振り分けの言葉なし → 返信あり（フォーム送信の会社でも、受信箱に届いた返信で拾う）
assert.equal(applyIncomingMail(MAILBOX, mail("yamada@henshin.com", "お問い合わせの件", "山田です。社内で共有いたします。")), jR);
assert.equal(get(jR).outcome, "replied");

// 引用されたこちらの文面（「不要な場合は」「控えさせていただきます」）では断りにしない
assert.equal(applyIncomingMail(MAILBOX, mail("info@inyou.co.jp", "Re: ご提案", `承知しました。社内で確認します。\n\n2026年9月10日(水) 10:00 田中 太郎 <${MAILBOX}>:\n> ${SENT_MSG.split("\n").join("\n> ")}`)), jQ);
assert.equal(get(jQ).outcome, "replied", "引用部分の言葉は判定に使わない");
// その後にアポの返信が来たら、自動判定の「返信あり」を「アポ」に上げる
applyIncomingMail(MAILBOX, mail("info@inyou.co.jp", "Re: Re: ご提案", "オンラインでのお打ち合わせをお願いできますか。"));
assert.equal(get(jQ).outcome, "appointment", "自動の返信ありは、後から来たアポで上書きする");

// 自動返信・受付確認は数えない
assert.equal(applyIncomingMail(MAILBOX, mail("info@auto-reply.co.jp", "【自動返信】お問い合わせを受け付けました", "このメールは自動送信されています。")), null);
assert.equal(applyIncomingMail(MAILBOX, mail("info@auto-reply.co.jp", "お問い合わせありがとうございます", "以下の内容で受け付けました。")), null);
assert.equal(applyIncomingMail(MAILBOX, mail("info@auto-reply.co.jp", "Re: ご提案", "ありがとうございます", true)), null, "Auto-Submitted ヘッダー");
assert.equal(applyIncomingMail(MAILBOX, mail("mailer-daemon@googlemail.com", "Delivery Status Notification", "")), null);
assert.equal(get(jAuto).outcome, "", "自動返信では反応を付けない");

// 人が手で記録した反応は上書きしない
assert.equal(applyIncomingMail(MAILBOX, mail("info@manual.co.jp", "Re", "今回は見送りとさせていただきます。")), null);
assert.equal(get(jManual).outcome, "replied");

// 別の受信箱から送った会社は、この受信箱の返信では付けない。送る前に届いたメールも関係ない
assert.equal(applyIncomingMail(MAILBOX, mail("info@other.co.jp", "Re", "日程を調整させてください")), null);
assert.equal(applyIncomingMail(MAILBOX, { ...mail("info@appo.co.jp", "前のメール", "見送ります"), date: new Date("2026-09-01T00:00:00Z") }), null);
// フリーメールはドメインでは突き合わせない（アドレスが一致したときだけ）
assert.equal(applyIncomingMail(MAILBOX, mail("someone@gmail.com", "Re", "日程を調整させてください")), null);

// 判定単体
assert.equal(classifyReply("配信停止", "").outcome, "declined");
assert.equal(classifyReply("Re", "今回は見送りますが、また日程が合えばお話を伺いたいです").outcome, "replied", "断りとアポの両方 → 人に任せる");
assert.equal(stripQuoted("了解です\n-----Original Message-----\n不要です"), "了解です");
assert.equal(imapHostFor({ smtp_host: "smtp.gmail.com" } as never), "imap.gmail.com");
assert.equal(imapHostFor({ smtp_host: "smtp.office365.com" } as never), "outlook.office365.com");

// フォーム送信後の受付確認メール（こちらの文面を見出し付きで転記）は数えない
const jConf = job(camp, "受付確認株式会社", "", "uketsuke.co.jp", "form");
const LONG_MSG = "貴社にご貢献できるかと存じますので、詳細についてオンラインにてお話しさせていただけませんでしょうか。\n以下リンクからご予約お願いいたします。";
db.prepare("UPDATE form_jobs SET message_used=? WHERE id=?").run(LONG_MSG, jConf);
assert.equal(applyIncomingMail(MAILBOX, mail("info@uketsuke.co.jp", "送信ありがとうございました", `お名前：田中 太郎\nお問い合わせ内容：${LONG_MSG.split("\n")[0]}\n送信日時：2026/09/12 12:00`)), null, "件名「送信ありがとうございました」");
assert.equal(applyIncomingMail(MAILBOX, mail("info@uketsuke.co.jp", "株式会社受付 お問い合わせ", `担当より確認します。\nお問い合わせ内容：${LONG_MSG.split("\n")[0]}`)), jConf);
assert.equal(get(jConf).outcome, "replied", "転記されたこちらの文面（お話しさせて…）ではアポにしない");
assert.ok(get(jConf).outcome_note.includes("本文「"), "判定に使った本文の抜粋を残す");

// 引用記号なしで署名・配信停止の案内が引用されても、断りにしない。件名の「商談」でもアポにしない
const jFoot = job(camp, "署名引用株式会社", "info@foot.co.jp", "foot.co.jp");
assert.equal(applyIncomingMail(MAILBOX, mail("info@foot.co.jp", "Re: 【ご提案】人事担当者との商談機会について", "資料拝見しました。社内で検討します。\n\n今後このご案内が不要な場合は、お手数ですが本メールに「配信停止」とご返信ください（sales@sender.example）。以後お送りしません。")), jFoot);
assert.equal(get(jFoot).outcome, "replied");
// 本当の配信停止の返信
const jStop = job(camp, "配信停止株式会社", "info@stop.co.jp", "stop.co.jp");
applyIncomingMail(MAILBOX, mail("info@stop.co.jp", "配信停止", ""));
assert.equal(get(jStop).outcome, "declined");

// HPのドメインと送信先メールのドメインが違う会社（送信先 sales@dummy-navi.example、返信は担当者の k-sato@dummy-navi.example）
const jDiff = job(camp, "別ドメイン株式会社", "sales@lognavi.example", "aspark.example");
assert.equal(applyIncomingMail(MAILBOX, mail("k-sato@lognavi.example", "Re: 【ご提案】人事担当者との商談機会について", "ぜひ1度お話の機会を頂戴できますと幸いです。9月18日(金)16:00～17:00にて登録させていただきました。")), jDiff, "送信先メールのドメインでも突き合わせる");
assert.equal(get(jDiff).outcome, "appointment");
// Apple Mail の配信停止（件名「配信停止」＋ Auto-Submitted）は断り
const jApple = job(camp, "アップルメール株式会社", "info@apple-unsub.jp", "apple-unsub.jp");
assert.equal(applyIncomingMail(MAILBOX, mail("yoshi@apple-unsub.jp", "配信停止", "このメールは“配信停止”というメッセージへの登録を解除するためにApple Mailから送信されました。", true)), jApple);
assert.equal(get(jApple).outcome, "declined");
// 返信本文の「配信停止をお願いいたします」は断り（件名の「商談」はアポにしない）
const jSenior = job(camp, "シニア株式会社", "info@senior.example", "corp.senior.example");
applyIncomingMail(MAILBOX, mail("info@senior.example", "Re: 【ご提案】人事担当者との商談機会について", "田中様 お世話になります。ご連絡有難うございます。下記件ですが、配信停止をお願いいたします。"));
assert.equal(get(jSenior).outcome, "declined");
// 受付確認メール（件名に「内容のご確認」「控え」、本文に「サイトより送信されています」）は数えない
const jCtrl = job(camp, "控え株式会社", "", "hikae.example", "form");
assert.equal(applyIncomingMail(MAILBOX, mail("support@hikae.example", "【株式会社控え】お問い合わせ 控え", "※本メールは(株)控え ウェブサイトより送信されています")), null);
assert.equal(applyIncomingMail(MAILBOX, mail("support@hikae.example", "お知らせ", "～このメールは、システムからの自動返信です～")), null);
assert.equal(get(jCtrl).outcome, "");

// 「メール配信停止」リンク（mailto）: 件名「配信停止」・本文に対象アドレス。個人アドレスから送られても、対象アドレスで会社を特定して断りにする
{
  const { buildEmailBody, unsubscribeMailto } = await import("../src/email.js");
  const html = buildEmailBody("本文", { company: "株式会社サンプル商事", person: "田中", email: MAILBOX, reply_email: "" } as never, "info@link-stop.jp").html;
  assert.ok(html.includes(">メール配信停止</a>") && html.includes(`mailto:${MAILBOX}?subject=${encodeURIComponent("配信停止")}`), "HTMLメールに配信停止リンク");
  assert.ok(decodeURIComponent(unsubscribeMailto(MAILBOX, "info@link-stop.jp")).includes("対象アドレス: info@link-stop.jp"));
  const jLink = job(camp, "リンク停止株式会社", "info@link-stop.jp", "link-stop.jp");
  assert.equal(applyIncomingMail(MAILBOX, mail("someone.private@gmail.com", "配信停止", "配信停止を希望します。\n対象アドレス: info@link-stop.jp\n（このまま送信してください）")), jLink, "対象アドレスで会社を特定");
  assert.equal(get(jLink).outcome, "declined");
  assert.ok(db.prepare("SELECT 1 FROM form_suppressions WHERE domain='link-stop.jp'").get(), "除外リストに入る");
  // 返信に引用された「メール配信停止」の文字では断りにしない
  const jQuote = job(camp, "リンク引用株式会社", "info@link-quote.jp", "link-quote.jp");
  applyIncomingMail(MAILBOX, mail("info@link-quote.jp", "Re: ご提案", "ご連絡ありがとうございます。社内で確認します。\n\n今後このご案内が不要な場合は、以下のリンクからお手続きください。以後お送りしません。\nメール配信停止"));
  assert.equal(get(jQuote).outcome, "replied");
}

// 戻りメール（届かなかったメール）: 送った会社を「失敗」にする。宛先不明は配信停止にも入れる
{
  const { applyBounce } = await import("../src/replies.js");
  const st = (id: number) => (db.prepare("SELECT status, result_text FROM form_jobs WHERE id=?").get(id) as { status: string; result_text: string });
  const jHard = job(camp, "宛先不明株式会社", "info@nouser.example", "nouser.example");
  assert.equal(applyBounce(MAILBOX, mail("mailer-daemon@googlemail.com", "Delivery Status Notification (Failure)", "アドレス不明 アドレスが見つからなかったか、メールを受信できないアドレスであるため、メールは info@nouser.example に配信されませんでした。 リモート サーバーからの応答: 550 5.1.1 User unknown")), jHard);
  assert.equal(st(jHard).status, "failed");
  assert.ok(st(jHard).result_text.includes("宛先不明"));
  assert.ok(db.prepare("SELECT 1 FROM email_optouts WHERE email='info@nouser.example'").get(), "宛先不明は配信停止に入る");
  const jSize = job(camp, "サイズ超過株式会社", "info@big.example", "big.example");
  assert.equal(applyBounce(MAILBOX, mail("mailer-daemon@googlemail.com", "Delivery Status Notification (Failure)", "メールサイズの制限超過 メールのサイズが制限を超えているため、info@big.example に配信できませんでした。 552 5.3.4 Message size exceeds fixed limit")), jSize);
  assert.ok(st(jSize).result_text.includes("大きすぎ"));
  assert.ok(!db.prepare("SELECT 1 FROM email_optouts WHERE email='info@big.example'").get(), "サイズ超過は配信停止にしない（リンクにすれば届く）");
  const jOl = job(camp, "Outlook株式会社", "marai@outlook-co.example", "outlook-co.example");
  assert.equal(applyBounce(MAILBOX, mail("postmaster@outlookco.onmicrosoft.com", "Undeliverable: 【ご提案】人事担当者との商談機会について", "Delivery has failed to these recipients or groups: marai@outlook-co.example Your message is too large to send.")), jOl);
  const jDelay = job(camp, "遅延株式会社", "info@delay.example", "delay.example");
  assert.equal(applyBounce(MAILBOX, mail("mailer-daemon@googlemail.com", "Delivery Status Notification (Delay)", "info@delay.example への配信が遅れています")), null, "遅延通知は失敗にしない");
  assert.equal(st(jDelay).status, "sent");
  assert.equal(applyBounce(MAILBOX, mail("info@normal.example", "Re: ご提案", "ありがとうございます")), null, "普通の返信は戻りメールではない");
  // 2回目に読んだとき: 記録は済んでいるので applyBounce は null だが、振り分けでは「戻りメール」と分かる必要がある
  const { isOurBounce } = await import("../src/replies.js");
  const again = mail("mailer-daemon@googlemail.com", "Delivery Status Notification (Failure)", "アドレス不明 メールは info@nouser.example に配信されませんでした。 550 5.1.1 User unknown");
  assert.equal(applyBounce(MAILBOX, again), null, "記録済みの戻りメールは二重に記録しない");
  assert.equal(isOurBounce(MAILBOX, again), true, "記録済みでも、うちから送った宛先の戻りメールは振り分ける");
  assert.equal(isOurBounce(MAILBOX, mail("mailer-daemon@googlemail.com", "Delivery Status Notification (Failure)", "メールは friend@private.example に配信されませんでした。")), false, "アプリで送っていない宛先の戻りメールは触らない");
  assert.equal(isOurBounce(MAILBOX, mail("mailer-daemon@googlemail.com", "Delivery Status Notification (Delay)", "info@nouser.example への配信が遅れています")), false, "遅延通知は振り分けない");
  // 本文に元の宛先が無く、添付の元ヘッダーの To にだけあるサーバー（kagoya 等）でも、失敗として記録する
  const jKagoya = job(camp, "転送先株式会社", "info@alias.example", "alias.example");
  const kagoya = mail("MAILER-DAEMON@mas03.kagoya.net", "Undelivered Mail Returned to Sender", "This is the mail system at host mas03.kagoya.net.\n<kir0001.info@mas03.kagoya.net>: can't create user output file\n"
    + `Reporting-MTA: dns; mas03.kagoya.net\nFinal-Recipient: rfc822; kir0001.info@mas03.kagoya.net\nFrom: ${MAILBOX}\nTo: info@alias.example\nList-Unsubscribe: =?UTF-8?Q?=3Cmailto=3Ax=40y=2Ecom?=\n =?UTF-8?Q?=3Fsubject=3D=E9=85=8D=E4=BF=A1=E5=81=9C?=`);
  assert.equal(applyBounce(MAILBOX, kagoya), jKagoya, "添付ヘッダーの To から送り先を見つける");
  // 別のPCのApoBoostから同じアカウントで送った分（このPCに記録が無い）も、目印のヘッダーで戻りメールと分かる
  const other = mail("mailer-daemon@googlemail.com", "Delivery Status Notification (Failure)", "shibata@other-pc.example に配信されませんでした\nList-Unsubscribe:\n <mailto:x@y.com?subject=%E9%85%8D%E4%BF%A1%E5%81%9C%E6%AD%A2&body=...>\nTo: shibata@other-pc.example");
  assert.equal(applyBounce(MAILBOX, other), null, "このPCに送信記録が無いので記録はしない");
  assert.equal(isOurBounce(MAILBOX, other), true, "でも振り分けはする");
  const { isOurDelayNotice } = await import("../src/replies.js");
  assert.equal(isOurDelayNotice(mail("Mailer-Daemon@s264.xrea.com", "Warning: message 1x70 delayed 24 hours", "not yet been delivered\nList-Unsubscribe: <mailto:x@y.com?subject=%E9%85%8D%E4%BF%A1%E5%81%9C%E6%AD%A2>")), true, "うちの送信の遅延通知は受信箱から外す");
  assert.equal(isOurDelayNotice(mail("Mailer-Daemon@s264.xrea.com", "Warning: message 1x70 delayed 24 hours", "not yet been delivered")), false, "目印が無ければ触らない");
}

// ---- 受信箱の振り分け（ラベル）----
{
  const own = ["株式会社サンプル商事", "田中 太郎"];
  // 送った会社からの自動返信 → 自動返信（受信箱から外す）
  assert.equal(inboxCategory(MAILBOX, mail("info@appo.co.jp", "【アポ株式会社】お問い合わせありがとうございます", "このメールは自動送信しています。以下の内容で受け付けました。"), own), "auto");
  // 差出人が送り先と違うアドレス（フォームの送信システム）でも、本文にこちらの名前が入った受付確認なら自動返信
  assert.equal(inboxCategory(MAILBOX, mail("apache@server-host.example", "受付完了メール", "※本メールは自動送信されております。\nお名前: 田中 太郎\n会社名: 株式会社サンプル商事"), own), "auto");
  // フォーム作成サービスから届く受付確認（こちらの名前もドメインも無い）でも、直前に送った会社の名前が入っていれば自動返信
  const soon = { ...mail("info@tayori.example", "*No.406 返信だけ株式会社お問い合わせフォーム*", "送信が完了いたしました。お問い合わせ内容の確認は下記から。", true), date: new Date("2026-09-10T01:05:00Z") };
  assert.equal(inboxCategory(MAILBOX, soon, own), "auto");
  // 同じメールでも、送ってから何日も後なら（たまたま名前が一致しただけかもしれないので）触らない
  assert.equal(inboxCategory(MAILBOX, mail("info@tayori.example", "*No.406 返信だけ株式会社お問い合わせフォーム*", "送信が完了いたしました。", true), own), null);
  // こちらの名前が入っていない自動送信メール（カード会社の通知など）には触らない
  assert.equal(inboxCategory(MAILBOX, mail("no-reply@card.example", "【カード】オンライン支払い口座設定・完了のおしらせ", "このメールは送信専用アドレスから自動送信しています。"), own), null);
  // 関係のない人からの普通のメールにも触らない
  assert.equal(inboxCategory(MAILBOX, mail("friend@gmail.com", "週末の件", "来週の打ち合わせの日程を決めましょう"), own), null);
  // 送った会社からの本物の返信は、その中身で振り分ける（アポ・断り）
  assert.equal(inboxCategory(MAILBOX, mail("tanaka@appo.co.jp", "Re: ご提案", "一度お話を伺いたく、来週のご都合を教えてください。"), own), "appointment");
  assert.equal(inboxCategory(MAILBOX, mail("soumu@kotowari.jp", "Re: ご提案", "今後のご連絡は不要です。"), own), "declined");
  // 契約・署名・セキュリティの知らせは、こちらの社名が入っていても受信箱から外さない
  assert.equal(inboxCategory(MAILBOX, mail("noreply@gmosign.example", "署名依頼登録通知（株式会社サンプル商事 御中_覚書）", "株式会社サンプル商事 様より署名依頼がありました。このメールは自動送信です。", true), own), null);
  assert.equal(inboxCategory(MAILBOX, mail("no-reply@accounts.google.example", "セキュリティ通知", "田中 太郎 さん、新しいログインがありました。", true), own), null);
  // 送った会社からの人の返信（件名が Re:）は、自動返信の言い回しが本文にあっても外さない
  assert.equal(inboxCategory(MAILBOX, mail("tanaka@appo.co.jp", "Re: 【ご提案】人事担当者との商談機会について", "お問い合わせありがとうございます。社内で検討いたします。"), own), "replied");
  // 送った会社からの辞退の連絡は「断り」（件名が Re: でなくても）
  assert.equal(inboxCategory(MAILBOX, mail("w@appo.co.jp", "ご提案へのお礼と辞退のご連絡", "このたびはご提案ありがとうございました。今回は見送らせていただきます。"), own), "declined");
  // 丁寧な辞退（「ご期待に沿うことが難しい」「拝辞」）は、「お送りいただきました内容」とあっても人の断り
  assert.equal(inboxCategory(MAILBOX, mail("w@appo.co.jp", "ご提案へのお礼と辞退のご連絡", "お世話になっております。株式会社アポの和才と申します。お送りいただきました内容について社内にて検討しましたが、現時点ではご期待に沿うことが難しいという結論に至りました。"), own), "declined");
  // 受付確認の自動返信が、こちらの文面（日程・商談）を写し返していても、アポにはしない
  assert.equal(inboxCategory(MAILBOX, mail("info@appo.co.jp", "お問い合わせありがとうございました", "このメールは自動送信されています。以下の内容で受け付けました。ご都合のよい日程で商談の機会をいただけますと幸いです。"), own), "auto");
  // 受付確認が、こちらの文面（「田中と申します」）を写し返していても、人の返信とはみなさない
  assert.equal(inboxCategory(MAILBOX, mail("info@appo.co.jp", "お問い合わせありがとうございます。", "この度はお問い合わせ頂き誠にありがとうございます。改めて担当者よりご連絡します。─ご送信内容の確認─ [お名前] 田中 太郎 [お問い合わせ内容] 株式会社BizLaboの田中と申します。ぜひ一度お打ち合わせの日程をいただけますと幸いです。"), own), "auto");
  // Googleフォームの回答の控え・社内のメールには触らない
  assert.equal(inboxCategory(MAILBOX, mail("forms-receipts-noreply@google.com", "フォームにご記入いただきありがとうございます: 経費申請フォーム", "株式会社サンプル商事 田中 太郎", true), own), null);
  assert.equal(inboxCategory(MAILBOX, mail("keiri@sender.example", "お問い合わせありがとうございます", "株式会社サンプル商事 田中 太郎"), own), null);
  // 自分自身から届いたメール（送信の控えなど）には触らない
  assert.equal(inboxCategory(MAILBOX, mail(MAILBOX, "【ご提案】", "本文"), own), null);
}

console.log("replies: ALL OK");

// 送信中に止まったメール: 送信済みフォルダの控えで判断
{
  const { decideInterrupted } = await import("../src/replies.js");
  const claim = new Date("2026-09-16T16:04:49Z");
  assert.equal(decideInterrupted([new Date("2026-09-16T16:04:51Z")], claim, true).verdict, "sent", "送信開始の直後に控えがある → 送信済み");
  assert.equal(decideInterrupted([new Date("2026-08-01T00:00:00Z")], claim, true).verdict, "not_sent", "前に送った別の控えだけ → Gmailなら未送信");
  assert.equal(decideInterrupted([], claim, false).verdict, "unknown", "控えが残らないサービスでは決めない");
  console.log("interrupted: ALL OK");
}
