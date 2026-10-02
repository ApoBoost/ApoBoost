// チームでの共有（#78 送信済みリスト / #79 除外リストの双方向）。
//
// ApoBoostはサーバーを持たない方針なので、共有の置き場所は「利用者自身のGoogleスプレッドシート」にする。
//  ・読み取り（取り込み）: シートの公開CSVを1日1回読む（これまでの除外リスト同期と同じ）
//  ・書き込み（送信済み・除外の追加）: 利用者がシートに貼り付けた Apps Script（Webアプリ）へJSONでPOSTする
// Apps Script のコードは画面に表示して、コピーして貼ってもらう。アカウント連携も追加の費用も要らない。
import { getDb, getSetting, setSetting, domainOf } from "./db.js";
import { logError, logInfo } from "./applog.js";
import { jpError } from "./jp.js";

export type ShareKind = "sent" | "suppression";

export const KEY = {
  sentPullUrl: "share_sent_pull_url",     // 送信済みの共有シート（CSVで読む）
  pushUrl: "share_push_url",              // Apps Script のWebアプリURL（書き込み）
  member: "share_member_name",            // 誰が送ったか分かるように入れる名前
  lastSentPush: "share_last_sent_push",   // ここまで送信済みを書き出した form_jobs.id
  lastSuppPush: "share_last_supp_push",   // ここまで除外を書き出した form_suppressions.id
  lastPull: "share_last_pull",            // 最後に取り込んだ時刻
  lastResult: "share_last_result",        // 画面に出す結果
};

/** 共有シートに貼り付けてもらう Apps Script。シートに「送信済み」「除外リスト」の2枚を作る */
export const APPS_SCRIPT = `// ApoBoost 共有用（このコードをスプレッドシートの「拡張機能 → Apps Script」に貼り付けて、
// 「デプロイ → 新しいデプロイ → 種類: ウェブアプリ → アクセスできるユーザー: 全員」で公開し、
// 表示されたURLをApoBoostの「共有の設定」に貼ってください。
function doPost(e) {
  var body = JSON.parse(e.postData.contents);
  var name = body.kind === 'sent' ? '送信済み' : '除外リスト';
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.appendRow(body.kind === 'sent' ? ['ドメイン', '会社名', '送った人', '送信日時'] : ['ドメイン', '会社名', 'メール', '理由', '登録者', '登録日時']);
  }
  // すでにある行（1列目）は追加しない
  var existing = {};
  var values = sh.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) existing[String(values[i][0]).toLowerCase()] = true;
  var added = 0;
  (body.rows || []).forEach(function (r) {
    var key = String(r[0] || '').toLowerCase();
    if (!key || existing[key]) return;
    existing[key] = true;
    sh.appendRow(r);
    added++;
  });
  return ContentService.createTextOutput(JSON.stringify({ ok: true, added: added })).setMimeType(ContentService.MimeType.JSON);
}`;

