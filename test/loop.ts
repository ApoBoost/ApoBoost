// 送信のループ（runCampaign）を通しで動かす。`npm test`
// ブラウザを一定の社数ごとに新しくしても（FO_BROWSER_JOBS）、全社が1回ずつ送られ、途中の会社が切られないことを確かめる。
// （長く使い続けたブラウザが重くなり、1時間に約200社 → 約50社まで落ちて最後は固まった: Windows の利用先）
import http from "node:http";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

process.env.FO_NO_NOTIFY = "1";
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fo-loop-"));
process.env.FO_BROWSER_JOBS = "2";
process.env.FO_MIN_WAIT_MS = "200";
process.env.FO_MAX_WAIT_MS = "300";

const { getDb } = await import("../src/db.js");
const { importRowsToCampaign } = await import("../src/csv.js");
const { runCampaign } = await import("../src/worker.js");
const { DEFAULT_TEMPLATE: RAW_TEMPLATE } = await import("../src/message.js");
const DEFAULT_TEMPLATE = RAW_TEMPLATE.replace(/【ここに[^】]*】/g, "テスト用のサービス説明です");

const hits: Record<string, number> = {};
const page = (body: string) => `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>お問い合わせ</title></head><body>${body}</body></html>`;
const server = http.createServer((req, res) => {
  const host = String(req.headers.host ?? "").split(":")[0];
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  if (req.method === "POST") {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => { hits[host] = (hits[host] ?? 0) + 1; res.end(page("<h1>送信完了</h1><p>お問い合わせを受け付けました。</p>")); });
    return;
  }
  res.end(page(`<h1>お問い合わせ</h1><form method="post"><table>
<tr><th>お名前</th><td><input type="text" name="nm"></td></tr>
<tr><th>メールアドレス</th><td><input type="text" name="em"></td></tr>
<tr><th>お問い合わせ内容</th><td><textarea name="msg"></textarea></td></tr></table><button type="submit">送信する</button></form>`));
});
await new Promise<void>((r) => server.listen(0, r));
const port = (server.address() as { port: number }).port;

const db = getDb();
const senderId = db.prepare(`INSERT INTO sender_profiles(label,company,industry,person,person_kana,email,tel,postal,address,url) VALUES(?,?,?,?,?,?,?,?,?,?)`)
  .run("loop", "株式会社サンプル商事", "動画制作", "山田 太郎", "ヤマダ タロウ", "sales@example.com", "03-1234-5678", "114-0001", "東京都北区1-2-3", "https://example.com").lastInsertRowid;
const campaignId = db.prepare(`INSERT INTO form_campaigns(name,sender_id,mode,subject_text,template_text) VALUES(?,?,?,?,?)`)
  .run("loop", senderId, "template", "{{会社名}}様へ ご案内", DEFAULT_TEMPLATE).lastInsertRowid as number;
const N = 7;
importRowsToCampaign(campaignId, Array.from({ length: N }, (_, i) => ({
  company_name: `ループ${i + 1}株式会社`, form_url: `http://l${i + 1}.localhost:${port}/contact`, site_url: "", email: "", industry: "", sub_industry: "", prefecture: "", representative: "",
})));

try {
  const r = await runCampaign(campaignId, { ignoreWindow: true });
  const rows = db.prepare("SELECT company_name, status, result_text FROM form_jobs WHERE campaign_id=? ORDER BY id").all(campaignId) as { company_name: string; status: string; result_text: string }[];
  for (const j of rows) assert.equal(j.status, "sent", `${j.company_name}: ${j.result_text.split("\n")[0]}`);
  assert.equal(r.processed, N, `処理した社数 ${r.processed}`);
  for (let i = 1; i <= N; i++) assert.equal(hits[`l${i}.localhost`], 1, `l${i}: 送信は1回だけ（${hits[`l${i}.localhost`] ?? 0}回）`);
  const { browserRelaunches } = await import("../src/worker.js");
  assert.ok(browserRelaunches >= 2, `ブラウザの入れ替えが起きていない（${browserRelaunches}回）`);
  const errs = db.prepare("SELECT text FROM app_logs WHERE kind='error'").all() as { text: string }[];
  assert.equal(errs.length, 0, `エラーの記録: ${errs.map((e) => e.text).join(" / ")}`);
  console.log(`loop: ALL OK（${N}社・ブラウザの入れ替え ${browserRelaunches}回）`);
} finally {
  server.close();
}
process.exit(0);
