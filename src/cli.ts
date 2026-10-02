// コマンドライン: npm run cli -- <command>
//   import <campaignId> <file.csv>   CSVを取り込む
//   run <campaignId> [--now]         キューを回す（--now で時間帯無視）
//   stats <campaignId>               件数を表示
import fs from "node:fs";
import { getDb, STATUS_LABEL } from "./db.js";
import { parseCompanyCsv, importRowsToCampaign } from "./csv.js";
import { runCampaign } from "./worker.js";

const [cmd, a, b] = process.argv.slice(2);
const db = getDb();
if (cmd === "import") {
  const s = importRowsToCampaign(Number(a), parseCompanyCsv(fs.readFileSync(b)));
  console.log(s);
} else if (cmd === "run") {
  const r = await runCampaign(Number(a), { ignoreWindow: b === "--now", onProgress: (j) => console.log(`${STATUS_LABEL[j.status]}\t${j.company_name}\t${(j.result_text || "").split("\n")[0]}`) });
  console.log(r);
} else if (cmd === "stats") {
  console.table(db.prepare("SELECT status, COUNT(*) n FROM form_jobs WHERE campaign_id=? GROUP BY status").all(Number(a)));
} else {
  console.log("usage: cli import <campaignId> <csv> | run <campaignId> [--now] | stats <campaignId>");
}
