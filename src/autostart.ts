// パソコンのログイン時にApoBoostを自動で起動する。
// 「黒い画面を閉じて止まる」「再起動したあと起動を忘れる」が、問い合わせの中でいちばん多い。
// Mac は launchd（ログイン項目）、Windows は スタートアップフォルダに置くだけ。追加のソフトは使わない。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile, execFileSync } from "node:child_process";
import { logError, logInfo } from "./applog.js";

export const ROOT = path.resolve(process.cwd());
const LABEL = "com.apoboost.start";
const WIN_STARTUP = path.join(os.homedir(), "AppData", "Roaming", "Microsoft", "Windows", "Start Menu", "Programs", "Startup");

/** 自動起動の登録ファイルの場所。
 *  APOBOOST_AUTOSTART_FILE で差し替えられる（単体テストで、このパソコンの本物の登録に触らずに試すため）。
 *  差し替えているときは launchctl も呼ばない */
export function autostartFile(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): string {
  const o = env.APOBOOST_AUTOSTART_FILE?.trim();
  if (o) return path.resolve(o);
  if (platform === "darwin") return path.join(os.homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
  if (platform === "win32") return path.join(WIN_STARTUP, "ApoBoost.bat");
  return "";
}
const overridden = (env: NodeJS.ProcessEnv = process.env) => Boolean(env.APOBOOST_AUTOSTART_FILE?.trim());

export function autostartSupported(): boolean {
  return process.platform === "darwin" || process.platform === "win32";
}

/** 本物の登録に一切触ってはいけない起動（テスト・確認用のサーバー）。理由を返す。触ってよければ空文字 */
export function autostartHardBlock(env: NodeJS.ProcessEnv = process.env): string {
  return env.APOBOOST_NO_AUTOSTART === "1" ? "この起動では自動起動を変更しない設定です（APOBOOST_NO_AUTOSTART=1）" : "";
}

/** 既定（3210番・data/）とは別の ApoBoost として起動しているか。理由を返す。既定どおりなら空文字。
 *  自動起動の登録はパソコンに1つだけで、ポートもデータの場所も渡さない（既定の 3210 番・data/ で起動する）ため、
 *  この起動の登録ではない */
export function autostartOtherInstance(env: NodeJS.ProcessEnv = process.env, root = ROOT): string {
  if (env.PORT && env.PORT !== "3210") return `ポートを変えて起動しているため（PORT=${env.PORT}）`;
  if (env.DATA_DIR && path.resolve(env.DATA_DIR) !== path.join(root, "data")) return "データの場所を変えて起動しているため（DATA_DIR）";
  return "";
}

/** 自動起動を登録してはいけない起動かどうか（登録しない理由。登録してよければ空文字）。
 *  テストや開発の確認（別ポート・一時フォルダのデータ）でうっかり登録すると、そのパソコンの本物の自動起動を書き換えてしまうため、
 *  APOBOOST_NO_AUTOSTART=1 のとき、または PORT / DATA_DIR を既定から変えて起動しているときは、登録も書き直しもしない */
export function autostartBlockedReason(env: NodeJS.ProcessEnv = process.env): string {
  const hard = autostartHardBlock(env);
  if (hard) return hard;
  const other = autostartOtherInstance(env);
  return other ? `${other}、自動起動は登録しません` : "";
}

/** この起動が、自動起動（launchd）から立ち上がったものか。launchd は自分が起動したものに XPC_SERVICE_NAME=ラベル を渡す */
function underLaunchd(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.XPC_SERVICE_NAME === LABEL;
}

/** launchctl を同期で呼ぶ。失敗したら null（登録されていない・launchctl が無いなど） */
function realLaunchctl(args: string[]): string | null {
  try { return execFileSync("launchctl", args, { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] }); } catch { return null; }
}

/** launchd に読み込まれている自動起動が、いま ApoBoost を動かしているか（launchctl list の結果に PID がある） */
function launchdJobRunning(ctl: (args: string[]) => string | null): boolean {
  const out = ctl(["list", LABEL]);
  return out !== null && /"PID"\s*=\s*\d+/.test(out);
}

