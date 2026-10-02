// SQLite 永続層。
// 組み込み時はこのファイルのテーブル定義を本体の schema に足し、getDb() を本体の db に差し替えるだけ。
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export const DATA_DIR = process.env.DATA_DIR ?? path.resolve(process.cwd(), "data");
export const SCREENSHOT_DIR = path.join(DATA_DIR, "screenshots");
export const MATERIAL_DIR = path.join(DATA_DIR, "materials");

let _db: Database.Database | null = null;

/** 復元の予約（設定画面で選んだバックアップ）があれば、DBを開く前に入れ替える。
 *  動いている最中にファイルを差し替えると壊れるため、必ず起動時のこのタイミングで行う。
 *  いまのDBは backups に退避するので、復元してみて違っていたら戻せる */
function applyPendingRestore(): void {
  const marker = path.join(DATA_DIR, "restore-pending.txt");
  const dbFile = path.join(DATA_DIR, "form-outreach.db");
  const backups = path.join(DATA_DIR, "backups");
  let name = "";
  try { name = fs.existsSync(marker) ? fs.readFileSync(marker, "utf8").trim() : ""; } catch { return; }
  if (!name) return;
  try {
    const src = path.join(backups, path.basename(name));
    if (fs.existsSync(src)) {
      if (fs.existsSync(dbFile)) {
        const t = new Date(Date.now() + 9 * 3600_000).toISOString();
        fs.mkdirSync(backups, { recursive: true });
        fs.copyFileSync(dbFile, path.join(backups, `apoboost-${t.slice(0, 10)}_${t.slice(11, 13)}${t.slice(14, 16)}-before-restore.db`));
      }
      for (const suffix of ["-wal", "-shm"]) { const f = dbFile + suffix; if (fs.existsSync(f)) fs.rmSync(f); }
      fs.copyFileSync(src, dbFile);
      console.log(`[apoboost] バックアップ「${path.basename(name)}」から復元しました`);
    }
  } catch (e) {
    console.error("[apoboost] 復元に失敗しました:", e);
  } finally {
    try { fs.rmSync(marker); } catch { /* 無ければ何もしない */ }
  }
}

export function getDb(): Database.Database {
  if (_db) return _db;
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  fs.mkdirSync(MATERIAL_DIR, { recursive: true });
  applyPendingRestore();
  _db = new Database(path.join(DATA_DIR, "form-outreach.db"));
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  migrate(_db);
  return _db;
}

