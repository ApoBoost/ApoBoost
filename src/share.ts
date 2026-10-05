// チームでの共有（#78 送信済みリスト / #79 除外リストの双方向）。
//
// ApoBoostはサーバーを持たない方針なので、共有の置き場所は「利用者自身のGoogleスプレッドシート」にする。
//  ・読み取り（取り込み）: シートの公開CSVを1日1回読む（これまでの除外リスト同期と同じ）
//  ・書き込み（送信済み・除外の追加）: 利用者がシートに貼り付けた Apps Script（Webアプリ）へJSONでPOSTする
// Apps Script のコードは画面に表示して、コピーして貼ってもらう。アカウント連携も追加の費用も要らない。
import { getDb, getSetting, setSetting, domainOf } from "./db.js";
import { logError, logInfo } from "./applog.js";
import { jpError } from "./jp.js";
import { normalizeEmail, isFreeMailDomain } from "./email.js";

export type ShareKind = "sent" | "suppression";

export const KEY = {
  sentPullUrl: "share_sent_pull_url",     // 送信済みの共有シート（CSVで読む）
  pushUrl: "share_push_url",              // Apps Script のWebアプリURL（書き込み）
  member: "share_member_name",            // 誰が送ったか分かるように入れる名前
  lastSentPush: "share_last_sent_push",   // 旧版の書き出し位置（form_jobs.id）。いまは form_jobs.shared_at で管理するので読まない
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
      const d = sharedKeyOf(r[0] ?? "");
      if (!d) continue;
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

// ---- 共有シートの1列目（キー）----
// 1列目は「ドメイン」。ただしフリーメール（gmail.com など）の会社は、ドメインが同じでも別の会社なので、アドレスで書く。
// 以前はURLの無い会社のドメイン（＝メールのドメイン）をそのまま書いていたため「gmail.com」が載り、取り込んだ全員
// （自分も）の Gmail の会社が、翌日から全部「チームの◯◯が送信済み」で送られなくなっていた。
// アドレスは <taro@gmail.com> のように <> で囲んで書く。古い版のアプリは1列目をURLとして読むので、
// 素の「taro@gmail.com」だと「gmail.com」と読んでしまい、古い版を使っているメンバーの Gmail の会社が全部止まる。
// <> 付きなら古い版はドメインとして読めず、そのままの文字列（どの会社のドメインとも一致しない）で保存するだけで済む。
// シートの列の意味・Apps Script は変えない（各自がデプロイ済みのものをそのまま使える）

/** 送信済みの会社を、共有シートの1列目に書く形にする。書けなければ "" */
export function sharedKeyFor(domain: string, email: string): string {
  const d = String(domain ?? "").trim().toLowerCase();
  if (d && !isFreeMailDomain(d)) return d;
  const addr = normalizeEmail(email);
  return addr ? `<${addr}>` : "";
}

/** 共有シートの1列目を、shared_sent に入れる形（ドメイン、またはそろえたアドレス）にする。使えなければ "" */
export function sharedKeyOf(cell: string): string {
  const raw = String(cell ?? "").trim();
  if (!raw) return "";
  // アドレスの行は URL として読まない（domainOf に通すと「gmail.com」になる）
  if (raw.includes("@")) return normalizeEmail(raw);
  const d = domainOf(raw) || raw.toLowerCase();
  return d.includes(".") ? d : "";
}

/** 自分が送信済みにした会社を共有シートへ書き出す（#78）。
 *  まだ書き出していない送信済み（shared_at が空）を古い順に出す。以前は「前回の id より大きいもの」で進めていたため、
 *  id の小さいキャンペーンが後から送った分が永久に書き出されなかった。
 *  この版に上がった直後は、これまでの送信済みをもう一度すべて出す（シートの側で同じ1列目は追加しないので重ならない） */
export async function pushSent(): Promise<number> {
  const db = getDb();
  const member = getSetting(KEY.member, "") || "（名前未設定）";
  const pick = db.prepare(`SELECT id, domain, email, company_name, sent_at FROM form_jobs
    WHERE shared_at IS NULL AND is_test=0 AND status='sent' AND (domain<>'' OR email<>'') ORDER BY sent_at, id LIMIT 500`);
  const mark = db.prepare("UPDATE form_jobs SET shared_at=datetime('now') WHERE id=?");
  let total = 0;
  // 1回の同期で出すのは最大 5,000件（Apps Script の1回の処理時間に収まるよう 500件ずつ）
  for (let round = 0; round < 10; round++) {
    const rows = pick.all() as { id: number; domain: string; email: string; company_name: string; sent_at: string }[];
    if (!rows.length) break;
    const out = rows.map((r) => [sharedKeyFor(r.domain, r.email), r.company_name, member, r.sent_at ?? ""] as (string | number)[]).filter((r) => r[0]);
    if (out.length) total += await push("sent", out);
    // 書き出せた（push が失敗すれば例外で抜けるので、ここには来ない）ものだけ印を付ける
    db.transaction(() => { for (const r of rows) mark.run(r.id); })();
    if (rows.length < 500) break;
  }
  return total;
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

/** この会社は、ほかのメンバーがすでに送っているか（#78）。
 *  ・ドメインで引く。ただしフリーメールのドメイン（gmail.com 等）では引かない（旧版が書いた「gmail.com」の行で、
 *    Gmail の会社が全部止まっていた）。
 *  ・アドレスでも引く（フリーメールの会社はアドレスで書き出しているため。会社のドメインと違うアドレスに送った行も当たる）
 *  ・自分の名前の行は見ない。自分の送信は手元の記録（再送禁止の期間・同じアドレス）で判断しているので、共有シートから
 *    戻ってきた自分の行で、再送禁止の設定より強く止めない（名前が未設定のときは見分けられないので、従来どおりすべて見る） */
export function sharedSentBy(domain: string, email = ""): { member: string; sent_at: string } | null {
  const d = String(domain ?? "").trim().toLowerCase();
  const keys = [normalizeEmail(email), d && !isFreeMailDomain(d) ? d : ""].filter(Boolean);
  if (!keys.length) return null;
  const me = getSetting(KEY.member, "").trim();
  try {
    const rows = getDb().prepare(`SELECT member, sent_at FROM shared_sent WHERE domain IN (${keys.map(() => "?").join(",")})`).all(...keys) as { member: string; sent_at: string }[];
    // 「自分の名前の行」を見逃すのは、このPCに実際に送った記録があるときだけ。
    // 名前だけで見逃すと、同じ共有名を使う別のPC（1人で2台・チームで同じ部署名）が送った会社に、こちらからも送ってしまう
    const addr = keys.find((k) => k.includes("@")) ?? "", dk = keys.find((k) => !k.includes("@")) ?? "";
    let sentHere: boolean | null = null;
    const here = () => (sentHere ??= Boolean(getDb().prepare(
      `SELECT 1 FROM form_jobs WHERE is_test=0 AND sent_at IS NOT NULL
        AND ((?<>'' AND domain=?) OR (?<>'' AND instr(lower(email), ?)>0)) LIMIT 1`).get(dk, dk, addr, addr)));
    return rows.find((r) => !me || r.member.trim() !== me || !here()) ?? null;
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
