// ログイン（単体版）。ユーザーごとにアカウントを発行し、キャンペーン・送信者・送信履歴を分離する。
import { termsAgreed } from "./terms.js";
import crypto from "node:crypto";
import { errorPage } from "./ui/layout.js";
import os from "node:os";
import type { Request, Response, NextFunction } from "express";
import { getDb, type User } from "./db.js";

const SESSION_DAYS = 14;

// ---- パスワード（scrypt。外部ライブラリ不要）----
export function hashPassword(plain: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const key = crypto.scryptSync(plain, salt, 64).toString("hex");
  return `scrypt$${salt}$${key}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  const [scheme, salt, key] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !key) return false;
  const calc = crypto.scryptSync(plain, salt, 64);
  const want = Buffer.from(key, "hex");
  return calc.length === want.length && crypto.timingSafeEqual(calc, want);
}

/** 覚えやすく推測されにくい初期パスワードを作る */
export function randomPassword(len = 12): string {
  const chars = "abcdefghijkmnpqrstuvwxyz23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  return Array.from(crypto.randomBytes(len), (b) => chars[b % chars.length]).join("");
}

// ---- ユーザー ----
/** ログインIDを変更する（管理者が「ユーザー管理」から。ログイン中のセッションはそのまま使える） */
export function renameUser(userId: number, newUsername: string): void {
  const db = getDb();
  const name = newUsername.trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(name)) throw new Error("ログインIDは半角英数字・._- の3〜32文字にしてください");
  const dup = db.prepare("SELECT id FROM users WHERE username=?").get(name) as { id: number } | undefined;
  if (dup && dup.id !== userId) throw new Error("そのログインIDはすでに使われています");
  db.prepare("UPDATE users SET username=? WHERE id=?").run(name, userId);
}

export function createUser(username: string, password: string, opts: { role?: "admin" | "user"; displayName?: string; mustChange?: boolean } = {}): User {
  const db = getDb();
  const name = username.trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(name)) throw new Error("ログインIDは半角英数字・._- の3〜32文字にしてください");
  if (password.length < 8) throw new Error("パスワードは8文字以上にしてください");
  if (db.prepare("SELECT 1 FROM users WHERE username=?").get(name)) throw new Error("そのログインIDはすでに使われています");
  const r = db.prepare("INSERT INTO users(username, display_name, password_hash, role, must_change) VALUES(?,?,?,?,?)")
    .run(name, opts.displayName ?? "", hashPassword(password), opts.role ?? "user", opts.mustChange ? 1 : 0);
  return db.prepare("SELECT * FROM users WHERE id=?").get(r.lastInsertRowid) as User;
}

export function setPassword(userId: number, password: string, mustChange = false) {
  if (password.length < 8) throw new Error("パスワードは8文字以上にしてください");
  getDb().prepare("UPDATE users SET password_hash=?, must_change=? WHERE id=?").run(hashPassword(password), mustChange ? 1 : 0, userId);
}

export function findUser(username: string): User | undefined {
  return getDb().prepare("SELECT * FROM users WHERE username=?").get(username.trim().toLowerCase()) as User | undefined;
}

export function listUsers(): User[] {
  return getDb().prepare("SELECT * FROM users ORDER BY id").all() as User[];
}

/** 最初の管理者のログインID。どのPCも「admin」だと、同じIDを狙われやすく、誰のアカウントか分からなくなるため、
 *  そのパソコンのユーザー名（例: johnnydeppstreasures）から作る。使えない場合はパソコン名、どちらも駄目なら admin。
 *  初回設定の画面では、この値を入力欄の初期値として出す */
export function defaultAdminUsername(): string {
  const clean = (v: string) => v.normalize("NFKC").toLowerCase().replace(/[^a-z0-9._-]/g, "");
  const candidates = [os.userInfo?.().username ?? "", os.hostname().split(".")[0] ?? ""];
  for (const c of candidates) {
    const name = clean(c).slice(0, 32);
    if (/^[a-z0-9._-]{3,32}$/.test(name)) return name;
  }
  return "admin";
}

/** 起動時: ユーザーが1人もいないとき、環境変数 ADMIN_USER / ADMIN_PASSWORD が渡されていれば管理者を作る。
 *  渡されていなければ作らない（画面の初回設定で本人に決めてもらう）。
 *  以前は自動で作ってターミナルにだけ表示していたが、黒い画面を読み飛ばしてログインできない問い合わせが多かったため */
export function ensureFirstAdmin(): { username: string; password: string } | null {
  if (!process.env.ADMIN_USER && !process.env.ADMIN_PASSWORD) return null;
  if (!needsFirstSetup()) return null;
  const username = (process.env.ADMIN_USER || defaultAdminUsername()).toLowerCase();
  const password = process.env.ADMIN_PASSWORD || randomPassword();
  createUser(username, password, { role: "admin", displayName: "管理者", mustChange: !process.env.ADMIN_PASSWORD });
  return { username, password };
}

// ---- 初回設定（管理者がまだいないとき）----
// 一度でもユーザーができたら0人に戻ることはない（削除は無く停止だけ）ので、「いる」と分かったら覚えておき、毎回数えない
let hasUsers = false;
export function needsFirstSetup(): boolean {
  if (hasUsers) return false;
  const n = (getDb().prepare("SELECT COUNT(*) n FROM users").get() as { n: number }).n;
  if (n > 0) hasUsers = true;
  return !hasUsers;
}

const LOOPBACK_ADDR = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const LOOPBACK_HOST = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const PROXY_HEADERS = ["x-forwarded-for", "x-forwarded-host", "forwarded", "x-real-ip", "cf-connecting-ip", "via"];
/** このPC自身から開いているか。初回設定は「先に開いた人が管理者になる」ため、同じWi-Fiの他人に取られないよう本人のPCに限る。
 *  接続元だけでなく Host も見るのは、悪意のあるサイトが名前の書き換え（DNSリバインディング）で localhost を叩くのを防ぐため */
export function isLocalRequest(req: Request): boolean {
  // 転送役（リバースプロキシ・トンネル・Cloudflare など）を通った要求は、接続元が 127.0.0.1 に見えても、実際は外から来ている。
  // 転送役が付ける見出しが1つでもあれば、このPC自身からではないとみなす（初回設定を外の人に取られないように）
  if (PROXY_HEADERS.some((h) => req.headers[h] !== undefined)) return false;
  return LOOPBACK_ADDR.has(String(req.socket.remoteAddress ?? "")) && LOOPBACK_HOST.has(String(req.hostname ?? "").toLowerCase());
}

/** 初回設定で最初の管理者を作る。2つの画面から同時に送られても1人しか作らないよう、数え直しと作成を1つの処理で行う */
export function createFirstAdmin(username: string, password: string): User {
  const db = getDb();
  return db.transaction(() => {
    if (!needsFirstSetup()) throw new Error("管理者はすでに設定されています。ログイン画面からログインしてください");
    const u = createUser(username, password, { role: "admin", displayName: "管理者", mustChange: false });
    hasUsers = true;
    return u;
  })();
}

// ---- セッション ----
function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function startSession(res: Response, userId: number) {
  const db = getDb();
  const token = crypto.randomBytes(32).toString("hex");
  db.prepare("INSERT INTO sessions(token, user_id, expires_at) VALUES(?,?,datetime('now', ?))").run(token, userId, `+${SESSION_DAYS} days`);
  db.prepare("UPDATE users SET last_login_at=datetime('now') WHERE id=?").run(userId);
  const secure = process.env.COOKIE_SECURE === "1" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `apoboost_sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`);
}

export function endSession(req: Request, res: Response) {
  const token = parseCookies(req.headers.cookie)["apoboost_sid"];
  if (token) getDb().prepare("DELETE FROM sessions WHERE token=?").run(token);
  res.setHeader("Set-Cookie", "apoboost_sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
}

export type AuthedRequest = Request & { user?: User };

/** 認証が要らないパス（ログイン画面・初回設定・配信停止リンク）。/welcome は経路の側で「管理者がまだいない・このPCから」を確かめる */
const PUBLIC_PATHS = [/^\/login$/, /^\/logout$/, /^\/welcome$/, /^\/unsubscribe\//, /^\/healthz$/, /^\/terms$/];

export function authMiddleware(req: AuthedRequest, res: Response, next: NextFunction) {
  const db = getDb();
  const token = parseCookies(req.headers.cookie)["apoboost_sid"];
  if (token) {
    const row = db.prepare(
      "SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at > datetime('now') AND u.active=1"
    ).get(token) as User | undefined;
    if (row) req.user = row;
    else db.prepare("DELETE FROM sessions WHERE token=?").run(token);
  }
  if (req.user) {
    // パスワード変更が必要なうちは、変更画面以外に進ませない
    if (req.user.must_change && !/^\/(password|logout)$/.test(req.path)) return res.redirect("/password");
    // 利用規約（この版）に管理者がまだ同意していなければ、同意の画面へ。質問箱など画面の裏の呼び出しは止めない
    if (req.user.role === "admin" && !termsAgreed() && req.method === "GET" && !/^\/(terms|logout|password|support\/|events)/.test(req.path)) return res.redirect("/terms");
    return next();
  }
  // 管理者がまだいない: このPCから開いたときは、どの画面を開いても初回設定へ案内する（ログイン画面で止まらないように）
  if (needsFirstSetup() && isLocalRequest(req) && !/^\/(welcome$|unsubscribe\/)/.test(req.path)) return res.redirect("/welcome");
  if (PUBLIC_PATHS.some((re) => re.test(req.path))) return next();
  const back = encodeURIComponent(req.originalUrl || "/");
  return res.redirect(`/login?next=${back}`);
}

export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (req.user?.role !== "admin") return res.status(403).send(errorPage(403, req.user ? { username: req.user.username, display_name: req.user.display_name, role: req.user.role, path: req.path } : null));
  next();
}

/** 期限切れセッションの掃除（1日1回） */
export function cleanupSessions() {
  getDb().prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();
}
