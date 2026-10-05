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

// 裏でブラウザを用意している子の PID と始めた時刻。src/update.ts（browserInstallBusy）がこれを見て、
// 用意の途中にアップデートの npm install を重ねない（Windows では、使用中の node_modules/playwright を入れ替えられず失敗し得るため）
const BROWSER_PID = path.join(root, "node_modules", ".apoboost-browser.pid");
const BROWSER_PID_STALE_MS = 45 * 60_000; // これより古い記録は、PID が別のプロセスに使い回されている恐れがあるので無視する（update.ts と同じ値）

/** 裏でブラウザを用意している途中か（src/update.ts の browserInstallBusy と同じ判定。変えるときは両方直す） */
function browserInstallBusy() {
  try {
    const { pid, at } = JSON.parse(fs.readFileSync(BROWSER_PID, "utf8"));
    if (!Number.isInteger(pid) || pid <= 0 || !(Date.now() - Number(at) < BROWSER_PID_STALE_MS)) return false;
    try { process.kill(pid, 0); return true; } catch (e) { return e?.code === "EPERM"; }
  } catch { return false; }
}

/** 同期で待つ（起動役は起動の前に順番に確かめるだけなので、イベントループを止めてよい） */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
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
  // 前の起動（アップデート前など）が裏で用意している途中なら、2つ目は始めない
  if (browserInstallBusy()) {
    if (sys) {
      process.env.FO_FORCE_SYSTEM_CHROME = "1";
      console.log(`フォーム操作用のブラウザを裏で用意している途中です。終わるまでは ${path.basename(sys).replace(/\.exe$/i, "")} を使って送ります。`);
      return;
    }
    console.log("\nフォーム操作用のブラウザを用意している途中です。終わるのを待っています（最大15分）");
    const until = Date.now() + 15 * 60_000;
    while (browserInstallBusy() && Date.now() < until) sleepSync(2000);
    if (playwrightChromiumReady()) { console.log("→ 用意できました\n"); return; }
  }
  if (sys) {
    // 入れ終わるまで（数分）は、パソコンの Chrome / Edge を使ってもらう。
    // 入れている途中の Chromium を本体が見つけて使い、送信が失敗しないよう、この回の起動では Chrome / Edge に決め打ちする
    process.env.FO_FORCE_SYSTEM_CHROME = "1";
    try {
      const log = fs.openSync(path.join(root, "node_modules", ".apoboost-browser.log"), "w");
      const p = spawn(process.execPath, [cli, "install", "chromium"], { cwd: root, env: process.env, detached: true, windowsHide: true, stdio: ["ignore", log, log] });
      p.unref();
      fs.closeSync(log);
      if (p.pid) {
        const mine = JSON.stringify({ pid: p.pid, at: Date.now() });
        try { fs.writeFileSync(BROWSER_PID, mine); } catch { /* 書けなくても用意は続く（アップデートが待たないだけ） */ }
        // 終わったら記録を消す（この起動役が先に終わった場合は、update.ts が PID の生死と時刻で判断する）
        p.on("exit", () => { try { if (fs.readFileSync(BROWSER_PID, "utf8") === mine) fs.rmSync(BROWSER_PID); } catch { /* 消せなくても害は無い */ } });
      }
      console.log(`フォーム操作用のブラウザを裏で用意しています。終わるまでは ${path.basename(sys).replace(/\.exe$/i, "")} を使って送ります。`);
    } catch { /* 入れられなくても Chrome / Edge で送れる */ }
    return;
  }
  console.log("\nフォーム操作用のブラウザを用意しています（初回は数分かかります。そのままお待ちください）");
  const r = spawnSync(process.execPath, [cli, "install", "chromium"], { cwd: root, env: process.env, stdio: "inherit" });
  if (r.status === 0) console.log("→ 用意できました\n");
  else console.log("→ 用意できませんでした。インターネットにつながっているか確かめてください。Google Chrome を入れると、そちらを使って送れます\n");
}

/** 本体を起動する前の確認（部品が今の Node.js に合っているか・ブラウザが用意できているか）。
 *  どれが失敗しても起動は続ける（今までどおりの動きに戻るだけ） */
function prepare() {
  try { checkNativeModule(); } catch { /* 確かめられなくても起動は続ける */ }
  try { ensureBrowser(); } catch { /* 確かめられなくても起動は続ける（送信時に engine.ts が Chrome / Edge を探す） */ }
}
prepare();

let current = null;
function start() {
  // npx tsx 経由だと、終了の合図を受けた tsx が数秒でアプリを強制終了し、送信の途中で切れていた。
  // node に tsx を読み込ませて直接起動し、合図がアプリ本体に届いて「送信中の会社を待ってから終了」できるようにする
  // node の --import は Node.js 20.6 以降。それより古いPCでは従来どおり npx tsx で起動する
  const [maj, min] = process.versions.node.split(".").map(Number);
  const direct = maj > 20 || (maj === 20 && min >= 6);
  // 配布版（src が無く、固めた app/server.mjs だけがある）は、そのまま node で動かす。開発フォルダは src から動かす
  const bundled = !fs.existsSync(path.join(root, "src", "server.ts")) && fs.existsSync(path.join(root, "app", "server.mjs"));
  const p = bundled
    ? spawn(process.execPath, ["app/server.mjs"], { cwd: root, stdio: "inherit", env: process.env })
    : direct
    ? spawn(process.execPath, ["--import", "tsx", "src/server.ts"], { cwd: root, stdio: "inherit", env: process.env })
    : spawn(WIN ? "npx.cmd" : "npx", ["tsx", "src/server.ts"], { cwd: root, stdio: "inherit", shell: WIN, env: process.env });
  p.on("close", (code) => {
    if (code === RESTART) {
      console.log("\n--- アップデートを適用して再起動します ---\n");
      // アップデートで Playwright や better-sqlite3 の版が上がると、必要な Chromium・部品も変わる。最初の起動と同じ確認をやり直す。
      // 前の回で「Chrome / Edge に決め打ち」にしていても、Chromium が入り終わっていれば使えるように、いったん外してから確かめる
      // （外したままでよいかは ensureBrowser が決め直す）。
      // ※ アップデート直後に動いているのは、更新前の版のこのファイル（読み込み済みのもの）。ここの変更が効くのは、この版が動いている状態からの次の更新から
      delete process.env.FO_FORCE_SYSTEM_CHROME;
      prepare();
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
