// お客さんに渡す配布版を作る（ソースを読める形で渡さないため）。
//   node scripts/build-dist.mjs [出力先フォルダ]   （既定: .dist/ApoBoost）
//
// src/ の TypeScript を1つのファイル app/server.mjs に固め、名前を短く詰めて読みにくくする（esbuild。tsx と一緒に入っている）。
// npm の部品（node_modules）は固めずに、お客さんのPCで npm install する（better-sqlite3 や Playwright はPCごとに入れる必要がある）。
// 開発用のファイル（src・test・CLAUDE.md・ライセンスの発行用スクリプトなど）は入れない。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.resolve(process.argv[2] || path.join(root, ".dist", "ApoBoost"));
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

// 前の出力を消す（.git は残す: 配布用リポジトリの作業フォルダに直接書き出すため）
if (fs.existsSync(out)) for (const name of fs.readdirSync(out)) if (name !== ".git") fs.rmSync(path.join(out, name), { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

// 1) 本体を固める
await build({
  entryPoints: [path.join(root, "src", "server.ts")],
  outfile: path.join(out, "app", "server.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  // npm の部品は固めない（お客さんのPCで npm install する）
  packages: "external",
  minify: true,
  // 関数名を残すと、ページの中で動かす関数に __name(...) が差し込まれて落ちる（CLAUDE.md の page.evaluate の落とし穴）
  keepNames: false,
  legalComments: "none",
  sourcemap: false,
  banner: { js: `// ApoBoost v${pkg.version} — © 2026 ApoBoost. All rights reserved. 無断の複製・改変・再配布・転売・解析を禁じます（LICENSE・利用規約）。` },
  logLevel: "warning",
});

// 2) そのまま入れるもの
const copy = (name) => {
  const from = path.join(root, name), to = path.join(out, name);
  if (!fs.existsSync(from)) return;
  fs.cpSync(from, to, { recursive: true });
};
for (const name of ["assets", "LICENSE", "update.json", "ApoBoost.app", "ApoBoost起動.command", "ApoBoost起動.bat", "インストール（最初に1回）.bat"]) copy(name);
fs.mkdirSync(path.join(out, "scripts"), { recursive: true });
fs.copyFileSync(path.join(root, "scripts", "run.mjs"), path.join(out, "scripts", "run.mjs"));
// Mac のダブルクリック起動ファイルには実行権限が要る
for (const f of ["ApoBoost起動.command", "ApoBoost.app/Contents/MacOS/apoboost"]) { try { fs.chmodSync(path.join(out, f), 0o755); } catch { /* 無い場合は何もしない */ } }

// 3) package.json: 動かすのに要る部品だけ（開発用の tsx・typescript などは入れない）
const distPkg = {
  name: pkg.name,
  version: pkg.version,
  private: true,
  license: "SEE LICENSE IN LICENSE",
  type: pkg.type,
  engines: pkg.engines,
  scripts: { start: "node scripts/run.mjs" },
  dependencies: pkg.dependencies,
};
fs.writeFileSync(path.join(out, "package.json"), JSON.stringify(distPkg, null, 2) + "\n");
// 版を揃えるために、開発版の package-lock.json をそのまま入れる（開発用の部品は package.json に無いので入らない）
fs.copyFileSync(path.join(root, "package-lock.json"), path.join(out, "package-lock.json"));

// 4) README: 配布元向けの節（キーの発行）は外す
let readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
readme = readme.replace(/\n### キーの発行（配布元の作業）[\s\S]*?(?=\n## )/, "\n");
fs.writeFileSync(path.join(out, "README.md"), readme);

// 5) 入っていないことを確かめる（ソース・秘密鍵・データが紛れ込まないように）
const bad = ["src", "test", "license-keys", "data", "data-dev", "CLAUDE.md", "scripts/license.mjs", "scripts/release.mjs", "node_modules"].filter((n) => fs.existsSync(path.join(out, n)));
if (bad.length) { console.error(`配布版に入れてはいけないものが入っています: ${bad.join(", ")}`); process.exit(1); }
const size = fs.statSync(path.join(out, "app", "server.mjs")).size;
console.log(`配布版を作りました: ${out}（v${pkg.version}・本体 ${Math.round(size / 1024)}KB）`);
