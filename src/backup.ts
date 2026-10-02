// 自動バックアップと復元。
// フォルダを移動・削除してデータが消えた実例があり、これまでは書き出し（閲覧用JSON）しかなく戻せなかった。
// ここでは DB ファイルそのものを data/backups に複製し、画面から復元できるようにする。
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, getDb } from "./db.js";
import { logError, logInfo } from "./applog.js";

export const BACKUP_DIR = path.join(DATA_DIR, "backups");
export const DB_FILE = path.join(DATA_DIR, "form-outreach.db");
/** 復元の予約ファイル。次の起動時、DBを開く前に入れ替える（動いている最中に差し替えると壊れるため） */
export const RESTORE_MARKER = path.join(DATA_DIR, "restore-pending.txt");
const KEEP = 7; // 7世代

export type BackupFile = { file: string; at: string; bytes: number; auto: boolean };

function stamp(): string {
  const t = new Date(Date.now() + 9 * 3600_000).toISOString(); // 東京時間
  return `${t.slice(0, 10)}_${t.slice(11, 13)}${t.slice(14, 16)}`;
}

/** バックアップを1つ作る。SQLiteの正しい手順（backup API）で複製するので、送信中でも安全 */
export async function createBackup(kind: "auto" | "manual" = "auto"): Promise<BackupFile> {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const name = `apoboost-${stamp()}-${kind}.db`;
  const dest = path.join(BACKUP_DIR, name);
  await getDb().backup(dest);
  pruneBackups();
  const st = fs.statSync(dest);
  logInfo("backup", `バックアップを作成: ${name}（${Math.round(st.size / 1024)}KB）`);
  return { file: name, at: new Date(st.mtimeMs).toISOString(), bytes: st.size, auto: kind === "auto" };
}

export function listBackups(): BackupFile[] {
  try {
    return fs.readdirSync(BACKUP_DIR)
      .filter((f) => f.endsWith(".db"))
      .map((f) => {
        const st = fs.statSync(path.join(BACKUP_DIR, f));
        return { file: f, at: new Date(st.mtimeMs).toISOString(), bytes: st.size, auto: /-auto\.db$/.test(f) };
      })
      .sort((a, b) => b.at.localeCompare(a.at));
  } catch {
    return [];
  }
}

/** 自動ぶんは7世代まで。手動で取ったものは消さない（利用者が意図して残したもの） */
export function pruneBackups(keep = KEEP) {
  const autos = listBackups().filter((b) => b.auto);
  for (const b of autos.slice(keep)) {
    try { fs.rmSync(path.join(BACKUP_DIR, b.file)); } catch { /* 消せなくても害はない */ }
  }
}

/** 1日1回まで。前回から24時間たっていなければ何もしない */
export async function autoBackupIfDue(): Promise<BackupFile | null> {
  try {
    const last = listBackups().find((b) => b.auto);
    if (last && Date.now() - Date.parse(last.at) < 24 * 3600_000) return null;
    return await createBackup("auto");
  } catch (e) {
    logError("backup", `自動バックアップに失敗: ${String((e as Error).message ?? e)}`);
    return null;
  }
}

/** 復元を予約する（実際の入れ替えは次の起動時）。ファイル名は data/backups の中のものだけ受け付ける */
export function requestRestore(file: string): { ok: boolean; error?: string } {
  const safe = path.basename(file);
  const src = path.join(BACKUP_DIR, safe);
  if (!safe.endsWith(".db") || !fs.existsSync(src)) return { ok: false, error: "バックアップファイルが見つかりません" };
  fs.writeFileSync(RESTORE_MARKER, safe, "utf8");
  return { ok: true };
}

export function pendingRestore(): string {
  try { return fs.existsSync(RESTORE_MARKER) ? fs.readFileSync(RESTORE_MARKER, "utf8").trim() : ""; } catch { return ""; }
}
export function cancelRestore() {
  try { fs.rmSync(RESTORE_MARKER); } catch { /* 無ければ何もしない */ }
}

// 実際の入れ替えは db.ts（DBを開く前）で行う。ここでは予約だけを扱う。

/** 画面に出す見出し（東京時間） */
export function backupLabel(b: BackupFile): string {
  const t = new Date(Date.parse(b.at) + 9 * 3600_000).toISOString();
  return `${t.slice(0, 10)} ${t.slice(11, 16)}（${Math.round(b.bytes / 1024).toLocaleString("ja-JP")}KB・${b.auto ? "自動" : "手動"}）`;
}
