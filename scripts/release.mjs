// 新しい版を配る（お客さんのPCの「アップデート」に届ける）。
//   npm version patch                       → package.json の版を上げる
//   npm run release -- "直した内容"           → 配布版を作って、配布用リポジトリに出す（ここで初めてお客さんに届く）
//   git add -A && git commit -m "ApoBoost v1.2.3" && git push   → 開発用リポジトリ（非公開）にも残す
//
// 配布の仕組み:
//   開発用リポジトリ（ApoBoost/ApoBoost）は非公開。お客さんには、ソースを固めた配布版（scripts/build-dist.mjs）だけを、
//   公開の配布用リポジトリ（update.json の manifest_url の持ち主）に置いて渡す。お客さんのアプリは、そこの release.json を見て更新する。
//   配布用リポジトリの作業フォルダは .release/（git には入れない）。初回は自動で clone する。
//   --beta を付けると先行版として出す（先行版を選んでいる端末にだけ届く）。--dry を付けると、配布版を作るだけで出さない。
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const cfg = JSON.parse(fs.readFileSync(path.join(root, "update.json"), "utf8"));

const m = /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\//.exec(cfg.manifest_url ?? "");
if (!m) {
  console.error("update.json の manifest_url が、配布用リポジトリの release.json のURLになっていません。");
  process.exit(1);
}
const [, owner, repo, branch] = m;
const args = process.argv.slice(2);
const beta = args.includes("--beta"), dry = args.includes("--dry");
const notes = args.filter((a) => !a.startsWith("--")).join(" ") || "細かな改善";

const dir = path.join(root, ".release");
const git = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();

// 1) 配布用リポジトリの作業フォルダを用意する（無ければ clone、あれば最新にする）
if (!dry) {
  if (!fs.existsSync(path.join(dir, ".git"))) {
    // 開発用リポジトリと同じ SSH の設定（~/.ssh/config の Host）で取ってくる
    const origin = execFileSync("git", ["-C", root, "remote", "get-url", "origin"], { encoding: "utf8" }).trim();
    const host = /^git@([^:]+):/.exec(origin)?.[1] ?? "github.com";
    fs.rmSync(dir, { recursive: true, force: true });
    execFileSync("git", ["clone", `git@${host}:${owner}/${repo}.git`, dir], { stdio: "inherit" });
  } else {
    try { git("pull", "--ff-only", "-q"); } catch { /* まだ空のリポジトリ */ }
  }
}

// 2) 配布版を作る（.git は残して、中身だけ入れ替える）
execFileSync(process.execPath, [path.join(root, "scripts", "build-dist.mjs"), dir], { stdio: "inherit" });

// 3) release.json（お客さんのアプリが見る更新情報）
const entry = {
  version: pkg.version,
  notes,
  zip: `https://github.com/${owner}/${repo}/archive/refs/heads/${branch}.zip`,
  published_at: new Date().toISOString(),
};
// 前の release.json（チャネルを引き継ぐ）: 配布用リポジトリにあればそれ、無ければ（初回）開発用に残っている旧い release.json
let prev = {};
try { prev = JSON.parse(execFileSync("git", ["-C", dir, "show", "HEAD:release.json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })); }
catch { try { prev = JSON.parse(fs.readFileSync(path.join(root, "release.json"), "utf8")); } catch { /* 無ければ空 */ } }
const channels = { ...(prev.channels ?? {}) };
channels[beta ? "beta" : "stable"] = entry;
const release = beta ? { ...(channels.stable ?? prev), channels } : { ...entry, channels };
fs.writeFileSync(path.join(dir, "release.json"), JSON.stringify(release, null, 2) + "\n");

if (dry) { console.log(`\n配布版を作りました（--dry のため出していません）: ${dir}`); process.exit(0); }

// 4) 配布用リポジトリに出す
git("add", "-A");
const changed = git("status", "--porcelain");
if (!changed) { console.log("配布版に変わりがないため、出していません"); process.exit(0); }
git("-c", "user.name=ApoBoost", "-c", "user.email=noreply@apoboost.invalid", "commit", "-q", "-m", `ApoBoost v${pkg.version}${beta ? "（先行版）" : ""}: ${notes}`);
execFileSync("git", ["-C", dir, "push", "-q", "origin", `HEAD:${branch}`], { stdio: "inherit" });
console.log(beta ? "※ 先行版として出しました（先行版を選んでいる端末にだけ届きます）" : "※ 安定版として出しました（全端末に届きます）");
console.log(`v${pkg.version} を ${owner}/${repo} に出しました。`);
console.log("\n開発用リポジトリにも残してください:");
console.log(`  git add -A && git commit -m "ApoBoost v${pkg.version}" && git push`);
