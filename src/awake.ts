// 送信中だけパソコンをスリープさせない。
// 送信はこのPCの中で動くため、スリープすると止まる（実例多数: 朝見たら止まっていた・夜間に送れない）。
// 追加のソフトは入れず、OS標準の仕組みだけを使う。失敗しても送信は続ける（best-effort）。
import { spawn, type ChildProcess } from "node:child_process";

let proc: ChildProcess | null = null;
let holders = 0;

/** いまスリープ抑止が効いているか（画面表示用） */
export function awakeActive(): boolean {
  return proc !== null && proc.exitCode === null;
}

/** この環境でスリープ抑止ができるか（Linux等は非対応） */
export function awakeSupported(): boolean {
  return process.platform === "darwin" || process.platform === "win32";
}

function startHolder() {
  if (proc || !awakeSupported()) return;
  try {
    if (process.platform === "darwin") {
      // -i 自動スリープ禁止 / -m ディスクのスリープ禁止 / -s 本体のスリープ禁止（電源接続時）
      proc = spawn("caffeinate", ["-i", "-m", "-s"], { stdio: "ignore" });
    } else {
      // Windows: SetThreadExecutionState で「システムは起きていてほしい」と宣言し続ける。
      // この PowerShell が動いている間だけ有効なので、送信が終わったら終了させる
      const ps = [
        "$ErrorActionPreference='SilentlyContinue'",
        "$sig='[DllImport(\"kernel32.dll\")] public static extern uint SetThreadExecutionState(uint esFlags);'",
        "$t=Add-Type -MemberDefinition $sig -Name ApoBoostPower -Namespace Win32 -PassThru",
        // ES_CONTINUOUS(0x80000000) | ES_SYSTEM_REQUIRED(0x1) | ES_AWAYMODE_REQUIRED(0x40)
        "$null=$t::SetThreadExecutionState(0x80000041)",
        "while($true){ Start-Sleep -Seconds 30; $null=$t::SetThreadExecutionState(0x80000041) }",
      ].join("; ");
      proc = spawn("powershell", ["-NoProfile", "-WindowStyle", "Hidden", "-Command", ps], { stdio: "ignore" });
    }
    proc.on("exit", () => { proc = null; });
    proc.on("error", () => { proc = null; });
    proc.unref?.();
  } catch {
    proc = null;
  }
}

function stopHolder() {
  try { proc?.kill(); } catch { /* すでに終わっている */ }
  proc = null;
}

/** 送信を始めるときに呼ぶ。返ってきた関数を、送信が終わったときに必ず呼ぶ（入れ子にできる） */
export function keepAwake(): () => void {
  holders++;
  startHolder();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holders = Math.max(0, holders - 1);
    if (holders === 0) stopHolder();
  };
}

/** アプリ終了時の後片付け */
export function releaseAwakeAll() {
  holders = 0;
  stopHolder();
}

/** 画面に出す注意書き（Macでふたを閉じた場合は抑止できない） */
export const AWAKE_NOTE =
  process.platform === "darwin"
    ? "送信中は自動スリープを抑えます（caffeinate）。ただしMacのふたを閉じると止まります。夜間に送る場合は電源につないで、ふたは開けたままにしてください。"
    : process.platform === "win32"
      ? "送信中は自動スリープを抑えます。ノートPCでふたを閉じると止まる設定の場合は、Windowsの電源オプションで「ふたを閉じたときの動作＝何もしない」にしてください。"
      : "このOSではスリープ抑止に対応していません。電源設定でスリープしないようにしてください。";
