// ApoBoostの起動役。アップデート後に自分で再起動できるよう、終了コード75なら立ち上げ直す。
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RESTART = 75;

// ターミナルのタブ名を「ApoBoost」にする。どのタブでツールが動いているか一目で分かるように。
function setTabTitle(title) {
  if (!process.stdout.isTTY) return;          // ログファイルに書き出す場合は何もしない
  process.stdout.write(`\x1b]1;${title}\x07\x1b]2;${title}\x07`);
}
setTabTitle("🐝 ApoBoost");

let current = null;
function start() {
  // npx tsx 経由だと、終了の合図を受けた tsx が数秒でアプリを強制終了し、送信の途中で切れていた。
  // node に tsx を読み込ませて直接起動し、合図がアプリ本体に届いて「送信中の会社を待ってから終了」できるようにする
  // node の --import は Node.js 20.6 以降。それより古いPCでは従来どおり npx tsx で起動する
  const [maj, min] = process.versions.node.split(".").map(Number);
  const direct = maj > 20 || (maj === 20 && min >= 6);
  const p = direct
    ? spawn(process.execPath, ["--import", "tsx", "src/server.ts"], { cwd: root, stdio: "inherit", env: process.env })
    : spawn(process.platform === "win32" ? "npx.cmd" : "npx", ["tsx", "src/server.ts"], { cwd: root, stdio: "inherit", shell: process.platform === "win32", env: process.env });
  p.on("close", (code) => {
    if (code === RESTART) {
      console.log("\n--- アップデートを適用して再起動します ---\n");
      start();
    } else {
      process.exit(code ?? 0);
    }
  });
  // 合図はアプリに渡し、アプリが終わる（close）のを待ってから自分も終わる。何度も登録しないよう1回だけ
  if (!start.bound) {
    start.bound = true;
    const stop = (sig) => { setTabTitle(""); if (current && current.exitCode === null) current.kill(sig); else process.exit(0); };
    process.on("SIGINT", () => stop("SIGINT"));
    process.on("SIGTERM", () => stop("SIGTERM"));
  }
  current = p;
}

start();
