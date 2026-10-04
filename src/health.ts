// 「動作チェック」画面と「診断ファイル」の中身。
// 動かない原因（ブラウザが無い・メール設定が足りない・住所が無い・空き容量・スリープ）を
// 聞き出すやり取りなしで、利用者自身が画面で切り分けられるようにする。
import fs from "node:fs";
import { S } from "./settings.js";
import os from "node:os";
import path from "node:path";
import { DATA_DIR, getDb, getSetting, jst, type SenderProfile } from "./db.js";
import { topHelpMisses, unsolvedHelp } from "./support.js";
import { browserExecutablePath } from "./engine.js";
import { currentVersion, manifestUrl } from "./update.js";
import { activeProvider, activeAiConfig } from "./message.js";
import { emailPause } from "./email.js";
import { awakeSupported, awakeActive, AWAKE_NOTE } from "./awake.js";
import { autostartEnabled, autostartSupported } from "./autostart.js";
import { listBackups, backupLabel } from "./backup.js";
import { recentLogs, logCounts } from "./applog.js";
import { licenseStatus, licenseEnforced } from "./license.js";

export type CheckLevel = "ok" | "warn" | "ng";
export type Check = { level: CheckLevel; label: string; detail: string; fix?: string };

function diskFreeMb(dir: string): number | null {
  try {
    const st = (fs as unknown as { statfsSync?: (p: string) => { bsize: number; bavail: number } }).statfsSync?.(dir);
    if (!st) return null;
    return Math.round((st.bsize * st.bavail) / 1024 / 1024);
  } catch {
    return null;
  }
}

/** フォーム操作用ブラウザの状況 */
function browserCheck(): Check {
  try {
    const p = browserExecutablePath();
    return p
      ? { level: "ok", label: "フォーム操作用のブラウザ", detail: `パソコンに入っている Chrome / Edge を使います（${path.basename(p)}）` }
      : { level: "ok", label: "フォーム操作用のブラウザ", detail: "Playwright の Chromium を使います" };
  } catch (e) {
    return {
      level: "ng",
      label: "フォーム操作用のブラウザ",
      detail: String((e as Error).message ?? e).slice(0, 160),
      fix: "ターミナルで「npx playwright install chromium」を実行するか、Google Chrome をインストールしてください",
    };
  }
}

