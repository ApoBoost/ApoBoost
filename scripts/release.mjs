// 更新版を配るための release.json を作る。
//   npm version patch   → package.json のバージョンを上げる
//   npm run release -- "直した内容"  → release.json を書き出す
//   git add -A && git commit -m "v0.1.2" && git push
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const cfg = JSON.parse(fs.readFileSync(path.join(root, "update.json"), "utf8"));

const m = /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\//.exec(cfg.manifest_url ?? "");
if (!m) {
  console.error("update.json の manifest_url を、自分のGitHubリポジトリのURLに書き換えてください。");
  console.error("  例: https://raw.githubusercontent.com/あなたのID/ApoBoost/main/release.json");
  process.exit(1);
}
const [, owner, repo, branch] = m;

// 更新チャネル（#94）: 「--beta」を付けると先行版として出す。
// 先行版は、先行版を選んでいる端末にだけ届く（安定版の端末には届かない）
const args = process.argv.slice(2);
const beta = args.includes("--beta");
const notes = args.filter((a) => a !== "--beta").join(" ") || "細かな改善";

const entry = {
  version: pkg.version,
  notes,
  zip: `https://github.com/${owner}/${repo}/archive/refs/heads/${branch}.zip`,
  published_at: new Date().toISOString(),
};

// 既存の release.json を読み、チャネルを保ったまま更新する
let prev = {};
try { prev = JSON.parse(fs.readFileSync(path.join(root, "release.json"), "utf8")); } catch { /* 初回 */ }
const channels = { ...(prev.channels ?? {}) };
channels[beta ? "beta" : "stable"] = entry;
// 先行版を出すときは、安定版の情報をそのまま残す（古い端末は最上位を見るので、最上位は安定版のまま）
const release = beta
  ? { ...(channels.stable ?? prev), channels }
  : { ...entry, channels };
fs.writeFileSync(path.join(root, "release.json"), JSON.stringify(release, null, 2) + "\n");
console.log(beta ? "※ 先行版として出しました（先行版を選んでいる端末にだけ届きます）" : "※ 安定版として出しました（全端末に届きます）");
console.log("release.json を書き出しました:");
console.log(JSON.stringify(release, null, 2));
console.log("\nこのあと git でプッシュすると、配布済みの全員が更新できるようになります:");
console.log(`  git add -A && git commit -m "v${pkg.version}" && git push`);