/** 自動起動で使う PATH。動いている node のフォルダを先頭に置く。
 *  フォルダの中に用意した Node.js（runtime/）で動いているときは、ほかに npm が無く、アップデートの npm install が失敗するため */
function nodeDir(): string {
  return path.dirname(process.execPath);
}

function macPlist(): string {
  const logFile = path.join(ROOT, "data", "autostart.log");
  const pathEnv = [nodeDir(), "/usr/local/bin", "/opt/homebrew/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(":");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array>
    <string>${esc(process.execPath)}</string>
    <string>${esc(path.join(ROOT, "scripts", "run.mjs"))}</string>
  </array>
  <key>WorkingDirectory</key><string>${esc(ROOT)}</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${esc(pathEnv)}</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>StandardOutPath</key><string>${esc(logFile)}</string>
  <key>StandardErrorPath</key><string>${esc(logFile)}</string>
</dict></plist>
`;
}

/** Windows のスタートアップに置く bat の中身。
 *  chcp 65001 を先に置く: このファイルは UTF-8 で書くが、cmd は既定で Shift_JIS として読むため、
 *  フォルダ名に日本語があると cd に失敗して起動しなかった（ApoBoost起動.bat と同じ対策）。
 *  PATH に node のフォルダを足す: フォルダの中に用意した Node.js（runtime\）しか無いPCでは、npm が見つからず起動しないため */
function winBat(): string {
  return `@echo off\r\nchcp 65001 >nul\r\nrem ApoBoostをログイン時に起動する（ApoBoost の画面から作成されたファイルです）\r\ncd /d "${ROOT}"\r\nset "PATH=${nodeDir()};%PATH%"\r\nstart "ApoBoost" /min cmd /c "npm start"\r\n`;
}

/** 登録ファイルの「あるべき中身」（いまのフォルダ・いまの node で書いたもの） */
export function autostartContent(platform: NodeJS.Platform = process.platform): string {
  return platform === "darwin" ? macPlist() : platform === "win32" ? winBat() : "";
}

export function autostartEnabled(): boolean {
  try {
    const f = autostartFile();
    return Boolean(f) && fs.existsSync(f);
  } catch { /* 権限等 */ }
  return false;
}

/** 自動起動の設定ファイルの場所（画面に出して、手で消せるようにしておく） */
export function autostartPath(): string {
  return autostartFile();
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function enableAutostart(): { ok: boolean; message: string } {
  if (!autostartSupported()) return { ok: false, message: "このOSでは自動起動に対応していません" };
  const blocked = autostartBlockedReason();
  if (blocked) return { ok: false, message: blocked };
  const file = autostartFile();
  try {
    if (process.platform === "darwin") {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, macPlist(), "utf8");
      // 反映（失敗しても次回のログインで有効になる）。
      // 自動起動（launchd）から動いているとき・launchd の方で ApoBoost が動いているときは、unload が動いている ApoBoost を止めてしまうので何もしない
      if (!overridden() && !underLaunchd() && !launchdJobRunning(realLaunchctl)) {
        execFile("launchctl", ["unload", file], () => {
          execFile("launchctl", ["load", "-w", file], () => {});
        });
      }
      logInfo("autostart", "ログイン時の自動起動をオンにしました（Mac）");
      return { ok: true, message: "パソコンのログイン時に自動で起動します。次回からターミナルを開く必要はありません（この画面を http://localhost:3210 で開けます）" };
    }
    // Windows
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, winBat(), "utf8");
    logInfo("autostart", "ログイン時の自動起動をオンにしました（Windows）");
    return { ok: true, message: "パソコンのログイン時に自動で起動します（最小化された黒い画面が1つ出ます。閉じないでください）" };
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    logError("autostart", `自動起動の設定に失敗: ${msg}`);
    return { ok: false, message: `設定に失敗しました: ${msg.slice(0, 160)}` };
  }
}

/** 起動時: 自動起動の設定が、いまのフォルダ・いまの node と食い違っていたら書き直す（オンにしているPCだけ）。
 *  期待する中身と1文字でも違えば書き直す。
 *  Windows: 以前の版のファイルには chcp 65001 や PATH が無く、日本語のフォルダや、フォルダの中の Node.js だけのPCでは、自動起動が黙って失敗し続けるため。
 *  Mac: フォルダの中の Node.js（runtime/）を新しい版に入れ替えたあとも、古い node を指したままになるため。次のログインから効く。
 *  テストや開発の起動（autostartBlockedReason）では、本物の設定に触らない */
export function repairAutostart(opts: { platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv; file?: string } = {}): boolean {
  const env = opts.env ?? process.env;
  if (autostartBlockedReason(env)) return false;
  const platform = opts.platform ?? process.platform;
  try {
    const file = opts.file ?? autostartFile(platform, env);
    if (!file || !fs.existsSync(file)) return false;
    const want = autostartContent(platform);
    if (!want || fs.readFileSync(file, "utf8") === want) return false;
    fs.writeFileSync(file, want, "utf8");
    logInfo("autostart", `自動起動のファイルを、いまのフォルダ・いまの Node.js（${process.execPath}）に合わせて書き直しました（次のログインから効きます）`);
    return true;
  } catch { /* 読めなくても起動は続ける */ }
  return false;
}

export type DisableResult = { ok: boolean; message: string; needConfirm?: boolean };

/** 自動起動を解除する。
 *  - APOBOOST_NO_AUTOSTART=1 の起動（テスト・確認用）からは、常に断る
 *  - PORT / DATA_DIR を既定から変えた起動（開発の確認など）からは、登録が別の ApoBoost（既定の 3210番・data/）のものなので、
 *    confirmed で2回目の確認が来るまで消さない
 *  - 解除は登録ファイルを消すだけ（次のログインから効く）。Mac の launchctl unload は非同期で、
 *    しかも launchd から動いている ApoBoost を止めてしまうため、自分が launchd の下で動いておらず、launchd の方でも
 *    ApoBoost が動いていないときだけ、読み込みを外す（ファイルを消したあとでも、ラベルで外せる remove を使う）
 *  file / runLaunchctl / env / platform は、単体テストで本物の登録に触らずに試すための差し替え口 */
export function disableAutostart(opts: { confirmed?: boolean; platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv; file?: string; runLaunchctl?: (args: string[]) => string | null } = {}): DisableResult {
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;
  const hard = autostartHardBlock(env);
  if (hard) return { ok: false, message: `${hard}。解除はしていません` };
  const file = opts.file ?? autostartFile(platform, env);
  if (!file) return { ok: false, message: "このOSでは自動起動に対応していません" };
  try {
    if (!fs.existsSync(file)) return { ok: true, message: "自動起動はもともとオフです" };
    if (autostartOtherInstance(env) && !opts.confirmed) {
      return { ok: false, needConfirm: true, message: "この登録は既定の 3210番・data/ で起動する ApoBoost のものです。それでも解除しますか" };
    }
    fs.rmSync(file);
    const ctl = opts.runLaunchctl ?? (opts.file || overridden(env) ? null : realLaunchctl);
    if (platform === "darwin" && ctl && !underLaunchd(env)) {
      const listed = ctl(["list", LABEL]); // null = 読み込まれていない（外すものが無い）
      if (listed !== null && !/"PID"\s*=\s*\d+/.test(listed)) ctl(["remove", LABEL]);
    }
    logInfo("autostart", "ログイン時の自動起動をオフにしました");
    return { ok: true, message: "自動起動をオフにしました。次にパソコンにログインしたときから、自動では立ち上がりません（いま動いている ApoBoost はそのまま動きます）" };
  } catch (e) {
    return { ok: false, message: `解除に失敗しました: ${String((e as Error).message ?? e).slice(0, 160)}` };
  }
}
