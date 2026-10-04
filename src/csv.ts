import { hasEntity } from "./company.js";
import { S } from "./settings.js";
// 企業DB（COMPANY_DB.md の列名）や任意のCSVを取り込む。列名の別名に対応。
import { parse } from "csv-parse/sync";
import { domainOf, getDb, getSetting, isExcludedDomain, channelMode, findGroupDuplicate } from "./db.js";

export type CompanyRow = {
  company_name: string;
  form_url: string;
  site_url: string;
  email: string;
  industry: string;
  sub_industry: string;
  prefecture: string;
  representative: string;
};

// 見出しの別名。見出しは normHeader() でそろえてから「完全一致」で照らし合わせる
// （部分一致にすると「担当者メール」を会社のメールに、「画像URL」を会社URLに取り違えるため）。
// 並び順が優先順位: 同じ表に「会社名」と「店舗名」があれば「会社名」を使う
const ALIASES: Record<keyof CompanyRow, string[]> = {
  company_name: ["企業名", "会社名", "社名", "法人名", "商号", "企業名称", "会社名称", "法人名称", "company", "company_name", "companyname", "name", "屋号", "店舗名"],
  form_url: ["問い合わせフォーム", "お問い合わせフォーム", "問合せフォーム", "お問合せフォーム", "問い合せフォーム", "お問い合せフォーム",
    "フォームURL", "問い合わせフォームURL", "お問い合わせフォームURL", "問合せフォームURL", "お問合せフォームURL",
    "問い合わせURL", "お問い合わせURL", "問合せURL", "お問合せURL", "問い合わせページ", "お問い合わせページ", "コンタクトURL",
    "form_url", "contact_url", "inquiry_url", "form"],
  site_url: ["企業URL", "URL", "ホームページ", "ホームページURL", "HP", "HP URL", "会社HP", "企業HP", "会社URL", "会社ホームページ", "企業ホームページ",
    "公式サイト", "公式HP", "公式URL", "Webサイト", "ウェブサイト", "WebサイトURL", "ウェブサイトURL", "サイトURL", "web", "website", "site_url", "homepage", "url"],
  email: ["メール", "メールアドレス", "Eメール", "Eメールアドレス", "代表メール", "代表メールアドレス", "会社メール", "会社メールアドレス",
    "問い合わせメール", "お問い合わせメール", "email", "mail", "e-mail", "email_address", "mail_address"],
  industry: ["大業界", "業界", "業種", "大業種", "業種分類", "industry"],
  sub_industry: ["小業界", "小業種", "業種詳細", "sub_industry"],
  prefecture: ["都道府県", "所在地都道府県", "prefecture"],
  representative: ["代表者名", "代表者", "代表", "代表者氏名", "代表取締役", "representative"],
};

/** 見出しをそろえる: 全角→半角（NFKC）・小文字・括弧の中身（「メールアドレス（代表）」の（代表））・空白・記号を除く。
 *  「ホームページ URL」「HP_URL」「E-mail」「会社名※必須」なども同じ見出しとして読めるようにする */
export function normHeader(h: string): string {
  return String(h ?? "")
    .normalize("NFKC")
    .toLowerCase()
    // 括弧の中は外す。ただし読み仮名・英語表記の列（「会社名（カナ）」など）は別の列として残す
    // （外すと「会社名」と同じ扱いになり、社名の代わりにフリガナを拾ってしまう）
    .replace(/\(([^)]*)\)|\[([^\]]*)\]|【([^】]*)】|〔([^〕]*)〕|<([^>]*)>|〈([^〉]*)〉|《([^》]*)》/g, (_m, ...g: unknown[]) =>
      READING_RE.test(g.slice(0, 7).filter((x) => typeof x === "string").join("")) ? "#kana" : "")
    .replace(/※.*$/, "")
    .replace(/[\s_\-‐―・:;：；.,、。\/／*＊]/g, "")
    .trim();
}

const READING_RE = /カナ|かな|フリガナ|ふりがな|ヨミ|よみ|読み|kana|yomi|英|ローマ字|roman/i;

/** 括弧などを外す前の見出し（NFKC・小文字・空白なし）。同じ見出しに読める列が複数あるとき、こちらが一致する列を優先する */
const rawHeader = (h: string) => String(h ?? "").normalize("NFKC").toLowerCase().replace(/\s/g, "");

