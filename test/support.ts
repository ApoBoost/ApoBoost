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
    if (b.action === "ask") { sheet.push({ ticket: b.ticket, who: b.who, question: b.question, reply: "" }); return res.end(JSON.stringify({ ok: true })); }
    if (b.action === "poll") return res.end(JSON.stringify({ ok: true, replies: sheet.filter((r) => b.tickets.includes(r.ticket) && r.reply).map((r) => ({ ticket: r.ticket, reply: r.reply })) }));
    res.end(JSON.stringify({ ok: false }));
  });
});
await new Promise<void>((r) => server.listen(0, r));
process.env.SUPPORT_URL = `http://127.0.0.1:${(server.address() as { port: number }).port}/exec`;

const { getDb } = await import("../src/db.js");
const { askSupport, pollSupportReplies, supportThread, supportUnread, markSupportSeen, supportUrl } = await import("../src/support.js");
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
// 受け口につながらないときは控えだけ残し、つながったら送り直す
down = true;
const b = await askSupport(1, "x", "つながらないときの質問です。あとで送られますか？", "/");
assert.equal(b.ok, false);
assert.equal(sheet.length, 1);
down = false;
await pollSupportReplies();
assert.equal(sheet.length, 2, "つながったら自動で送り直す");
// 送り先が未設定・不正なら、機能ごと止まる
delete process.env.SUPPORT_URL;
assert.equal(supportUrl(), "", "update.json の support_url が空なら無効");

server.close();
console.log("support: ALL OK");
process.exit(0);
