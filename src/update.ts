// 配布後のアップデート。GitHub に置いた release.json を見て、新しければ本体ファイルだけ入れ替える。
// data/（リスト・送信履歴・アカウント）には一切触らない。
import fs from "node:fs";
import { S } from "./settings.js";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import AdmZip from "adm-zip";
import { getSetting } from "./db.js";

export const ROOT = path.resolve(process.cwd());

/** 更新で入れ替えてよいもの。data/ と node_modules/ は対象外 */
const UPDATABLE = ["src", "test", "package.json", "package-lock.json", "tsconfig.json", "README.md", "scripts", "update.json",
  // ダブルクリックで起動するファイル（配布済みのPCにも届くように更新対象に入れる）
  "ApoBoost起動.command", "ApoBoost起動.bat", "インストール（最初に1回）.bat", "ApoBoost.app",
  // ロゴ・通知の絵など。ゲームの素材もここに入っている
  "assets"];

export type Release = { version: string; notes?: string; zip?: string; published_at?: string };
// 更新チャネル（#94）。配布先ごとに「安定版」「先行版」を選べるようにする。
// release.json は { version, ..., channels: { stable: {...}, beta: {...} } } の形。
// channels が無い古い release.json でも、これまでどおり最上位の値を使う
export type Manifest = Release & { channels?: Partial<Record<"stable" | "beta", Release>> };
export type UpdateStatus = {
  current: string;
  latest?: string;
  notes?: string;
  available: boolean;
  configured: boolean;
  checkedAt?: string;
  error?: string;
};

/** いまの更新チャネル。設定画面で切り替える（既定は安定版） */
export function updateChannel(): "stable" | "beta" {
  try {
    return getSetting(S.updateChannel, "stable") === "beta" ? "beta" : "stable";
  } catch { return "stable"; } // DBがまだ無いタイミング
}

/** マニフェストから、いまのチャネルの配布物を取り出す */
export function pickRelease(m: Manifest, channel: "stable" | "beta" = updateChannel()): Release {
  const c = m.channels?.[channel];
  if (c?.version) return c;
  // 先行版が未公開なら安定版にフォールバック
  const stable = m.channels?.stable;
  return stable?.version ? stable : m;
}

function readJson<T>(file: string): T | null {
  try { return JSON.parse(fs.readFileSync(file, "utf8")) as T; } catch { return null; }
}

export function currentVersion(): string {
  return readJson<{ version?: string }>(path.join(ROOT, "package.json"))?.version ?? "0.0.0";
}

export function manifestUrl(): string {
  const fromEnv = process.env.UPDATE_URL?.trim();
  if (fromEnv) return fromEnv;
  const cfg = readJson<{ manifest_url?: string }>(path.join(ROOT, "update.json"));
  const u = cfg?.manifest_url?.trim() ?? "";
  return u.includes("CHANGE-ME") ? "" : u;
}

/** "0.2.10" > "0.2.9" を正しく判定する */
export function isNewer(latest: string, current: string): boolean {
  const a = latest.split(".").map((n) => parseInt(n, 10) || 0);
  const b = current.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

let cached: (UpdateStatus & { channel?: string }) | null = null;

export async function checkUpdate(force = false): Promise<UpdateStatus> {
  const current = currentVersion();
  const url = manifestUrl();
  if (!url) return { current, available: false, configured: false };
  if (!force && cached && cached.channel === updateChannel() && cached.checkedAt && Date.now() - Date.parse(cached.checkedAt) < 60 * 60 * 1000) return cached;
  try {
    const res = await fetch(url, { headers: { "cache-control": "no-cache" }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rel = pickRelease((await res.json()) as Manifest);
    cached = {
      current,
      latest: rel.version,
      notes: rel.notes,
      available: isNewer(rel.version, current),
      configured: true,
      checkedAt: new Date().toISOString(),
      channel: updateChannel(),
    };
    return cached;
  } catch (e) {
    const raw = String((e as Error).message ?? e);
    const msg = /HTTP 404/.test(raw)
      ? "更新情報がまだ公開されていません（配布元が公開すると、ここに新しい版が出ます）"
      : `更新の確認に失敗しました: ${raw.slice(0, 120)}`;
    return { current, available: false, configured: true, checkedAt: new Date().toISOString(), error: msg };
  }
}

/** zip の中から、実体（package.json のあるフォルダ）を探す。GitHubのzipは1階層深い */
function findAppRoot(dir: string): string | null {
  if (fs.existsSync(path.join(dir, "package.json")) && fs.existsSync(path.join(dir, "src"))) return dir;
  for (const name of fs.readdirSync(dir)) {
    const sub = path.join(dir, name);
    if (fs.statSync(sub).isDirectory() && fs.existsSync(path.join(sub, "package.json")) && fs.existsSync(path.join(sub, "src"))) return sub;
  }
  return null;
}

function copyDir(from: string, to: string) {
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) {
    const s = path.join(from, name), d = path.join(to, name);
    if (fs.statSync(s).isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function run(cmd: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, shell: process.platform === "win32" });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(out.slice(-500) || `exit ${code}`))));
  });
}

export type ApplyResult = { ok: boolean; log: string[]; version?: string; error?: string };

/** 起動役（scripts/run.mjs）が裏でフォーム操作用のブラウザ（Chromium）を用意している途中か。
 *  その最中に npm install が node_modules/playwright を入れ替えると、Windows ではファイルを掴まれていて失敗し得る。
 *  run.mjs が node_modules/.apoboost-browser.pid に書いた PID が生きているかで見る（run.mjs の browserInstallBusy と同じ判定。変えるときは両方直す）。
 *  45分より古い記録は、PID が別のプロセスに使い回されている恐れがあるので無視する */
