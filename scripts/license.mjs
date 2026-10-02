// ライセンスキーを発行する（配布元だけが使う）。秘密鍵は license-keys/private.pem（gitには入れない）。
//
//   node scripts/license.mjs --init                      # 鍵を作り直す（既存の鍵を上書きしないよう注意）
//   npm run license -- --to "株式会社サンプル" --days 365 --seats 3
//
// 出てきた APO1.… の1行を、相手の「設定」画面に貼ってもらいます。
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "license-keys");
const privPath = path.join(dir, "private.pem");

const args = process.argv.slice(2);
const get = (name, fb = "") => { const i = args.indexOf(`--${name}`); return i >= 0 ? (args[i + 1] ?? "") : fb; };
const has = (name) => args.includes(`--${name}`);

if (has("init")) {
  if (fs.existsSync(privPath)) { console.error("すでに license-keys/private.pem があります。作り直すと、発行済みのキーがすべて無効になります。消してから実行してください。"); process.exit(1); }
  fs.mkdirSync(dir, { recursive: true });
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  fs.writeFileSync(privPath, privateKey.export({ type: "pkcs8", format: "pem" }));
  const pub = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  fs.writeFileSync(path.join(dir, "public.txt"), pub);
  console.log("鍵を作りました。src/license.ts の PUBLIC_KEY_B64 を次の値に書き換えてください:\n");
  console.log(pub);
  process.exit(0);
}

if (!fs.existsSync(privPath)) {
  console.error("license-keys/private.pem がありません。発行元のPCで作成してください（node scripts/license.mjs --init）。");
  process.exit(1);
}
const to = get("to");
if (!to) {
  console.error('使い方: npm run license -- --to "会社名" [--days 365] [--seats 3] [--note "備考"]');
  process.exit(1);
}
const days = Number(get("days", "365")) || 365;
const seats = Number(get("seats", "1")) || 1;
const exp = days > 0 ? new Date(Date.now() + days * 86400000 + 9 * 3600000).toISOString().slice(0, 10) : "";
const payload = {
  to,
  seats,
  exp,
  issued: new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10),
  id: crypto.randomUUID().slice(0, 8),
  ...(get("note") ? { note: get("note") } : {}),
};

// src/license.ts の署名処理と同じ（スクリプトからTypeScriptを読み込まずに済ませる）
const body = Buffer.from(JSON.stringify(payload), "utf8");
const sig = crypto.sign(null, body, crypto.createPrivateKey(fs.readFileSync(privPath, "utf8")));
const b64url = (b) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const key = `APO1.${b64url(body)}.${b64url(sig)}`;

console.log("発行しました:\n");
console.log(key);
console.log("\n内容:", JSON.stringify(payload, null, 2));
console.log("\nこの1行を相手に渡し、ApoBoostの「設定」画面に貼り付けてもらってください。");

// 発行の控え（gitには入らない）
const log = path.join(dir, "issued.jsonl");
fs.appendFileSync(log, JSON.stringify({ ...payload, key, at: new Date().toISOString() }) + "\n");
console.log(`控え: ${log}`);
