// 質問箱の「担当者に送る」: 配布元の受け口（Apps Script）の代わりをローカルに立てて、送る → 返信が届く、を確かめる
import http from "node:http";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

process.env.FO_NO_NOTIFY = "1";
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fo-support-"));

// 受け口の代わり。届いた質問を覚えておき、返信が書かれていれば poll で返す
const sheet: { ticket: string; who: string; question: string; reply: string }[] = [];
let down = false;
const server = http.createServer((req, res) => {
  let data = "";
  req.on("data", (c) => (data += c));
  req.on("end", () => {
    if (down) { res.writeHead(500); return res.end("down"); }
    const b = JSON.parse(data || "{}");
    res.writeHead(200, { "content-type": "application/json" });
    if (b.action === "ask") { sheet.push({ ticket: b.ticket, who: b.who, question: b.question, reply: "", context: b.context, parent: b.parent } as (typeof sheet)[number]); return res.end(JSON.stringify({ ok: true })); }
    if (b.action === "poll") return res.end(JSON.stringify({ ok: true, replies: sheet.filter((r) => b.tickets.includes(r.ticket) && r.reply).map((r) => ({ ticket: r.ticket, reply: r.reply })) }));
    res.end(JSON.stringify({ ok: false }));
  });
});
await new Promise<void>((r) => server.listen(0, r));
process.env.SUPPORT_URL = `http://127.0.0.1:${(server.address() as { port: number }).port}/exec`;

const { getDb } = await import("../src/db.js");
const { askSupport, pollSupportReplies, supportThread, supportUnread, markSupportSeen, supportUrl, recordHelpMiss, recordHelpFeedback, topHelpMisses, unsolvedHelp } = await import("../src/support.js");
getDb();

// 送る
const a = await askSupport(1, "株式会社サンプル商事 / 山田", "CSVを取り込むと文字化けします。どうすればよいですか？", "/campaigns/1");
assert.equal(a.ok, true, "質問が受け口に届く");
assert.equal(sheet.length, 1);
assert.equal(sheet[0].who, "株式会社サンプル商事 / 山田");
assert.match(sheet[0].ticket, /^[0-9a-f]{32}$/);
// 返信がまだ無いあいだは、何も届かない
assert.equal(await pollSupportReplies(), 0);
assert.equal(supportUnread(1), 0);
// 配布元が返信を書く → 次の確認で届く
sheet[0].reply = "CSVを UTF-8 で保存し直してから取り込んでください。";
assert.equal(await pollSupportReplies(), 1, "返信が1件届く");
assert.equal(await pollSupportReplies(), 0, "同じ返信を2回は数えない");
assert.equal(supportUnread(1), 1);
assert.equal(supportThread(1)[0].reply, "CSVを UTF-8 で保存し直してから取り込んでください。");
assert.equal(supportThread(2).length, 0, "ほかの利用者のやり取りは見えない");
markSupportSeen(1);
assert.equal(supportUnread(1), 0);
// その1社の状況を添えて送る。追加の質問は、元の質問の番号を付ける
const c = await askSupport(1, "x", "この会社だけ何度送っても失敗します。原因は何でしょうか？", "/jobs/5", "会社名: 失敗サービス / 失敗の種類: 必須項目未入力", supportThread(1)[0].id);
assert.equal(c.ok, true);
assert.equal((sheet[1] as unknown as { context: string }).context, "会社名: 失敗サービス / 失敗の種類: 必須項目未入力", "状況が受け口に届く");
assert.equal((sheet[1] as unknown as { parent: string }).parent, sheet[0].ticket, "追加の質問には、元の質問の番号が付く");
const other = await askSupport(2, "y", "ほかの利用者の質問を親に指定しても、番号は付きません。", "/", "", supportThread(1)[0].id);
assert.equal((sheet[2] as unknown as { parent: string }).parent, "", "ほかの利用者の質問は親にできない");
void other;
// 質問箱の使われ方は、この端末の中だけに残る
recordHelpMiss("文字化け"); recordHelpMiss("文字化け"); recordHelpMiss("請求書");
assert.deepEqual(topHelpMisses(5).map((m) => [m.text, m.n]), [["文字化け", 2], ["請求書", 1]]);
recordHelpFeedback("「入力エラー」で失敗します", false);
assert.equal(unsolvedHelp(5)[0].question, "「入力エラー」で失敗します");

// 受け口につながらないときは控えだけ残し、つながったら送り直す
down = true;
const b = await askSupport(1, "x", "つながらないときの質問です。あとで送られますか？", "/");
assert.equal(b.ok, false);
assert.equal(sheet.length, 3);
down = false;
await pollSupportReplies();
assert.equal(sheet.length, 4, "つながったら自動で送り直す");
// 送り先が未設定・不正なら、機能ごと止まる
process.env.SUPPORT_URL = "";
assert.equal(supportUrl(), "", "送り先が空なら無効");
// update.json に書いてある値は、Apps Script のウェブアプリの形のときだけ通す
delete process.env.SUPPORT_URL;
assert.ok(supportUrl() === "" || /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(supportUrl()), "update.json の support_url は決まった形だけ");

server.close();
console.log("support: ALL OK");
process.exit(0);
