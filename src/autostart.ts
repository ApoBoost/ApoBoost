// パソコンのログイン時にApoBoostを自動で起動する。
// 「黒い画面を閉じて止まる」「再起動したあと起動を忘れる」が、問い合わせの中でいちばん多い。
// Mac は launchd（ログイン項目）、Windows は スタートアップフォルダに置くだけ。追加のソフトは使わない。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { logError, logInfo } from "./applog.js";

export const ROOT = path.resolve(process.cwd());
const LABEL = "com.apoboost.start";
const PLIST = path.join(os.homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
const WIN_STARTUP = path.join(os.homedir(), "AppData", "Roaming", "Microsoft", "Windows", "Start Menu", "Programs", "Startup");
const WIN_FILE = path.join(WIN_STARTUP, "ApoBoost.bat");

export function autostartSupported(): boolean {
  return process.platform === "darwin" || process.platform === "win32";
}

/** 自動起動を登録してはいけない起動かどうか（登録しない理由。登録してよければ空文字）。
 *  自動起動の登録はパソコンに1つだけで、ポートもデータの場所も渡さない（既定の 3210 番・data/ で起動する）。
 *  テストや開発の確認（別ポート・一時フォルダのデータ）でうっかり登録すると、そのパソコンの本物の自動起動を書き換えてしまうため、
 *  APOBOOST_NO_AUTOSTART=1 のとき、または PORT / DATA_DIR を既定から変えて起動しているときは、登録も書き直しもしない */
export function autostartBlockedReason(): string {
  if (process.env.APOBOOST_NO_AUTOSTART === "1") return "この起動では自動起動を登録しない設定です（APOBOOST_NO_AUTOSTART=1）";
  if (process.env.PORT && process.env.PORT !== "3210") return `ポートを変えて起動しているため（PORT=${process.env.PORT}）、自動起動は登録しません`;
  if (process.env.DATA_DIR && path.resolve(process.env.DATA_DIR) !== path.join(ROOT, "data")) return "データの場所を変えて起動しているため（DATA_DIR）、自動起動は登録しません";
  return "";
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

export function autostartEnabled(): boolean {
  try {
    if (process.platform === "darwin") return fs.existsSync(PLIST);
    if (process.platform === "win32") return fs.existsSync(WIN_FILE);
  } catch { /* 権限等 */ }
  return false;
}

/** 自動起動の設定ファイルの場所（画面に出して、手で消せるようにしておく） */
export function autostartPath(): string {
  return process.platform === "darwin" ? PLIST : process.platform === "win32" ? WIN_FILE : "";
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function enableAutostart(): { ok: boolean; message: string } {
  if (!autostartSupported()) return { ok: false, message: "このOSでは自動起動に対応していません" };
  const blocked = autostartBlockedReason();
  if (blocked) return { ok: false, message: blocked };
  try {
    if (process.platform === "darwin") {
      fs.mkdirSync(path.dirname(PLIST), { recursive: true });
      const plist = macPlist();
      fs.writeFileSync(PLIST, plist, "utf8");
      // 反映（失敗しても次回のログインで有効になる）
      execFile("launchctl", ["unload", PLIST], () => {
        execFile("launchctl", ["load", "-w", PLIST], () => {});
      });
      logInfo("autostart", "ログイン時の自動起動をオンにしました（Mac）");
      return { ok: true, message: "パソコンのログイン時に自動で起動します。次回からターミナルを開く必要はありません（この画面を http://localhost:3210 で開けます）" };
    }
    // Windows
    fs.mkdirSync(WIN_STARTUP, { recursive: true });
    fs.writeFileSync(WIN_FILE, winBat(), "utf8");
    logInfo("autostart", "ログイン時の自動起動をオンにしました（Windows）");
    return { ok: true, message: "パソコンのログイン時に自動で起動します（最小化された黒い画面が1つ出ます。閉じないでください）" };
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    logError("autostart", `自動起動の設定に失敗: ${msg}`);
    return { ok: false, message: `設定に失敗しました: ${msg.slice(0, 160)}` };
  }
}

/** 起動時: 自動起動の設定が、いまのフォルダ・いまの node と食い違っていたら書き直す（オンにしているPCだけ）。
 *  Windows: 期待する中身と1文字でも違えば書き直す（以前の版のファイルには chcp 65001 や PATH が無く、
 *  日本語のフォルダや、フォルダの中の Node.js だけのPCでは、自動起動が黙って失敗し続けるため）。
 *  Mac: 指している node が無くなっていたら（Node.js を入れ替えた・消した）書き直す。次のログインから効く。
 *  テストや開発の起動（autostartBlockedReason）では、本物の設定に触らない */
export function repairAutostart(): void {
  if (autostartBlockedReason()) return;
  try {
    if (process.platform === "win32") {
      if (fs.existsSync(WIN_FILE) && fs.readFileSync(WIN_FILE, "utf8") !== winBat()) {
        fs.writeFileSync(WIN_FILE, winBat(), "utf8");
        logInfo("autostart", "自動起動のファイルを、いまの版の中身に書き直しました（Windows）");
      }
    } else if (process.platform === "darwin") {
      if (!fs.existsSync(PLIST)) return;
      const node = /<key>ProgramArguments<\/key>\s*<array>\s*<string>([^<]*)<\/string>/.exec(fs.readFileSync(PLIST, "utf8"))?.[1];
      const unesc = (v: string) => v.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
      if (node && !fs.existsSync(unesc(node))) {
        fs.writeFileSync(PLIST, macPlist(), "utf8");
        logInfo("autostart", `自動起動が指していた Node.js（${unesc(node)}）が無くなっていたので、いまの Node.js に書き直しました（Mac）`);
      }
    }
  } catch { /* 読めなくても起動は続ける */ }
}

export function disableAutostart(): { ok: boolean; message: string } {
  try {
    if (process.platform === "darwin") {
      if (fs.existsSync(PLIST)) {
        execFile("launchctl", ["unload", "-w", PLIST], () => {});
        fs.rmSync(PLIST);
      }
    } else if (process.platform === "win32") {
      if (fs.existsSync(WIN_FILE)) fs.rmSync(WIN_FILE);
    }
    logInfo("autostart", "ログイン時の自動起動をオフにしました");
    return { ok: true, message: "自動起動をオフにしました（これまでどおり、手で起動してください）" };
  } catch (e) {
    return { ok: false, message: `解除に失敗しました: ${String((e as Error).message ?? e).slice(0, 160)}` };
  }
}