const NORM_ALIASES = Object.fromEntries(Object.entries(ALIASES).map(([k, v]) => [k, v.map(normHeader)])) as Record<keyof CompanyRow, string[]>;

/** 見出しの列から、項目ごとに使う列を決める（別名の優先順） */
function columnFor(cols: string[], aliases: string[]): string | undefined {
  const norm = cols.map(normHeader);
  for (const a of aliases) {
    if (!a) continue;
    const hits = cols.filter((_, i) => norm[i] === a);
    if (hits.length) return hits.find((c) => rawHeader(c) === a) ?? hits[0];
  }
  return undefined;
}

function pick(row: Record<string, string>, keys: string[]): string {
  const col = columnFor(Object.keys(row), keys.map(normHeader));
  return col === undefined ? "" : String(row[col] ?? "").trim();
}

export const COMPANY_FIELD_LABEL: Record<keyof CompanyRow, string> = {
  company_name: "企業名", form_url: "問い合わせフォーム", site_url: "企業URL", email: "メール",
  industry: "業種", sub_industry: "小業種", prefecture: "都道府県", representative: "代表者",
};

export type HeaderReport = { used: { header: string; field: string }[]; unused: string[] };

/** 取り込みプレビューに出す「読み取れた見出し／使わなかった見出し」。
 *  列名が違って読めていないことに、取り込む前に気づけるようにする */
export function headerReport(headers: string[]): HeaderReport {
  const cols = headers.map((h) => String(h ?? "").trim()).filter(Boolean);
  const used: HeaderReport["used"] = [];
  const taken = new Set<string>();
  for (const k of Object.keys(ALIASES) as (keyof CompanyRow)[]) {
    const col = columnFor(cols, NORM_ALIASES[k]);
    if (col !== undefined) { used.push({ header: col, field: COMPANY_FIELD_LABEL[k] }); taken.add(col); }
  }
  return { used, unused: cols.filter((c) => !taken.has(c)) };
}

/** 読み取った行と、元の見出し（プレビューで見せる用） */
export type CompanyRows = CompanyRow[] & { headers?: string[] };

/** ヘッダー付きレコード配列を CompanyRow[] に変換（CSV・Excel・貼り付けで共通） */
export function rowsToCompanies(rows: Record<string, string>[], headers?: string[]): CompanyRows {
  // 見出し→列の対応は全行で同じなので、先に1回だけ決める
  const cols = headers ?? (rows[0] ? Object.keys(rows[0]) : []);
  const colOf = Object.fromEntries((Object.keys(ALIASES) as (keyof CompanyRow)[]).map((k) => [k, columnFor(cols, NORM_ALIASES[k])])) as Record<keyof CompanyRow, string | undefined>;
  const get = (r: Record<string, string>, k: keyof CompanyRow) => { const c = colOf[k]; return c === undefined ? "" : String(r[c] ?? "").trim(); };
  const out: CompanyRows = rows
    .map((r) => ({
      company_name: get(r, "company_name"),
      form_url: get(r, "form_url"),
      site_url: get(r, "site_url"),
      email: get(r, "email").toLowerCase(),
      industry: get(r, "industry"),
      sub_industry: get(r, "sub_industry"),
      prefecture: get(r, "prefecture"),
      representative: get(r, "representative"),
    }))
    .filter((r) => r.company_name);
  out.headers = cols;
  return out;
}

/** 区切り文字を1行目から決める。タブ（スプレッドシートからの貼り付け）・セミコロン（欧州設定のExcel）・カンマ */
export function detectDelimiter(firstLine: string): string {
  const outside = firstLine.replace(/"[^"]*"/g, ""); // 引用符の中の記号は数えない
  if (outside.includes("\t") && !outside.includes(",")) return "\t";
  if (outside.includes(";") && !outside.includes(",")) return ";";
  return ",";
}

/** csv-parse を日本語のエラーで包む。セルの中の " は relax_quotes で読めるようにし、
 *  それでも読めないとき（引用符が閉じていない等）は、何行目をどう直せばよいかを日本語で返す
 *  （英語の「Invalid Opening Quote…」のまま取り込みが止まっていた） */