export function browserInstallBusy(root = ROOT): boolean {
  try {
    const { pid, at } = JSON.parse(fs.readFileSync(path.join(root, "node_modules", ".apoboost-browser.pid"), "utf8")) as { pid?: unknown; at?: unknown };
    if (!Number.isInteger(pid) || (pid as number) <= 0 || !(Date.now() - Number(at) < 45 * 60_000)) return false;
    try { process.kill(pid as number, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; }
  } catch { return false; }
}

/** 新しい版をダウンロードして入れ替える。失敗したら backup から戻す */
export async function applyUpdate(): Promise<ApplyResult> {
  const log: string[] = [];
  const url = manifestUrl();
  if (!url) return { ok: false, log, error: "更新先が設定されていません（update.json の manifest_url）" };
  // 裏のブラウザの用意と npm install を重ねない。数分なら待ち、それでも終わらなければ何も変えずに断る
  if (browserInstallBusy()) {
    log.push("フォーム操作用のブラウザの用意が終わるのを待っています（最大3分）");
    const until = Date.now() + 3 * 60_000;
    while (browserInstallBusy() && Date.now() < until) await new Promise((r) => setTimeout(r, 3000));
    if (browserInstallBusy()) return { ok: false, log, error: "フォーム操作用のブラウザを裏で用意しているところです。用意が終わってから（数分後に）もう一度お試しください" };
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "apoboost-"));
  const backup = path.join(tmp, "backup");
  try {
    const m = pickRelease((await (await fetch(url, { signal: AbortSignal.timeout(15000) })).json()) as Manifest);
    if (!isNewer(m.version, currentVersion())) return { ok: false, log, error: "すでに最新です" };
    const zipUrl = m.zip;
    if (!zipUrl) throw new Error("release.json に zip のURLがありません");
    log.push(`v${currentVersion()} → v${m.version} をダウンロード中`);

    const res = await fetch(zipUrl, { redirect: "follow", signal: AbortSignal.timeout(120000) });
    if (!res.ok) throw new Error(`ダウンロード失敗 HTTP ${res.status}`);
    const zipPath = path.join(tmp, "new.zip");
    fs.writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));

    const extracted = path.join(tmp, "x");
    new AdmZip(zipPath).extractAllTo(extracted, true);
    const appRoot = findAppRoot(extracted);
    if (!appRoot) throw new Error("ダウンロードした中身が想定と違います（package.json / src が見つかりません）");
    log.push("ダウンロード完了");

    // 今のファイルを退避してから入れ替える
    fs.mkdirSync(backup, { recursive: true });
    for (const name of UPDATABLE) {
      const cur = path.join(ROOT, name);
      const next = path.join(appRoot, name);
      if (!fs.existsSync(next)) continue;
      // 更新先の設定は、配布元が正しいURLを入れている場合だけ差し替える。
      // 空や CHANGE-ME で上書きすると、以後どの端末も更新できなくなるため。
      if (name === "update.json") {
        const incoming = readJson<{ manifest_url?: string }>(next)?.manifest_url ?? "";
        if (!incoming || incoming.includes("CHANGE-ME")) { log.push("スキップ: update.json（更新先の設定は現状を維持）"); continue; }
      }
      if (fs.existsSync(cur)) {
        if (fs.statSync(cur).isDirectory()) copyDir(cur, path.join(backup, name));
        else fs.copyFileSync(cur, path.join(backup, name));
        fs.rmSync(cur, { recursive: true, force: true });
      }
      if (fs.statSync(next).isDirectory()) {
        copyDir(next, cur);
        // Mac のアプリ（.app）は中の実行ファイルに実行権限が要る
        if (name.endsWith(".app")) { try { fs.chmodSync(path.join(cur, "Contents", "MacOS", "apoboost"), 0o755); } catch { /* 無い場合は何もしない */ } }
      }
      else {
        fs.copyFileSync(next, cur);
        // Mac のダブルクリック起動ファイルは実行できる必要がある（zip経由で権限が落ちることがある）
        if (name.endsWith(".command")) { try { fs.chmodSync(cur, 0o755); } catch { /* 権限を変えられなくても起動方法は他にもある */ } }
      }
      log.push(`更新: ${name}`);
    }

    log.push("依存パッケージを確認中（数十秒かかることがあります）");
    await run(process.platform === "win32" ? "npm.cmd" : "npm", ["install", "--no-audit", "--no-fund"], ROOT);
    log.push("完了");
    return { ok: true, log, version: m.version };
  } catch (e) {
    // 失敗したら退避したファイルを書き戻す
    if (fs.existsSync(backup)) {
      for (const name of fs.readdirSync(backup)) {
        const cur = path.join(ROOT, name), b = path.join(backup, name);
        fs.rmSync(cur, { recursive: true, force: true });
        if (fs.statSync(b).isDirectory()) copyDir(b, cur);
        else fs.copyFileSync(b, cur);
      }
      log.push("失敗したため、元のバージョンに戻しました");
    }
    return { ok: false, log, error: String((e as Error).message ?? e).slice(0, 300) };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** 再起動を要求する（npm start の監視スクリプトが拾って起動し直す） */
export const RESTART_EXIT_CODE = 75;
export function requestRestart() {
  setTimeout(() => process.exit(RESTART_EXIT_CODE), 500);
}
