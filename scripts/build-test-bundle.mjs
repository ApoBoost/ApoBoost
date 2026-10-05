// 配布版と同じ固め方（1ファイル・名前を詰める）でテストを固めて動かす。固めたことで壊れるところ
// （ページの中で動かす関数・ファイルの場所など）を、ダミーサイトの通しテストで確かめるため。
//   node scripts/build-test-bundle.mjs test/todo.ts   → .dist-test/todo.mjs を作る（リポジトリ直下から node で動かす）
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const f of process.argv.slice(2)) {
  await build({ entryPoints: [path.join(root, f)], outfile: path.join(root, ".dist-test", path.basename(f).replace(/\.ts$/, ".mjs")), bundle: true, platform: "node", format: "esm", target: "node20", packages: "external", minify: true, keepNames: false, logLevel: "warning" });
}
console.log("固めました:", process.argv.slice(2).join(", "));