function migrate(db: Database.Database) {
  db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- 送信者プロフィール（社内用 / クライアントごと）。owner_user_id は本体組み込み時に users.id を入れる
  CREATE TABLE IF NOT EXISTS sender_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_user_id INTEGER,
    label TEXT NOT NULL,
    company TEXT NOT NULL,
    industry TEXT DEFAULT '',
    person TEXT NOT NULL,
    person_kana TEXT DEFAULT '',
    email TEXT NOT NULL,
    reply_email TEXT DEFAULT '',      -- フォームで返信を受けるメール（emailと分ける場合）
    tel TEXT DEFAULT '',
    postal TEXT DEFAULT '',
    address TEXT DEFAULT '',
    url TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS form_campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_user_id INTEGER,
    name TEXT NOT NULL,
    sender_id INTEGER NOT NULL REFERENCES sender_profiles(id),
    mode TEXT NOT NULL DEFAULT 'hybrid',      -- template | ai | hybrid
    subject_text TEXT NOT NULL DEFAULT '',
    template_text TEXT NOT NULL DEFAULT '',
    ai_instruction TEXT NOT NULL DEFAULT '',
    daily_limit INTEGER NOT NULL DEFAULT 300,
    send_window_start INTEGER NOT NULL DEFAULT 9,
    send_window_end INTEGER NOT NULL DEFAULT 18,
    weekdays_only INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'draft',     -- draft | running | paused | done
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS form_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER NOT NULL REFERENCES form_campaigns(id) ON DELETE CASCADE,
    company_name TEXT NOT NULL,
    form_url TEXT DEFAULT '',
    site_url TEXT DEFAULT '',
    industry TEXT DEFAULT '',
    sub_industry TEXT DEFAULT '',
    prefecture TEXT DEFAULT '',
    representative TEXT DEFAULT '',
    domain TEXT DEFAULT '',
    is_test INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'queued',
      -- queued | sending | sent | skip_no_form | skip_refused | skip_captcha | skip_suppressed | skip_duplicate | failed
    message_used TEXT DEFAULT '',
    result_text TEXT DEFAULT '',
    screenshot_path TEXT DEFAULT '',
    attempts INTEGER NOT NULL DEFAULT 0,
    sent_at TEXT,
    updated_at TEXT DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_form_jobs_campaign ON form_jobs(campaign_id, status);
  CREATE INDEX IF NOT EXISTS idx_form_jobs_domain ON form_jobs(domain, status);

  -- 全キャンペーン横断の除外リスト（お断り検知・返信で停止希望・手動DNC）
  CREATE TABLE IF NOT EXISTS form_suppressions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    domain TEXT NOT NULL UNIQUE,
    reason TEXT NOT NULL DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- 企業HPの本文キャッシュ（AI個別化用。1社1回だけ取得）
  CREATE TABLE IF NOT EXISTS email_optouts (
    email TEXT PRIMARY KEY,
    reason TEXT NOT NULL DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS site_cache (
    domain TEXT PRIMARY KEY,
    title TEXT DEFAULT '',
    text TEXT DEFAULT '',
    fetched_at TEXT DEFAULT (datetime('now'))
  );
  `);
  const addCol = (table: string, col: string, def: string) => {
    const cols = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
    if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
  };
  addCol("form_campaigns", "channel", "TEXT NOT NULL DEFAULT 'both'");
  addCol("form_campaigns", "email_daily_limit", "INTEGER NOT NULL DEFAULT 100");
  addCol("form_jobs", "channel", "TEXT NOT NULL DEFAULT 'form'");
  addCol("form_jobs", "email", "TEXT NOT NULL DEFAULT ''");
  addCol("form_jobs", "scanned_at", "TEXT");
  addCol("form_jobs", "scan_note", "TEXT NOT NULL DEFAULT ''");
  addCol("form_campaigns", "resend_days", "INTEGER NOT NULL DEFAULT 90");   // 同じ会社への再送禁止期間（0=制限なし）
  addCol("form_campaigns", "ignore_refusal", "INTEGER NOT NULL DEFAULT 0"); // 1=営業お断りのサイトにも送る（非推奨）

  // ---- ログイン（単体版）----
  db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',   -- admin | user
    active INTEGER NOT NULL DEFAULT 1,
    must_change INTEGER NOT NULL DEFAULT 0,
    last_login_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  `);
  // 誰が登録したか（一覧表示の出し分け用。突合そのものは全体共通のまま＝安全側）
  addCol("form_suppressions", "owner_user_id", "INTEGER");

  // 除外リストに会社名・メール・電話を持たせる（ドメイン不明でメールだけ、という登録もあるため作り直す）
  {
    const cols = (db.prepare("PRAGMA table_info(form_suppressions)").all() as { name: string }[]).map((c) => c.name);
    if (!cols.includes("company_name")) {
      db.exec(`
        CREATE TABLE form_suppressions_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          company_name TEXT NOT NULL DEFAULT '',
          domain TEXT,
          email TEXT,
          tel TEXT NOT NULL DEFAULT '',
          reason TEXT NOT NULL DEFAULT '',
          owner_user_id INTEGER,
          created_at TEXT DEFAULT (datetime('now'))
        );
        INSERT INTO form_suppressions_new(id, domain, reason, owner_user_id, created_at)
          SELECT id, NULLIF(domain,''), reason, owner_user_id, created_at FROM form_suppressions;
        DROP TABLE form_suppressions;
        ALTER TABLE form_suppressions_new RENAME TO form_suppressions;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_supp_domain ON form_suppressions(domain) WHERE domain IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_supp_email ON form_suppressions(email);
      `);
    }
  }
  addCol("email_optouts", "owner_user_id", "INTEGER");
  addCol("form_jobs", "outcome", "TEXT NOT NULL DEFAULT ''");
  addCol("form_jobs", "outcome_note", "TEXT NOT NULL DEFAULT ''");
  addCol("sender_profiles", "from_email", "TEXT NOT NULL DEFAULT ''");
  addCol("sender_profiles", "smtp_host", "TEXT NOT NULL DEFAULT 'smtp.gmail.com'");
  addCol("sender_profiles", "smtp_port", "INTEGER NOT NULL DEFAULT 465");
  addCol("sender_profiles", "smtp_user", "TEXT NOT NULL DEFAULT ''");
  addCol("sender_profiles", "smtp_pass", "TEXT NOT NULL DEFAULT ''");
  // リトライで送信済みになったとき、直前の失敗ステータスを覚えておく（履歴表示用）
  addCol("form_jobs", "prev_status", "TEXT NOT NULL DEFAULT ''");
  addCol("form_jobs", "prev_result", "TEXT NOT NULL DEFAULT ''");
  // 資料添付（メールは添付ファイル、フォームは本文にリンク）
  addCol("form_campaigns", "material_url", "TEXT NOT NULL DEFAULT ''");
  addCol("form_campaigns", "attach_path", "TEXT NOT NULL DEFAULT ''");
  addCol("form_campaigns", "attach_name", "TEXT NOT NULL DEFAULT ''");
  // 要確認: 回答を決められなかった質問（JSON）と、画面で利用者が選んだ回答（JSON）
  addCol("form_jobs", "pending_questions", "TEXT NOT NULL DEFAULT ''");
  addCol("form_jobs", "manual_answers", "TEXT NOT NULL DEFAULT ''");
  // 1=フォームで電話番号が必須の欄にだけ入力する（任意の欄には書かない。電話を載せたくない人向け）
  addCol("sender_profiles", "tel_required_only", "INTEGER NOT NULL DEFAULT 0");
  // キャンペーンのグループ名。同じグループ内では同じ会社に重ねて送らない（フォーム用とメール用で分けた場合など）。空=グループなし
  addCol("form_campaigns", "group_name", "TEXT NOT NULL DEFAULT ''");
  // 取り込み1回ぶんの記録。間違えて取り込んだとき、その取り込みで入った会社をまとめて消せるようにする
  db.exec(`CREATE TABLE IF NOT EXISTS form_imports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER NOT NULL,
    src_label TEXT NOT NULL DEFAULT '',
    rows_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  // どの取り込みで入った会社か（form_imports.id）。この列ができる前に取り込んだ会社は NULL（取り込み時刻の近さで1回ぶんとみなす）
  addCol("form_jobs", "import_id", "INTEGER");
  // 1=資料の公開リンクをメール本文にも載せる（重い添付をやめてリンクで送る場合）。0=フォーム本文だけ（従来）
  addCol("form_campaigns", "material_url_in_email", "INTEGER NOT NULL DEFAULT 0");
  // 1=送信用メールの受信箱を読んで、返信（反応）と戻りメールを自動で記録する。0=読まない
  addCol("sender_profiles", "reply_check", "INTEGER NOT NULL DEFAULT 1");
  // 1=メールサーバーの証明書の検証をゆるめる。セキュリティソフトや社内ネットワークが通信に割り込んでいて
  // 「self-signed certificate in certificate chain」で送れないPC向けの回避策（既定はオフ）
  addCol("sender_profiles", "tls_insecure", "INTEGER NOT NULL DEFAULT 0");
  // 送る対象の絞り込み。''=すべて / 'email'=メールの会社だけ / 'form'=フォームの会社だけ。
  // 「メールだけ先に送りたい（フォームは事前チェックしてから）」という使い方のため。開始のたびに選び直せる
  addCol("form_campaigns", "send_only", "TEXT NOT NULL DEFAULT ''");
  // おまけのゲームの表示。新しく入れたPCでは最初は出さない（他社に配ったときに「ふざけている」と見られないように）。
  // この設定ができる前から使っていたPC（キャンペーンがある）は、これまで通り表示にしておく
  if (!db.prepare("SELECT 1 FROM settings WHERE key='game_enabled'").get()) {
    const used = (db.prepare("SELECT COUNT(*) n FROM form_campaigns").get() as { n: number }).n > 0;
    db.prepare("INSERT INTO settings(key,value) VALUES('game_enabled',?)").run(used ? "1" : "0");
  }

  // メールの送信数を少しずつ増やす（ウォームアップ）。新しいアカウントでいきなり大量に送ると止められるため既定でオン
  addCol("form_campaigns", "email_warmup", "INTEGER NOT NULL DEFAULT 1");
  // メールで使う送信者を増やす（カンマ区切りの sender_profiles.id）。1日の上限に達したら次のアカウントへ切り替える
  addCol("form_campaigns", "email_sender_ids", "TEXT NOT NULL DEFAULT ''");
  // どの送信者アカウントから送ったか（アカウントごとの1日の送信数を数えるため）
  addCol("form_jobs", "sent_by_sender", "INTEGER");
  // 配信停止ページのURL（Googleフォーム等）。設定すると、メールの配信停止がクリック1回で済む
  addCol("sender_profiles", "unsubscribe_url", "TEXT NOT NULL DEFAULT ''");

  // 返信の自動判定を、人の直しから学ぶための言い回し集（#25）
  db.exec(`CREATE TABLE IF NOT EXISTS reply_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phrase TEXT NOT NULL,
    outcome TEXT NOT NULL,          -- replied | appointment | declined
    source TEXT NOT NULL DEFAULT '',-- どの会社の返信から覚えたか
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_reply_rules_phrase ON reply_rules(phrase, outcome)`);

  // チームで共有する「他のメンバーが送信済みの会社」（#78）。同じ会社に二重で当たらないようにする
  db.exec(`CREATE TABLE IF NOT EXISTS shared_sent (
    domain TEXT PRIMARY KEY,
    company_name TEXT NOT NULL DEFAULT '',
    member TEXT NOT NULL DEFAULT '',
    sent_at TEXT NOT NULL DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  // 文面のA/Bテスト（#64）と、件名のローテーション（#65）
  addCol("form_campaigns", "ab_enabled", "INTEGER NOT NULL DEFAULT 0");
  addCol("form_campaigns", "template_b", "TEXT NOT NULL DEFAULT ''");
  addCol("form_campaigns", "subject_b", "TEXT NOT NULL DEFAULT ''");
  addCol("form_campaigns", "subject_alts", "TEXT NOT NULL DEFAULT ''"); // 1行1件名。順番に使う
  addCol("form_jobs", "variant", "TEXT NOT NULL DEFAULT ''");           // A / B（A/Bテストでどちらの文面を送ったか）

  // 削除の取り消し（#60）。消した会社の行をそのまま控えておき、30分以内なら元に戻せるようにする
  db.exec(`CREATE TABLE IF NOT EXISTS deleted_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER NOT NULL,
    user_id INTEGER,
    label TEXT NOT NULL DEFAULT '',
    rows_count INTEGER NOT NULL DEFAULT 0,
    payload TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  // 1=送信用Gmailの受信箱を振り分ける（自動返信・届かなかったメールはラベルに移して受信箱から外す。アポ・返信はラベルを付ける）
  addCol("sender_profiles", "inbox_sort", "INTEGER NOT NULL DEFAULT 1");

  // 事前チェックで出す「送れそう度」0〜100（-1=未計測）。送れる会社から先に回せるようにする
  addCol("form_jobs", "scan_score", "INTEGER NOT NULL DEFAULT -1");

  // 一覧と集計を速くするためのインデックス（#143）。4,000社を超えると、更新日時での並び替えや反応の集計が重くなり始める
  db.exec(`CREATE INDEX IF NOT EXISTS idx_form_jobs_updated ON form_jobs(campaign_id, updated_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_form_jobs_outcome ON form_jobs(outcome)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_form_jobs_status_updated ON form_jobs(status, updated_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_form_jobs_sent_at ON form_jobs(sent_at)`);
  // 要対応を「見送り」にした日時（#115）。NULL=見送っていない
  addCol("form_jobs", "dismissed_at", "TEXT");
  addCol("form_jobs", "appo_seen_at", "TEXT");                           // アポを「確認した」日時。空＝未確認（メニューの数字に数える）

  // 画面で見られるエラーログ。これまでは黒い画面（ターミナル）を見るしかなく、閉じると何も分からなかった。
  // 直近500件だけ残す（applog.ts 側で間引く）
  db.exec(`CREATE TABLE IF NOT EXISTS app_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT DEFAULT (datetime('now')),
    kind TEXT NOT NULL DEFAULT 'error',   -- error | warn | info
    source TEXT NOT NULL DEFAULT '',      -- どこで起きたか（worker / email / update 等）
    company TEXT NOT NULL DEFAULT '',
    text TEXT NOT NULL DEFAULT ''
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_app_logs_kind ON app_logs(kind, id)`);

  // 右下のキャラクター（演出）。ゲームと同じく、新しく入れたPCでは最初は出さない（他社の管理画面として軽く見えないように）。
  // この設定ができる前から使っていたPCは、これまで通り表示にしておく
  if (!db.prepare("SELECT 1 FROM settings WHERE key='effects_enabled'").get()) {
    const used = (db.prepare("SELECT COUNT(*) n FROM form_campaigns").get() as { n: number }).n > 0;
    db.prepare("INSERT INTO settings(key,value) VALUES('effects_enabled',?)").run(used ? "1" : "0");
  }

  // v0.3.51 で「送信後の判定不能」を一律「送信済み（完了画面を確認できず・要確認）」に書き換えたが、
  // 届いたかは会社によって違うため取り消した。その書き換えを元の「失敗（送信後の判定不能）」に戻す。
  // v0.3.51〜0.3.53 の送信で付いた同じ文言も対象（当時の判定ロジックでは失敗だったもの）。
  // 一致するのは書き換え済みの行だけなので、毎回起動時に流しても結果は変わらない。配布先もアップデート後の起動で戻る。
  db.prepare(`UPDATE form_jobs
    SET status='failed',
        sent_at=NULL,
        result_text='送信後の判定不能: ' || substr(result_text, length('送信済み（完了画面を確認できず・要確認）: ') + 1)
    WHERE is_test=0 AND status='sent' AND result_text LIKE '送信済み（完了画面を確認できず・要確認）: %'`).run();
}

export type Channel = "form" | "email" | "both";

export type SenderProfile = {
  id: number;
  owner_user_id: number | null;
  label: string;
  company: string;
  industry: string;
  person: string;
  person_kana: string;
  email: string;
  reply_email: string;
  tel: string;
  postal: string;
  address: string;
  url: string;
  from_email: string;
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  smtp_pass: string;
  tel_required_only: number;
  reply_check: number;
  tls_insecure: number;
  unsubscribe_url: string;
  inbox_sort: number;
};

export type User = {
  id: number;
  username: string;
  display_name: string;
  password_hash: string;
  role: "admin" | "user";
  active: number;
  must_change: number;
  last_login_at: string | null;
  created_at: string;
};

export type Campaign = {
  id: number;
  owner_user_id: number | null;
  name: string;
  sender_id: number;
  mode: "template" | "ai" | "hybrid" | "tpl_ai";
  subject_text: string;
  template_text: string;
  ai_instruction: string;
  daily_limit: number;
  send_window_start: number;
  send_window_end: number;
  weekdays_only: number;
  channel: Channel;
  email_daily_limit: number;
  resend_days: number;
  ignore_refusal: number;
  status: "draft" | "running" | "paused" | "done";
  material_url: string;   // フォーム送信で本文に載せる資料の公開リンク
  attach_path: string;    // メール添付する資料ファイルの保存先（DATA_DIR/materials 配下）
  attach_name: string;    // 添付時に見せるファイル名
  group_name: string;     // 同じグループ内では同じ会社に重ねて送らない。空=グループなし
  material_url_in_email: number;
  send_only: string;
  email_warmup: number;
  email_sender_ids: string;
  ab_enabled: number;
  template_b: string;
  subject_b: string;
  subject_alts: string;
};

// フリーメールはドメインが同じでも別の会社。グループ内の重複判定ではドメインではなくメールアドレスで比べる
export const FREE_MAIL_DOMAINS = new Set(["gmail.com", "googlemail.com", "yahoo.co.jp", "ymail.ne.jp", "yahoo.com", "outlook.jp", "outlook.com", "hotmail.com", "hotmail.co.jp", "live.jp", "live.com", "icloud.com", "me.com", "mac.com", "aol.com", "docomo.ne.jp", "ezweb.ne.jp", "au.com", "softbank.ne.jp", "i.softbank.jp", "nifty.com", "biglobe.ne.jp", "ocn.ne.jp", "so-net.ne.jp", "excite.co.jp", "goo.jp", "infoseek.jp"]);

/** 同じグループの別キャンペーンで、この会社（ドメイン／フリーメールならアドレス）がすでに対象になっているか。
 *  statuses に含まれる状態のジョブがあれば、そのキャンペーン名を返す。グループなしなら常に null */
export function findGroupDuplicate(db: Database.Database, opts: { groupName: string; campaignId: number; domain: string; email: string; statuses: string[]; excludeJobId?: number }): string | null {
  if (!opts.groupName || !opts.domain) return null;
  const ph = opts.statuses.map(() => "?").join(",");
  const byEmail = FREE_MAIL_DOMAINS.has(opts.domain);
  if (byEmail && !opts.email) return null;
  const row = db.prepare(`SELECT c.name FROM form_jobs j JOIN form_campaigns c ON c.id=j.campaign_id
    WHERE c.group_name=? AND j.campaign_id<>? AND j.is_test=0 AND j.status IN (${ph}) AND j.id<>?
      AND ${byEmail ? "lower(j.email)=lower(?)" : "j.domain=?"} LIMIT 1`)
    .get(opts.groupName, opts.campaignId, ...opts.statuses, opts.excludeJobId ?? -1, byEmail ? opts.email : opts.domain) as { name: string } | undefined;
  return row?.name ?? null;
}

export type JobStatus =
  | "queued"
  | "sending"
  | "sent"
  | "skip_no_form"
  | "skip_refused"
  | "skip_captcha"
  | "skip_suppressed"
  | "skip_duplicate"
  | "skip_optout"
  | "skip_cancelled"
  | "failed";

export type Job = {
  id: number;
  campaign_id: number;
  company_name: string;
  form_url: string;
  site_url: string;
  industry: string;
  sub_industry: string;
  prefecture: string;
  representative: string;
  domain: string;
  is_test: number;
  channel: "form" | "email";
  email: string;
  scanned_at: string | null;
  scan_note: string;
  scan_score: number;
  outcome: string;
  outcome_note: string;
  status: JobStatus;
  message_used: string;
  result_text: string;
  screenshot_path: string;
  attempts: number;
  sent_at: string | null;
  updated_at: string;
  prev_status: string;
  prev_result: string;
  pending_questions: string;
  manual_answers: string;
  variant: string;
  dismissed_at: string | null;
};

export const STATUS_LABEL: Record<JobStatus, string> = {
  queued: "待機中",
  sending: "送信中",
  sent: "送信済み",
  skip_no_form: "フォーム無し",
  skip_refused: "営業お断り",
  skip_captcha: "画像認証",
  skip_suppressed: "除外リスト",
  skip_duplicate: "90日以内に送信済",
  skip_optout: "配信停止済",
  skip_cancelled: "キャンセル",
  failed: "失敗",
};

// 配信チャネルの4モード。旧値（both/form/email）も受け取れるように正規化する。
export type ChannelMode = "form_first" | "email_first" | "email_only" | "form_only";
export function channelMode(raw: string | null | undefined): ChannelMode {
  switch (raw) {
    case "form_first": case "both": return "form_first";
    case "email_first": return "email_first";
    case "email_only": case "email": return "email_only";
    case "form_only": case "form": return "form_only";
    default: return "form_first";
  }
}
export const CHANNEL_LABEL: Record<ChannelMode, string> = {
  form_first: "フォーム優先（無ければメール）",
  email_first: "メール優先（無ければフォーム）",
  email_only: "メールのみ",
  form_only: "フォームのみ",
};
/** このモードで、フォームが無い会社をメールに切り替えてよいか（事前チェックで使う） */
export const allowsEmailFallback = (raw: string) => { const m = channelMode(raw); return m === "form_first" || m === "email_first"; };

/** DBの日時（SQLite の datetime('now') ＝ 世界標準時 "YYYY-MM-DD HH:MM:SS"）を東京の時刻 "YYYY-MM-DD HH:MM" にする。
 *  以前は画面にそのまま出していたため、9時間ずれて見えていた */
export function jst(ts: string | null | undefined): string {
  if (!ts) return "";
  const d = new Date(String(ts).replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(ts)) ? "" : "Z"));
  if (isNaN(d.getTime())) return String(ts);
  const t = new Date(d.getTime() + 9 * 3600_000).toISOString();
  return `${t.slice(0, 10)} ${t.slice(11, 16)}`;
}

export function domainOf(url: string): string {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

// 官公庁・学校・医療機関など既定で除外するドメイン
export const EXCLUDED_DOMAIN_SUFFIXES = [".go.jp", ".lg.jp", ".ac.jp", ".ed.jp"];

export function isExcludedDomain(domain: string): boolean {
  return EXCLUDED_DOMAIN_SUFFIXES.some((s) => domain.endsWith(s));
}

export function getSetting(key: string, fallback = ""): string {
  const row = getDb().prepare("SELECT value FROM settings WHERE key=?").get(key) as { value: string } | undefined;
  return row?.value ?? fallback;
}
export function setSetting(key: string, value: string) {
  getDb().prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, value);
}

export const OUTCOME_LABEL: Record<string, string> = { "": "—", replied: "返信あり", appointment: "アポ獲得", declined: "断り・不要" };
