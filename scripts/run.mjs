// ApoBoostの起動役。アップデート後に自分で再起動できるよう、終了コード75なら立ち上げ直す。
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RESTART = 75;
const WIN = process.platform === "win32";

// いま動いている node のフォルダを PATH の先頭に足す。
// フォルダの中に用意した Node.js（runtime/）で動いているときや、自動起動（launchd・スタートアップ）の下では、
// PATH に npm が無く、アップデート時の npm install（src/update.ts）が「npm が見つからない」で失敗するため。
// 公式の配布物・Homebrew・nvm のどれでも、npm は node と同じフォルダにある
{
  const nodeDir = path.dirname(process.execPath);
  const cur = process.env.PATH ?? "";
  if (cur.split(path.delimiter)[0] !== nodeDir) process.env.PATH = cur ? `${nodeDir}${path.delimiter}${cur}` : nodeDir;
}

// ターミナルのタブ名を「ApoBoost」にする。どのタブでツールが動いているか一目で分かるように。
function setTabTitle(title) {
  if (!process.stdout.isTTY) return;          // ログファイルに書き出す場合は何もしない
  process.stdout.write(`\x1b]1;${title}\x07\x1b]2;${title}\x07`);
}
setTabTitle("ApoBoost");

// Node.js 20 未満では、使っている部品（better-sqlite3・Playwright・メール送受信）が動かず、
// 英語の分かりにくいエラーで止まる。起動の前に日本語で止める（ダブルクリック起動のファイルでも同じ確認をしている）
const NODE_MAJOR = Number(process.versions.node.split(".")[0]);
if (NODE_MAJOR < 20) {
  console.error(`\nNode.js が古いため ApoBoost を起動できません（いま: v${process.versions.node} / 必要: 20 以上）。`);
  console.error("https://nodejs.org/ から「LTS」と書かれた方を入れ直して、もう一度起動してください。\n");
  process.exit(1);
}

/** npm を実行する。Windows の npm は .cmd なので、シェル経由でないと起動できない */
function npmSync(args, opts = {}) {
  return spawnSync(WIN ? "npm.cmd" : "npm", args, { cwd: root, shell: WIN, env: process.env, ...opts });
}

// ---- 部品（better-sqlite3）が、いまの Node.js に合っているか ----
// パソコンの Node.js を入れ替えた・フォルダの中の Node.js に切り替わった、などで版が変わると、
// 部品が「NODE_MODULE_VERSION が違う」という英語のエラーで読み込めず、起動できなくなる。
// そのときだけ、いまの Node.js に合わせて入れ直す（ネットにつながっていないと失敗するが、そのときは今までどおりのエラーになるだけ）
function checkNativeModule() {
  try {
    const r = spawnSync(process.execPath, ["-e", "const D=require('better-sqlite3');new D(':memory:').close()"], { cwd: root, encoding: "utf8", timeout: 30_000 });
    if (r.status === 0 || !/NODE_MODULE_VERSION|different Node\.js version/.test(String(r.stderr ?? ""))) return;
    console.log(`\nNode.js の版（v${process.versions.node}）に合わせて、部品を入れ直しています（1分ほどかかります）…`);
    const fix = npmSync(["rebuild", "better-sqlite3"], { stdio: "inherit" });
    if (fix.status === 0) console.log("→ 入れ直しました\n");
    else console.log("→ 入れ直せませんでした。インターネットにつながっているか確かめて、もう一度起動してください\n");
  } catch { /* 確かめられなくても、起動は今までどおり続ける */ }
}
checkNativeModule();

// ---- フォーム操作用のブラウザ（Playwright の Chromium）----
// 起動を待たせないため、パソコンに Google Chrome / Microsoft Edge があれば、Chromium は裏で入れて先に起動する
// （入れ終わるまでの間は Chrome / Edge で送る。src/engine.ts の browserExecutablePath と同じ考え方）。
// どちらも無いときだけ、入れ終わるのを待ってから起動する（無いまま起動すると、送信のたびに全社失敗するため）。
// アップデートで Playwright の版が上がると必要な Chromium も変わるので、準備の済み・未済みにかかわらず毎回確かめる

/** パソコンに入っている Chrome / Edge。src/engine.ts の browserExecutablePath の候補と同じ並び（変えるときは両方直す） */
function systemBrowser() {
  const home = os.homedir();
  const local = process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local");
  const candidates = process.platform === "darwin"
    ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", path.join(home, "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"), "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"]
    : WIN
      ? ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe", path.join(local, "Google\\Chrome\\Application\\chrome.exe"), "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"]
      : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  return candidates.find((c) => { try { return fs.existsSync(c); } catch { return false; } }) ?? "";
}

