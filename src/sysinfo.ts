// パソコンの状態（空きメモリ・電源）を1行で返す。送信が遅くなったときの手がかりとして、送信中に10分ごとに記録する。
// 電池で動いていると、Windows は省電力のためにパソコンを大きく遅くすることがある
import os from "node:os";
import { execFile } from "node:child_process";

const run = (cmd: string, args: string[]): Promise<string> => new Promise((resolve) => {
  execFile(cmd, args, { timeout: 15000, windowsHide: true }, (err, out) => resolve(err ? "" : String(out)));
});

/** 電源の状態。「電源につながっている」「電池 45%」など。分からなければ空 */
export async function powerStatus(): Promise<string> {
  if (process.platform === "win32") {
    const out = (await run("powershell", ["-NoProfile", "-Command", "Get-CimInstance Win32_Battery | ForEach-Object { \"$($_.BatteryStatus) $($_.EstimatedChargeRemaining)\" }"])).trim();
    if (!out) return "電源につながっている（電池なし）";
    const [st, pct] = out.split(/\s+/);
    // BatteryStatus 1 = 放電中（電池で動いている）、2 = 電源につながっている
    return st === "1" ? `電池で動いている ${pct}%` : `電源につながっている（電池 ${pct}%）`;
  }
  if (process.platform === "darwin") {
    const out = await run("pmset", ["-g", "batt"]);
    const pct = /(\d+)%/.exec(out)?.[1];
    if (/AC Power/.test(out)) return `電源につながっている${pct ? `（電池 ${pct}%）` : ""}`;
    if (/Battery Power/.test(out)) return `電池で動いている ${pct ?? "?"}%`;
  }
  return "";
}

/** 「空きメモリ 3.2 / 16.0 GB・電源につながっている」のような1行 */
export async function systemStatus(): Promise<string> {
  const gb = (n: number) => (n / 1024 ** 3).toFixed(1);
  const power = await powerStatus().catch(() => "");
  return [`空きメモリ ${gb(os.freemem())} / ${gb(os.totalmem())} GB`, power].filter(Boolean).join("・");
}
