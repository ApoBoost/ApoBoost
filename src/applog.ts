// 画面で見られるエラーログ。
// これまでは黒い画面（ターミナル）を見るしかなく、閉じてしまうと何が起きたか分からなかった。
// 他社に配ると「動かない」の原因を聞き出すだけで何往復もするため、直近の出来事をDBに残して画面に出す。
import { getDb } from "./db.js";

export type LogKind = "error" | "warn" | "info";
export type AppLog = { id: number; at: string; kind: LogKind; source: string; company: string; text: string };

const KEEP = 500; // 直近500件だけ残す（古いものは自動で消す。DBを太らせない）

/** 直前に書いた内容。同じエラーが毎秒出るような場合に同じ行を量産しない */
const lastKey = new Map<string, number>();

export function logEvent(kind: LogKind, source: string, text: string, company = ""): void {
  const body = String(text ?? "").replace(/\s+/g, " ").trim().slice(0, 600);
  if (!body) return;
  const key = `${kind}:${source}:${body.slice(0, 120)}`;
  const now = Date.now();
  if (now - (lastKey.get(key) ?? 0) < 10_000) return; // 10秒以内の同じ内容はまとめる
  lastKey.set(key, now);
  try {
    const db = getDb();
    db.prepare("INSERT INTO app_logs(kind, source, company, text) VALUES(?,?,?,?)").run(kind, source.slice(0, 40), String(company ?? "").slice(0, 80), body);
    // 件数が増えたときだけ間引く（毎回 DELETE を流さない）
    if (Math.random() < 0.1) {
      db.prepare("DELETE FROM app_logs WHERE id <= (SELECT MAX(id) - ? FROM app_logs)").run(KEEP);
    }
  } catch {
    /* ログが書けなくても本来の処理は止めない */
  }
}

export const logError = (source: string, text: string, company = "") => logEvent("error", source, text, company);
export const logWarn = (source: string, text: string, company = "") => logEvent("warn", source, text, company);
export const logInfo = (source: string, text: string, company = "") => logEvent("info", source, text, company);

export function recentLogs(limit = 100, kind = ""): AppLog[] {
  try {
    const where = kind ? "WHERE kind=?" : "";
    const args = kind ? [kind, limit] : [limit];
    return getDb().prepare(`SELECT * FROM app_logs ${where} ORDER BY id DESC LIMIT ?`).all(...args) as AppLog[];
  } catch {
    return [];
  }
}

export function logCounts(): { errors24h: number; total: number } {
  try {
    const db = getDb();
    const e = db.prepare("SELECT COUNT(*) n FROM app_logs WHERE kind='error' AND at > datetime('now','-1 day')").get() as { n: number };
    const t = db.prepare("SELECT COUNT(*) n FROM app_logs").get() as { n: number };
    return { errors24h: e.n, total: t.n };
  } catch {
    return { errors24h: 0, total: 0 };
  }
}

export function clearLogs(): number {
  try { return getDb().prepare("DELETE FROM app_logs").run().changes; } catch { return 0; }
}