export function healthChecks(): Check[] {
  const db = getDb();
  const checks: Check[] = [];

  // Node
  const maj = Number(process.versions.node.split(".")[0]);
  checks.push(maj >= 20
    ? { level: "ok", label: "Node.js", detail: `v${process.versions.node}` }
    : { level: "ng", label: "Node.js", detail: `v${process.versions.node}（古い版です）`, fix: "https://nodejs.org/ から LTS を入れ直してください" });

  checks.push(browserCheck());

  // データフォルダ
  try {
    const probe = path.join(DATA_DIR, ".write-test");
    fs.writeFileSync(probe, "ok");
    fs.rmSync(probe);
    const free = diskFreeMb(DATA_DIR);
    checks.push(free !== null && free < 500
      ? { level: "warn", label: "データの保存先", detail: `${DATA_DIR}（空き ${free.toLocaleString("ja-JP")}MB）`, fix: "空き容量が少ないです。不要なファイルを削除してください" }
      : { level: "ok", label: "データの保存先", detail: `${DATA_DIR}${free !== null ? `（空き ${free.toLocaleString("ja-JP")}MB）` : ""}` });
  } catch (e) {
    checks.push({ level: "ng", label: "データの保存先", detail: `書き込めません: ${String((e as Error).message ?? e).slice(0, 120)}`, fix: "フォルダの権限を確認してください（クラウド同期フォルダ内では動かない場合があります）" });
  }

  // 送信者（メール送信に必要な条件）
  const senders = db.prepare("SELECT * FROM sender_profiles ORDER BY id").all() as SenderProfile[];
  if (!senders.length) {
    checks.push({ level: "warn", label: "送信者", detail: "まだ登録がありません", fix: "「送信者」から会社名・住所・メールを登録してください" });
  } else {
    for (const s of senders) {
      const miss: string[] = [];
      if (!s.company?.trim()) miss.push("会社名");
      if (!s.address?.trim()) miss.push("住所（法律で必要）");
      if (!s.smtp_user || !s.smtp_pass) miss.push("送信用メール（アプリパスワード）");
      const pause = emailPause(s);
      if (miss.length) {
        checks.push({ level: "warn", label: `送信者「${s.label || s.company}」`, detail: `未設定: ${miss.join(" / ")}`, fix: "「送信者」の編集画面で登録してください（住所が無いとメールは送れません）" });
      } else if (pause) {
        checks.push({ level: "warn", label: `送信者「${s.label || s.company}」`, detail: `メール送信を一時停止中: ${pause.reason}`, fix: `${new Date(pause.until).toLocaleString("ja-JP")} に自動で再開します` });
      } else {
        checks.push({ level: "ok", label: `送信者「${s.label || s.company}」`, detail: `メール送信の設定は揃っています（${s.smtp_user}）` });
      }
    }
  }

  // AI（任意）
  const ai = activeAiConfig();
  checks.push(activeProvider() === "none"
    ? { level: "ok", label: "AI（任意）", detail: "未設定。テンプレートでの送信は無料で使えます" }
    : { level: "ok", label: "AI（任意）", detail: `${ai.provider} / ${ai.model}` });

  // スリープ
  checks.push(awakeSupported()
    ? { level: "ok", label: "スリープ対策", detail: `${awakeActive() ? "送信中のため抑止しています" : "送信中だけ自動で抑止します"}`, fix: AWAKE_NOTE }
    : { level: "warn", label: "スリープ対策", detail: "このOSでは自動で抑止できません", fix: AWAKE_NOTE });

  // 自動起動
  checks.push(!autostartSupported()
    ? { level: "warn", label: "ログイン時の自動起動", detail: "このOSでは対応していません" }
    : autostartEnabled()
      ? { level: "ok", label: "ログイン時の自動起動", detail: "オン（パソコンを起動すると自動で立ち上がります）" }
      : { level: "warn", label: "ログイン時の自動起動", detail: "オフ", fix: "設定画面でオンにすると、起動し忘れを防げます" });

  // バックアップ
  const backups = listBackups();
  checks.push(backups.length
    ? { level: Date.now() - Date.parse(backups[0].at) < 48 * 3600_000 ? "ok" : "warn", label: "バックアップ", detail: `最新 ${backupLabel(backups[0])}・${backups.length}件`, fix: "1日1回、自動で取ります（設定画面から復元できます）" }
    : { level: "warn", label: "バックアップ", detail: "まだありません", fix: "設定画面の「いますぐバックアップ」で1つ作っておいてください" });

  // ライセンス（#90）
  {
    const st = licenseStatus();
    checks.push(st.state === "valid"
      ? { level: "ok", label: "ライセンス", detail: st.label }
      : { level: st.state === "none" && !licenseEnforced() ? "ok" : "warn", label: "ライセンス", detail: st.label, fix: licenseEnforced() ? "設定画面でキーを登録してください（未登録のままだと1日50件までに制限されます）" : "制限はかかっていません（設定画面で制限をオンにできます）" });
  }

  // 更新
  checks.push(manifestUrl()
    ? { level: "ok", label: "アップデート", detail: `現在 v${currentVersion()}（更新先の設定あり）` }
    : { level: "warn", label: "アップデート", detail: "更新先が設定されていません", fix: "update.json の manifest_url を確認してください" });

  // 直近のエラー
  const c = logCounts();
  checks.push(c.errors24h === 0
    ? { level: "ok", label: "直近24時間のエラー", detail: "なし" }
    : { level: c.errors24h > 20 ? "warn" : "ok", label: "直近24時間のエラー", detail: `${c.errors24h}件`, fix: "「エラーログ」画面で内容を確認できます" });

  return checks;
}