function parseCsvJp<T>(text: string, opts: Record<string, unknown>): T {
  try {
    return parse(text, { skip_empty_lines: true, relax_column_count: true, relax_quotes: true, trim: true, ...opts }) as T;
  } catch (e) {
    const err = e as Error & { lines?: number; code?: string };
    const where = err.lines ? `${err.lines}行目あたり` : "どこかの行";
    if (/quote/i.test(err.message) || /QUOTE/.test(err.code ?? "")) {
      throw new Error(`${where}で「"」（ダブルクォーテーション）の数が合わず、表として読めませんでした。その行のセルにある「"」を消すか全角の「”」に直してから、もう一度取り込んでください`);
    }
    throw new Error(`${where}が表として読めませんでした。Excelやスプレッドシートで開いて「CSV（UTF-8）」で保存し直してから取り込んでください（詳細: ${String(err.message).slice(0, 80)}）`);
  }
}

export function parseCompanyCsv(buf: Buffer | string): CompanyRows {
  let text = typeof buf === "string" ? buf : buf.toString("utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  // Shift_JIS のExcel出力対策: 文字化けが目立つ場合は再デコード
  if (typeof buf !== "string" && /�/.test(text.slice(0, 2000))) {
    text = new TextDecoder("shift_jis").decode(buf);
  }
  const firstLine = text.slice(0, text.indexOf("\n") >= 0 ? text.indexOf("\n") : text.length).replace(/\r$/, "");
  const delimiter = detectDelimiter(firstLine);
  let headers: string[] = [];
  const rows = parseCsvJp<Record<string, string>[]>(text, { delimiter, columns: (h: string[]) => (headers = h.map((x) => String(x ?? "").trim())) });
  return rowsToCompanies(rows, headers);
}

/** 2次元配列（1行目ヘッダー）をレコード配列にする */
function gridToRecords(grid: string[][]): Record<string, string>[] {
  if (grid.length < 2) return [];
  const header = grid[0].map((h) => (h ?? "").trim());
  return grid.slice(1).map((row) => {
    const rec: Record<string, string> = {};
    header.forEach((h, i) => { if (h) rec[h] = (row[i] ?? "").trim(); });
    return rec;
  });
}

/** Excel の文字列（共有文字列・セル内の文字列）から、表示される文字だけを取り出す。
 *  ふりがな（<rPh>…</rPh>）は表示されない文字なので除く。除かないと「株式会社サンプルカブシキガイシャ」のように
 *  会社名にフリガナがくっついていた。書式付きの文字列（<r><t>…</t></r> が複数）はつなげる */
export function xlsxText(xml: string, decode: (s: string) => string = xmlDecode): string {
  const body = String(xml ?? "").replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").replace(/<phoneticPr\b[^>]*\/?>/g, "");
  return (body.match(/<t(?:\s[^>]*)?>[\s\S]*?<\/t>/g) ?? []).map((t) => decode(t.replace(/<[^>]+>/g, ""))).join("");
}

function xmlDecode(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, "&");
}