/** Googleスプレッドシートの共有URLを、CSVで読めるURLに変換する */
export function sheetCsvUrl(url: string): string {
  const m = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/.exec(url);
  if (!m) return "";
  const gid = /[#&?]gid=(\d+)/.exec(url)?.[1] ?? "0";
  return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv&gid=${gid}`;
}

async function fetchCsv(url: string): Promise<string> {
  const res = await fetch(sheetCsvUrl(url) || url, { redirect: "follow", signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`シートを読めませんでした（HTTP ${res.status}）。共有を「リンクを知っている全員（閲覧可）」にしてください`);
  const text = await res.text();
  if (/<html/i.test(text.slice(0, 200))) throw new Error("シートを読めませんでした（公開設定を「リンクを知っている全員（閲覧可）」にしてください）");
  return text;
}

/** 共有シートから「他のメンバーが送信済みの会社」を取り込む（#78） */
export async function pullSharedSent(): Promise<{ added: number; total: number }> {
  const url = getSetting(KEY.sentPullUrl, "");
  if (!url) return { added: 0, total: 0 };
  const db = getDb();
  const csv = await fetchCsv(url);
  const rows = csv.split(/\r?\n/).slice(1).map((l) => l.split(",").map((c) => c.replace(/^"|"$/g, "").trim()));
  const ins = db.prepare("INSERT OR IGNORE INTO shared_sent(domain, company_name, member, sent_at) VALUES(?,?,?,?)");
  let added = 0;
  db.transaction(() => {
    for (const r of rows) {
      const d = domainOf(r[0] ?? "") || (r[0] ?? "").toLowerCase().trim();
      if (!d || !d.includes(".")) continue;
      added += ins.run(d, r[1] ?? "", r[2] ?? "", r[3] ?? "").changes;
    }
  })();
  const total = (db.prepare("SELECT COUNT(*) n FROM shared_sent").get() as { n: number }).n;
  return { added, total };
}

async function push(kind: ShareKind, rows: (string | number)[][]): Promise<number> {
  const url = getSetting(KEY.pushUrl, "");
  if (!url || !rows.length) return 0;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind, rows }),
    redirect: "follow",
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`共有シートに書き込めませんでした（HTTP ${res.status}）。Apps Script の公開設定（アクセスできるユーザー: 全員）をご確認ください`);
  const j = (await res.json().catch(() => ({}))) as { added?: number };
  return j.added ?? rows.length;
}

/** 自分が送信済みにした会社を共有シートへ書き出す（#78） */
export async function pushSent(): Promise<number> {
  const db = getDb();
  const last = Number(getSetting(KEY.lastSentPush, "0")) || 0;
  const member = getSetting(KEY.member, "") || "（名前未設定）";
  const rows = db.prepare(`SELECT id, domain, company_name, sent_at FROM form_jobs
    WHERE id > ? AND is_test=0 AND status='sent' AND domain<>'' ORDER BY id LIMIT 500`).all(last) as { id: number; domain: string; company_name: string; sent_at: string }[];
  if (!rows.length) return 0;
  const n = await push("sent", rows.map((r) => [r.domain, r.company_name, member, r.sent_at ?? ""]));
  setSetting(KEY.lastSentPush, String(rows[rows.length - 1].id));
  return n;
}

/** 自分が追加した除外（断り・営業お断り）を共有シートへ書き出す（#79） */
export async function pushSuppressions(): Promise<number> {
  const db = getDb();
  const last = Number(getSetting(KEY.lastSuppPush, "0")) || 0;
  const member = getSetting(KEY.member, "") || "（名前未設定）";
  const rows = db.prepare(`SELECT id, COALESCE(domain,'') domain, company_name, COALESCE(email,'') email, reason, created_at
    FROM form_suppressions WHERE id > ? ORDER BY id LIMIT 500`).all(last) as { id: number; domain: string; company_name: string; email: string; reason: string; created_at: string }[];
  const usable = rows.filter((r) => r.domain || r.email);
  if (!rows.length) return 0;
  const n = usable.length ? await push("suppression", usable.map((r) => [r.domain || r.email, r.company_name, r.email, r.reason, member, r.created_at])) : 0;
  setSetting(KEY.lastSuppPush, String(rows[rows.length - 1].id));
  return n;
}

/** この会社は、ほかのメンバーがすでに送っているか（#78） */
export function sharedSentBy(domain: string): { member: string; sent_at: string } | null {
  if (!domain) return null;
  try {
    return (getDb().prepare("SELECT member, sent_at FROM shared_sent WHERE domain=?").get(domain) as { member: string; sent_at: string } | undefined) ?? null;
  } catch { return null; }
}

export function shareConfigured(): boolean {
  return Boolean(getSetting(KEY.sentPullUrl, "") || getSetting(KEY.pushUrl, ""));
}

/** 1日1回まとめて実行する（起動から3分後にも1回） */
export async function syncShare(): Promise<string> {
  if (!shareConfigured()) return "";
  const parts: string[] = [];
  try {
    const pulled = await pullSharedSent();
    if (pulled.total) parts.push(`取り込み +${pulled.added}件（共有の送信済み 合計${pulled.total}件）`);
  } catch (e) {
    logError("share", `共有の送信済みを取り込めませんでした: ${jpError(e)}`);
    parts.push(`取り込み失敗: ${jpError(e, 80)}`);
  }
  try {
    const a = await pushSent();
    const b = await pushSuppressions();
    if (a || b) parts.push(`書き出し 送信済み${a}件・除外${b}件`);
  } catch (e) {
    logError("share", `共有シートに書き出せませんでした: ${jpError(e)}`);
    parts.push(`書き出し失敗: ${jpError(e, 80)}`);
  }
  const msg = parts.join(" ／ ") || "変更なし";
  setSetting(KEY.lastPull, new Date().toISOString());
  setSetting(KEY.lastResult, msg);
  logInfo("share", `チーム共有の同期: ${msg}`);
  return msg;
}
