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
  try {
    if (process.platform === "darwin") {
      fs.mkdirSync(path.dirname(PLIST), { recursive: true });
      const logFile = path.join(ROOT, "data", "autostart.log");
      const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array>
    <string>${esc(process.execPath)}</string>
    <string>${esc(path.join(ROOT, "scripts", "run.mjs"))}</string>
  </array>
  <key>WorkingDirectory</key><string>${esc(ROOT)}</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>StandardOutPath</key><string>${esc(logFile)}</string>
  <key>StandardErrorPath</key><string>${esc(logFile)}</string>
</dict></plist>
`;
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
    const bat = `@echo off\r\nrem ApoBoostをログイン時に起動する（画面右上の設定から作成されたファイルです）\r\ncd /d "${ROOT}"\r\nstart "ApoBoost" /min cmd /c "npm start"\r\n`;
    fs.writeFileSync(WIN_FILE, bat, "utf8");
    logInfo("autostart", "ログイン時の自動起動をオンにしました（Windows）");
    return { ok: true, message: "パソコンのログイン時に自動で起動します（最小化された黒い画面が1つ出ます。閉じないでください）" };
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    logError("autostart", `自動起動の設定に失敗: ${msg}`);
    return { ok: false, message: `設定に失敗しました: ${msg.slice(0, 160)}` };
  }
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