/** Playwright の Chromium が最後まで入っているか。展開の途中で止まった場合も「無い」とみなすため、
 *  実行ファイルの有無ではなく、Playwright が入れ終わったときに置く目印（INSTALLATION_COMPLETE）を見る。
 *  見えない画面で送るときは chromium_headless_shell-<番号> の方を使うので、両方そろっているかを見る */
function playwrightChromiumReady() {
  try {
    // Playwright 本体はこの起動役に読み込まない（起動しているあいだずっと、使わない分のメモリを取り続けるため）。場所だけ別の node に聞く
    const r = spawnSync(process.execPath, ["-e", "process.stdout.write(require('playwright').chromium.executablePath())"], { cwd: root, encoding: "utf8", timeout: 30_000 });
    if (r.status !== 0 || !r.stdout) return false;
    let dir = path.dirname(r.stdout.trim());
    while (!/^chromium-\d+$/.test(path.basename(dir))) {
      const up = path.dirname(dir);
      if (up === dir) return false;
      dir = up;
    }
    const shell = path.join(path.dirname(dir), path.basename(dir).replace("chromium-", "chromium_headless_shell-"));
    return fs.existsSync(path.join(dir, "INSTALLATION_COMPLETE")) && fs.existsSync(path.join(shell, "INSTALLATION_COMPLETE"));
  } catch { return false; }
}

function ensureBrowser() {
  if (process.env.CHROMIUM_PATH) return;
  const cli = path.join(root, "node_modules", "playwright", "cli.js");
  if (!fs.existsSync(cli)) return;          // 部品がまだ無い（起動ファイルの準備が終わっていない）。本体の起動側のエラーに任せる
  if (playwrightChromiumReady()) return;
  const sys = systemBrowser();
  if (sys) {
    // 入れ終わるまで（数分）は、パソコンの Chrome / Edge を使ってもらう。
    // 入れている途中の Chromium を本体が見つけて使い、送信が失敗しないよう、この回の起動では Chrome / Edge に決め打ちする
    process.env.FO_FORCE_SYSTEM_CHROME = "1";
    try {
      const log = fs.openSync(path.join(root, "node_modules", ".apoboost-browser.log"), "w");
      const p = spawn(process.execPath, [cli, "install", "chromium"], { cwd: root, env: process.env, detached: true, windowsHide: true, stdio: ["ignore", log, log] });
      p.unref();
      fs.closeSync(log);
      console.log(`フォーム操作用のブラウザを裏で用意しています。終わるまでは ${path.basename(sys).replace(/\.exe$/i, "")} を使って送ります。`);
    } catch { /* 入れられなくても Chrome / Edge で送れる */ }
    return;
  }
  console.log("\nフォーム操作用のブラウザを用意しています（初回は数分かかります。そのままお待ちください）");
  const r = spawnSync(process.execPath, [cli, "install", "chromium"], { cwd: root, env: process.env, stdio: "inherit" });
  if (r.status === 0) console.log("→ 用意できました\n");
  else console.log("→ 用意できませんでした。インターネットにつながっているか確かめてください。Google Chrome を入れると、そちらを使って送れます\n");
}
try { ensureBrowser(); } catch { /* 確かめられなくても起動は続ける（送信時に engine.ts が Chrome / Edge を探す） */ }

let current = null;
function start() {
  // npx tsx 経由だと、終了の合図を受けた tsx が数秒でアプリを強制終了し、送信の途中で切れていた。
  // node に tsx を読み込ませて直接起動し、合図がアプリ本体に届いて「送信中の会社を待ってから終了」できるようにする
  // node の --import は Node.js 20.6 以降。それより古いPCでは従来どおり npx tsx で起動する
  const [maj, min] = process.versions.node.split(".").map(Number);
  const direct = maj > 20 || (maj === 20 && min >= 6);
  const p = direct
    ? spawn(process.execPath, ["--import", "tsx", "src/server.ts"], { cwd: root, stdio: "inherit", env: process.env })
    : spawn(WIN ? "npx.cmd" : "npx", ["tsx", "src/server.ts"], { cwd: root, stdio: "inherit", shell: WIN, env: process.env });
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