/** サポートに送ってもらう1ファイル。パスワード・APIキーは入れない */
export function diagnosticsText(): string {
  const db = getDb();
  const L: string[] = [];
  const push = (k: string, v: unknown) => L.push(`${k}: ${v}`);
  L.push("=== ApoBoost 診断ファイル ===");
  push("作成日時", new Date().toLocaleString("ja-JP"));
  push("バージョン", currentVersion());
  push("OS", `${os.platform()} ${os.release()} (${os.arch()})`);
  push("Node.js", process.versions.node);
  push("メモリ", `${Math.round(os.totalmem() / 1024 / 1024 / 1024)}GB（空き ${Math.round(os.freemem() / 1024 / 1024)}MB）`);
  push("稼働時間", `${Math.round(process.uptime() / 60)}分`);
  push("データ保存先", DATA_DIR);
  push("空き容量", `${diskFreeMb(DATA_DIR) ?? "不明"}MB`);
  push("タイムゾーン", Intl.DateTimeFormat().resolvedOptions().timeZone);
  try { push("ブラウザ", browserExecutablePath() ?? "Playwright の Chromium"); } catch (e) { push("ブラウザ", `エラー: ${String((e as Error).message ?? e).slice(0, 120)}`); }
  push("AI", activeProvider());
  push("自動起動", autostartEnabled() ? "オン" : "オフ");
  push("自動更新", getSetting(S.autoUpdate, "0") === "1" ? "オン" : "オフ");
  push("更新チャネル", getSetting(S.updateChannel, "stable") === "beta" ? "先行版" : "安定版");
  push("ライセンス", licenseStatus().label);
  push("通知", getSetting(S.notifyDesktop, "1") === "1" ? "オン" : "オフ");

  L.push("", "--- 件数 ---");
  const one = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  push("送信者", one("SELECT COUNT(*) n FROM sender_profiles"));
  push("キャンペーン", one("SELECT COUNT(*) n FROM form_campaigns"));
  push("会社（全件）", one("SELECT COUNT(*) n FROM form_jobs WHERE is_test=0"));
  push("除外リスト", one("SELECT COUNT(*) n FROM form_suppressions"));
  push("配信停止", one("SELECT COUNT(*) n FROM email_optouts"));
  const byStatus = db.prepare("SELECT status, COUNT(*) n FROM form_jobs WHERE is_test=0 GROUP BY status ORDER BY n DESC").all() as { status: string; n: number }[];
  for (const r of byStatus) push(`  ${r.status}`, r.n);

  // 質問箱で見つからなかった言葉と、解決しなかった答え（どの答えを足せばよいかを配布元が知るため）
  try {
    const misses = topHelpMisses(20), bad = unsolvedHelp(10);
    if (misses.length || bad.length) {
      L.push("", "--- 質問箱 ---");
      for (const m of misses) push(`  見つからなかった言葉「${m.text}」`, `${m.n}回`);
      for (const b of bad) push(`  解決しなかった答え「${b.question}」`, `${b.n}回`);
    }
  } catch { /* 表がまだ無い版 */ }

  L.push("", "--- キャンペーンの状態 ---");
  const camps = db.prepare("SELECT id, name, status, channel, send_only, daily_limit, email_daily_limit FROM form_campaigns ORDER BY id").all() as Record<string, unknown>[];
  for (const c of camps) L.push(`  #${c.id} ${c.name}: ${c.status} / 種別=${c.channel} / 対象=${c.send_only || "すべて"} / 上限 フォーム${c.daily_limit}・メール${c.email_daily_limit}`);

  L.push("", "--- 送信者の設定（パスワードは含みません） ---");
  const senders = db.prepare("SELECT id,label,company,address,smtp_host,smtp_port,smtp_user,from_email,reply_check,tls_insecure,length(smtp_pass) plen FROM sender_profiles ORDER BY id").all() as Record<string, unknown>[];
  for (const s of senders) {
    L.push(`  #${s.id} ${s.label} / 会社=${s.company || "未設定"} / 住所=${s.address ? "あり" : "未設定"} / SMTP=${s.smtp_host}:${s.smtp_port} user=${s.smtp_user || "未設定"} パスワード=${Number(s.plen) ? `設定あり(${s.plen}文字)` : "未設定"} / 受信箱の読み取り=${s.reply_check ? "オン" : "オフ"} / 証明書ゆるめ=${s.tls_insecure ? "オン" : "オフ"}`);
  }

  L.push("", "--- 動作チェック ---");
  for (const c of healthChecks()) L.push(`  [${c.level === "ok" ? "○" : c.level === "warn" ? "△" : "×"}] ${c.label}: ${c.detail}${c.fix ? ` → ${c.fix}` : ""}`);

  L.push("", "--- 直近のエラー・警告（新しい順・最大60件） ---");
  for (const r of recentLogs(60)) L.push(`  ${jst(r.at)} [${r.kind}] ${r.source}${r.company ? ` (${r.company})` : ""}: ${r.text}`);

  L.push("", "--- 直近の失敗した送信（最大30件） ---");
  const fails = db.prepare("SELECT company_name, channel, status, substr(result_text,1,180) t, updated_at FROM form_jobs WHERE is_test=0 AND status IN ('failed','skip_captcha','skip_no_form') ORDER BY updated_at DESC LIMIT 30").all() as Record<string, unknown>[];
  for (const f of fails) L.push(`  ${jst(String(f.updated_at))} ${f.company_name}（${f.channel}/${f.status}）: ${String(f.t).replace(/\s+/g, " ")}`);

  L.push("", "=== ここまで ===");
  return L.join("\n");
}