/** Excel(.xlsx) を読む。新しい依存を足さず、既存の adm-zip で中身のXMLを直接パースする */
export async function parseCompanyXlsx(buf: Buffer): Promise<CompanyRows> {
  const AdmZip = (await import("adm-zip")).default;
  const zip = new AdmZip(buf);
  const readXml = (name: string) => zip.getEntry(name)?.getData().toString("utf8") ?? "";
  const decode = xmlDecode;
  // 共有文字列テーブル
  const shared: string[] = [];
  const ss = readXml("xl/sharedStrings.xml");
  for (const si of ss.match(/<si(?:\s[^>]*)?>[\s\S]*?<\/si>|<si\s*\/>/g) ?? []) shared.push(xlsxText(si));
  // 最初のシート
  let sheetXml = readXml("xl/worksheets/sheet1.xml");
  if (!sheetXml) { for (const e of zip.getEntries()) { if (/xl\/worksheets\/.*\.xml$/.test(e.entryName)) { sheetXml = e.getData().toString("utf8"); break; } } }
  const colNum = (ref: string) => { const m = ref.match(/^([A-Z]+)/); if (!m) return 0; let n = 0; for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };
  const grid: string[][] = [];
  for (const rowXml of sheetXml.match(/<row[^>]*>[\s\S]*?<\/row>/g) ?? []) {
    const cells: string[] = [];
    for (const cXml of rowXml.match(/<c[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) ?? []) {
      const ref = (cXml.match(/r="([A-Z]+\d+)"/) ?? [])[1] ?? "";
      const isStr = /t="s"/.test(cXml);
      const isInline = /t="inlineStr"/.test(cXml);
      const raw = (cXml.match(/<v>([\s\S]*?)<\/v>/) ?? [])[1] ?? "";
      let val = decode(raw);
      if (isStr) val = shared[Number(raw)] ?? "";
      else if (isInline) val = xlsxText(cXml); // セル内の文字列もふりがなを除き、書式の切れ目をつなげる
      const ci = colNum(ref);
      cells[ci] = val;
    }
    grid.push(Array.from(cells, (v) => v ?? ""));
  }
  return rowsToCompanies(gridToRecords(grid), (grid[0] ?? []).map((h) => (h ?? "").trim()).filter(Boolean));
}

export type ExcludedRow = { company: string; reason: string; where: string };
/** 設定で指定した「送りたくない業種・キーワード」（#87）。会社名・業種・小業種に含まれていたら取り込み時に除外する。
 *  病院・士業など、自社の方針で当てたくない相手を会社ごとに決められるようにするためのもの。 */
export function excludedKeywords(): string[] {
  return getSetting(S.excludedIndustries, "")
    .split(/[\n,、，]/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2);
}
export function matchExcludedKeyword(r: { company_name: string; industry: string; sub_industry: string }): string {
  const hay = `${r.company_name} ${r.industry} ${r.sub_industry}`;
  return excludedKeywords().find((w) => hay.includes(w)) ?? "";
}

export type ImportSummary = { added: number; addedForm: number; addedEmail: number; excluded: number; suppressed: number; duplicated: number; noUrl: number; excludedRows: ExcludedRow[]; noEntity: string[] };

/** 企業行をキャンペーンのジョブとして登録。チャネル（フォーム／メール）を振り分け、除外・重複は理由を残す */
export function importRowsToCampaign(campaignId: number, rows: CompanyRow[], opts: { dryRun?: boolean; importId?: number } = {}): ImportSummary {
  const db = getDb();
  const campaign = db.prepare("SELECT channel, resend_days, group_name FROM form_campaigns WHERE id=?").get(campaignId) as { channel: string; resend_days: number; group_name: string } | undefined;
  const resendDays = campaign?.resend_days ?? 90;
  const mode = channelMode(campaign?.channel);
  const sharedSent = db.prepare("SELECT member FROM shared_sent WHERE domain=?");
  const summary: ImportSummary = { added: 0, addedForm: 0, addedEmail: 0, excluded: 0, suppressed: 0, duplicated: 0, noUrl: 0, excludedRows: [], noEntity: [] };
  const insert = db.prepare(`
    INSERT INTO form_jobs(campaign_id, company_name, form_url, site_url, industry, sub_industry, prefecture, representative, domain, channel, email, status, result_text, import_id)
    VALUES(@campaign_id, @company_name, @form_url, @site_url, @industry, @sub_industry, @prefecture, @representative, @domain, @channel, @email, @status, @result_text, @import_id)`);
  const isSuppressed = db.prepare("SELECT 1 FROM form_suppressions WHERE domain=?");
  const isOptedOut = db.prepare("SELECT 1 FROM email_optouts WHERE email=?");
  const recentlySent = db.prepare("SELECT 1 FROM form_jobs WHERE sent_at > datetime('now', ?) AND domain=? AND status='sent' AND is_test=0");
  const seen = new Set<string>();

  const tx = db.transaction(() => {
    for (const r0 of rows) {
      // URL欄の「なし」「-」「不明」などはURLとして扱わない（以前はフォームありと見なされ、メールがあっても送れなかった）
      const r = { ...r0, form_url: domainOf(r0.form_url) ? r0.form_url.trim() : "", site_url: domainOf(r0.site_url) ? r0.site_url.trim() : "" };
      const hasForm = Boolean(r.form_url || r.site_url);
      const hasEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email);
      let channel: "form" | "email" | null = null;
      if (mode === "form_only") channel = hasForm ? "form" : null;
      else if (mode === "email_only") channel = hasEmail ? "email" : null;
      else if (mode === "form_first") channel = hasForm ? "form" : hasEmail ? "email" : null;
      else if (mode === "email_first") channel = hasEmail ? "email" : hasForm ? "form" : null;
      const note = (reason: string) => { if (summary.excludedRows.length < 300) summary.excludedRows.push({ company: r.company_name, reason, where: r.form_url || r.site_url || r.email }); };
      if (!channel) { summary.noUrl++; note("送信先（フォームURL・企業URL・メール）が無い"); continue; }
      const domain = channel === "form" ? domainOf(r.form_url || r.site_url) : domainOf(r.site_url) || r.email.split("@")[1];
      if (!domain) { summary.noUrl++; note("URL・メールからドメインを判別できない"); continue; }
      if (seen.has(domain)) { summary.duplicated++; note("CSV内で重複（同じドメインが複数行）"); continue; }
      seen.add(domain);
      let status = "queued";
      let reason = "";
      let groupHit: string | null = null;
      let sharedHit: { member: string } | undefined;
      const ngWord = matchExcludedKeyword(r);
      if (isExcludedDomain(domain)) { status = "skip_suppressed"; reason = "官公庁・学校等のドメインは既定で除外"; summary.excluded++; note(reason); }
      else if (ngWord) { status = "skip_suppressed"; reason = `除外キーワード「${ngWord}」に一致（設定で変更できます）`; summary.excluded++; note(reason); }
      else if (isSuppressed.get(domain)) { status = "skip_suppressed"; reason = "除外リストに登録済み"; summary.suppressed++; note(reason); }
      else if (hasEmail && isOptedOut.get(r.email)) { status = "skip_optout"; reason = "配信停止・除外済みのアドレス"; summary.suppressed++; note(reason); }
      else if (resendDays > 0 && recentlySent.get(`-${resendDays} days`, domain)) { status = "skip_duplicate"; reason = `${resendDays}日以内に送信済み`; summary.duplicated++; note(reason); }
      // チームの誰かがすでに送っている会社は取り込まない（#78）
      else if ((sharedHit = sharedSent.get(domain) as { member: string } | undefined)) { status = "skip_duplicate"; reason = `チームの ${sharedHit.member || "他のメンバー"} が送信済み（共有リスト）`; summary.duplicated++; note(reason); }
      // 同じグループの別キャンペーンで待機中・送信中・送信済みなら登録しない（フォーム無し・失敗・CAPTCHAだった会社は、連絡できていないので対象にしてよい）
      else if (campaign?.group_name && (groupHit = findGroupDuplicate(db, { groupName: campaign.group_name, campaignId, domain, email: hasEmail ? r.email : "", statuses: ["queued", "sending", "sent"] }))) {
        status = "skip_duplicate"; reason = `同じグループの「${groupHit}」に登録済み`; summary.duplicated++; note(reason);
      }
      else {
        summary.added++; if (channel === "form") summary.addedForm++; else summary.addedEmail++;
        // 「株式会社」などの法人格が無い社名は警告用に控える（事前チェックでHPから自動補完される）
        if (!hasEntity(r.company_name) && summary.noEntity.length < 300) summary.noEntity.push(r.company_name);
      }
      if (!opts.dryRun) insert.run({ ...r, campaign_id: campaignId, domain, channel, email: hasEmail ? r.email : "", status, result_text: reason, import_id: opts.importId ?? null });
    }
  });
  tx();
  return summary;
}

// ===== 除外リストのCSV取り込み =====

export type SuppressionRow = { company_name: string; domain: string; email: string; tel: string; reason: string };

const SUPP_ALIASES: Record<keyof SuppressionRow, string[]> = {
  company_name: ["企業名", "会社名", "社名", "company", "company_name", "name"],
  domain: ["ドメイン", "domain", "企業URL", "URL", "ホームページ", "HP", "website", "問い合わせフォーム", "フォームURL"],
  email: ["メール", "メールアドレス", "email", "mail", "e-mail"],
  tel: ["電話", "電話番号", "TEL", "tel", "phone"],
  reason: ["理由", "備考", "メモ", "reason", "note"],
};

/** 除外リスト用のCSV。会社名だけ必須で、ドメイン・メール・電話はあれば拾う */
export function parseSuppressionCsv(buf: Buffer | string): SuppressionRow[] {
  let text = typeof buf === "string" ? buf : buf.toString("utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (typeof buf !== "string" && /�/.test(text.slice(0, 2000))) text = new TextDecoder("shift_jis").decode(buf);
  return parseSuppressionText(text);
}

const EMAIL_CELL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
// 「example.co.jp」「https://www.example.co.jp/contact」のようなURL・ドメイン（日本語の社名は含まない）
const DOMAIN_CELL = /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(:\d+)?(\/\S*)?$/i;
const TEL_CELL = /^[0-9０-９\-－ー()（）+\s]{9,}$/;

/** 除外リストの貼り付け・スプレッドシート・CSV を読む。
 *  1行目に見出し（会社名/ドメイン/メール 等）があればその列で読む。
 *  見出しが無ければ、各セルを「メール／URL・ドメイン／電話／それ以外＝会社名」と中身で見分ける
 *  （ドメインだけ・メールだけを縦に貼っただけでも登録できるように）。タブ区切り・カンマ区切りを自動判定。 */
export function parseSuppressionText(text: string): SuppressionRow[] {
  const body = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").trim();
  if (!body) return [];
  const firstLine = body.split("\n")[0];
  // 1行目だけで決めると、1行目がドメインだけ（タブ無し）のとき以降のタブ区切り行が分割されない（実際に起きた）。全体で判定する
  // セミコロン区切り（欧州設定のExcel）は、カンマを含まないときだけそう読む（1列だけの貼り付けを壊さないように）
  const delimiter = body.includes("\t") ? "\t" : body.includes(";") && !body.includes(",") ? ";" : ",";
  const headerWords = Object.values(SUPP_ALIASES).flat().map(normHeader);
  const firstCells = firstLine.split(delimiter).map((c) => normHeader(c.trim().replace(/^"|"$/g, "")));
  const hasHeader = firstCells.some((c) => c && headerWords.includes(c));
  let rows: SuppressionRow[];
  if (hasHeader) {
    const recs = parseCsvJp<Record<string, string>[]>(body, { columns: true, delimiter });
    rows = recs.map((r) => ({
      company_name: pick(r, SUPP_ALIASES.company_name),
      domain: domainOf(pick(r, SUPP_ALIASES.domain)),
      email: pick(r, SUPP_ALIASES.email).toLowerCase(),
      tel: pick(r, SUPP_ALIASES.tel),
      reason: pick(r, SUPP_ALIASES.reason),
    }));
  } else {
    const recs = parseCsvJp<string[][]>(body, { columns: false, delimiter });
    rows = recs.map((cells) => {
      const r: SuppressionRow = { company_name: "", domain: "", email: "", tel: "", reason: "" };
      for (const raw of cells) {
        const c = String(raw ?? "").trim();
        if (!c) continue;
        if (!r.email && EMAIL_CELL.test(c)) r.email = c.toLowerCase();
        else if (!r.domain && DOMAIN_CELL.test(c)) r.domain = domainOf(c);
        else if (!r.tel && TEL_CELL.test(c)) r.tel = c;
        else if (!r.company_name) r.company_name = c;
        else if (!r.reason) r.reason = c;
      }
      return r;
    });
  }
  // 会社名が無くても、ドメインかメールがあれば止められるので登録する（表示用の名前はドメイン／メール）
  return rows
    .map((r) => ({ ...r, company_name: r.company_name || r.domain || r.email }))
    .filter((r) => r.company_name);
}

export type SuppressionImportSummary = { added: number; already: number; noKey: number; noKeyNames: string[] };

/** 除外リストに一括登録。ドメインとメールの両方があれば両方で止める */
export function importSuppressions(rows: SuppressionRow[], ownerUserId: number | null, defaultReason: string): SuppressionImportSummary {
  const db = getDb();
  const s: SuppressionImportSummary = { added: 0, already: 0, noKey: 0, noKeyNames: [] };
  const exists = db.prepare("SELECT 1 FROM form_suppressions WHERE domain IS NOT NULL AND domain=?");
  const insert = db.prepare(
    "INSERT INTO form_suppressions(company_name, domain, email, tel, reason, owner_user_id) VALUES(?,?,?,?,?,?)"
  );
  const optout = db.prepare("INSERT OR IGNORE INTO email_optouts(email, reason, owner_user_id) VALUES(?,?,?)");

  const tx = db.transaction(() => {
    for (const r of rows) {
      const hasEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email);
      // ドメインもメールも無い行は、送信を止める手がかりが無いので登録できない
      if (!r.domain && !hasEmail) {
        s.noKey++;
        if (s.noKeyNames.length < 20) s.noKeyNames.push(r.company_name);
        continue;
      }
      if (r.domain && exists.get(r.domain)) {
        s.already++;
        if (hasEmail) optout.run(r.email, `${r.company_name}（除外リスト）`, ownerUserId);
        continue;
      }
      insert.run(r.company_name, r.domain || null, hasEmail ? r.email : null, r.tel, r.reason || defaultReason, ownerUserId);
      if (hasEmail) optout.run(r.email, `${r.company_name}（除外リスト）`, ownerUserId);
      s.added++;
    }
  });
  tx();
  return s;
}
