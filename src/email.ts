// メール送信（自分のGmail / Google Workspace 等のSMTP）。差出人はクライアント自身のアカウント。
import nodemailer from "nodemailer";
import { getDb, getSetting, setSetting, type SenderProfile } from "./db.js";

export function senderEmailOk(sender: SenderProfile): { ok: boolean; reason?: string; from: string } {
  if (!sender.smtp_user || !sender.smtp_pass) return { ok: false, reason: "送信用メールアカウント（ユーザー名・アプリパスワード）が未設定です", from: "" };
  // 特定電子メール法で、営業メールには送信者の名称・住所・配信停止の連絡先の表示が必要。欠けていれば送らない
  if (!sender.company?.trim()) return { ok: false, reason: "送信者の会社名が未登録です（営業メールには送信者の名称の表示が必要です）", from: "" };
  if (!sender.address?.trim()) return { ok: false, reason: "送信者の住所が未登録です。営業メールには住所の表示が法律で必要なため、送信者プロフィールに住所を登録してください", from: "" };
  return { ok: true, from: (sender.from_email || sender.smtp_user).trim().toLowerCase() };
}

/** アプリパスワードの空白を取り除く（SMTP と受信箱の読み取り IMAP の両方で使う）。
 *  Googleのアプリパスワードは「abcd efgh ijkl mnop」の形でコピーされ、貼り付け元によっては空白が
 *  ノーブレークスペース（NBSP）・全角空白・ゼロ幅空白・連続した空白になる（日本語入力のまま打つと英字も全角になる）。
 *  空白を除いて英字16文字になるときだけ詰める。それ以外のパスワードは空白を含むこともあるので、前後の空白だけ除く */
export function normalizeAppPassword(pass: string): string {
  const p = String(pass ?? "").replace(/^[\s​﻿]+|[\s​﻿]+$/g, "");
  const compact = p.replace(/[\s 　​﻿]+/g, "").normalize("NFKC");
  return /^[a-z]{16}$/i.test(compact) ? compact : p;
}
const normalizePass = normalizeAppPassword;

/** 送信サーバーが Google（Gmail・Google Workspace）か。
 *  以前はホスト名に「google」を含むかで見ていたため、既定の smtp.gmail.com が当たらず、独自ドメインの Workspace を見逃していた */
export function isGoogleSmtp(sender: Pick<SenderProfile, "smtp_host">): boolean {
  const host = (sender.smtp_host || "smtp.gmail.com").trim().toLowerCase();
  return /(^|\.)(gmail|googlemail|google)\.com$/.test(host);
}

/** よくある入力ミスを、送信前に気づけるようにする */
export function checkSmtpPassword(sender: SenderProfile): string | null {
  const p = normalizePass(sender.smtp_pass);
  if (isGoogleSmtp(sender) && !/^[a-z]{16}$/i.test(p)) {
    return "Googleのアプリパスワードは英小文字16文字です（例: abcdefghijklmnop）。いま入っているのは形が違います。ふだんGmailにログインするパスワードではなく、Googleアカウント → セキュリティ → 2段階認証プロセス → アプリパスワード で作った16文字を入れてください";
  }
  return null;
}

type MailLogger = Record<"trace" | "debug" | "info" | "warn" | "error" | "fatal", (entry: { tnx?: string } | undefined, ...rest: unknown[]) => void>;

function transport(sender: SenderProfile, extra: { logger?: MailLogger; timeoutMs?: number } = {}) {
  const port = Number(sender.smtp_port) || 465;
  return nodemailer.createTransport({
    host: (sender.smtp_host || "smtp.gmail.com").trim(), port, secure: port === 465,
    auth: { user: (sender.smtp_user || "").trim(), pass: normalizePass(sender.smtp_pass) },
    // 既定の待ち時間（接続2分・無通信10分）だと、つながらないときに1社で何分も止まる。
    // 無通信の判定は「何も届かない時間」なので、大きな添付でも送っている間は切れない
    connectionTimeout: extra.timeoutMs ?? 30_000,
    greetingTimeout: extra.timeoutMs ?? 30_000,
    socketTimeout: extra.timeoutMs ?? 120_000,
    ...(extra.logger ? { logger: extra.logger } : {}),
    // セキュリティソフト等が通信に割り込むPCでは証明書が差し替わり「self-signed certificate」で送れない。
    // 送信者ごとに明示的にオンにしたときだけ、証明書の検証をゆるめる
    ...(sender.tls_insecure ? { tls: { rejectUnauthorized: false } } : {}),
  });
}

/** nodemailer のエラーから、分類に使う値を取り出す。responseCode / command は nodemailer が付ける。
 *  付いていない（文字列だけの）エラーでも、本文の「535-5.7.8」のような形から応答コードを拾う */
type SmtpErr = { raw: string; code: string; command: string; rc: number; unknownDelivery: boolean };
function smtpErr(e: unknown): SmtpErr {
  const x = (e ?? {}) as { message?: string; response?: string; code?: string; responseCode?: number; command?: string; deliveryUnknown?: boolean };
  const raw = `${String(x.message ?? e)} ${String(x.response ?? "")}`.trim();
  const rc = Number(x.responseCode) || Number(raw.match(/(?:^|[\s:])([45]\d\d)[ -]?\d\.\d{1,3}\.\d{1,3}/)?.[1]) || Number(raw.match(/^([45]\d\d)\b/)?.[1]) || 0;
  return { raw, code: String(x.code ?? ""), command: String(x.command ?? "").toUpperCase(), rc, unknownDelivery: Boolean(x.deliveryUnknown) && !x.responseCode };
}

// 送信用アカウント側の「1日の上限」。Gmail は 550 5.4.5、Microsoft は RefuseQuota / 5.1.90 など。
// 「quota exceeded」だけでは宛先の受信箱がいっぱい（552 5.2.2）と区別できないので、ここには入れない
const SENDER_LIMIT_RE = /Daily (user )?(sending|SMTP relay) (limit|quota)|\b5\.4\.5\b|reached your daily limit|RefuseQuota|OutboundSpamException|\b5\.1\.90\b/i;
const AUTH_RE = /BadCredentials|Username and Password not accepted|Application-specific password|log in via your web browser|\b5\.7\.(8|9|14)\b|Invalid login|authentication failed|AUTHENTICATIONFAILED/i;
const NET_RE = /ETIMEDOUT|ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|ECONNRESET|EPIPE|ESOCKET|EDNS|getaddrinfo|Greeting never received|Connection closed|Unexpected socket close|socket hang up|wrong version number|Connection timeout|^Timeout/i;
const SENDER_REJECT_RE = /not owned by user|sender address rejected|sender (is )?not allowed|SendAsDenied|from address|5\.7\.60/i;

/** SMTPの生エラーを、原因と直し方がわかる日本語にする */
export function explainSmtpError(e: unknown, sender: SenderProfile): string {
  const { raw, command, rc, unknownDelivery } = smtpErr(e);
  const host = (sender.smtp_host || "smtp.gmail.com").trim();
  const google = isGoogleSmtp(sender);
  if (unknownDelivery) return "送信の最後でメールサーバーとの通信が切れたため、送れたかどうか分かりません（同じ相手に二重に送らないよう、送信済みフォルダで確認します）";
  if (SENDER_LIMIT_RE.test(raw)) return google ? "Gmailの1日の送信上限に達しました。翌日まで待つか、1日の上限を下げてください" : "送信用アカウントの1日の送信上限に達しました。翌日まで待つか、1日の上限を下げてください";
  if (/Application-specific password required|\b5\.7\.9\b/i.test(raw)) return "このアカウントは2段階認証が必要です。Googleアカウントで2段階認証プロセスをオンにしてから、アプリパスワードを作り直してください";
  if (/log in via your web browser|\b5\.7\.14\b/i.test(raw)) return "Googleがこのログインを一時的に止めています。ブラウザでこのGoogleアカウントにログインし、表示されるセキュリティの確認を済ませてから、もう一度試してください";
  if (rc === 535 || rc === 534 || command.startsWith("AUTH") || AUTH_RE.test(raw)) {
    // ログイン拒否の直し方はサービスごとに違う。以前は Google の案内しか出さず、Outlook 等の利用者が迷っていた
    if (google) {
      const hint = checkSmtpPassword(sender);
      return `Googleにログインを拒否されました。${hint ?? "アプリパスワードが失効しているか、送信用メールアドレスが違う可能性があります"}`;
    }
    if (/office365|outlook|hotmail|live\.com/i.test(host)) return "Microsoft（Outlook / Microsoft 365）にログインを拒否されました。送信用メールアドレスとパスワード（2段階認証を使っている場合はアプリパスワード）を確認してください。Microsoft 365 は、管理者が「SMTP認証（SMTP AUTH）」を有効にしていないと送れません";
    if (/yahoo/i.test(host)) return "Yahoo!メールにログインを拒否されました。Yahoo!メールの設定で「IMAP/POP/SMTPアクセス」を有効にし、送信用メールアドレスとパスワードを確認してください";
    if (/icloud|me\.com|mac\.com/i.test(host)) return "iCloudにログインを拒否されました。Apple IDの設定で「App用パスワード」を作り、それをパスワード欄に入れてください";
    return `メールサーバー（${host}）にログインを拒否されました。送信用メールアドレス（ユーザー名）とパスワードを確認してください`;
  }
  if (/wrong version number|Greeting never received|ssl3_get_record|EPROTO\b|packet length too long/i.test(raw)) return `ポート番号（${sender.smtp_port || 465}）と暗号化の方式が合っていないようです。465番は最初から暗号化（SSL/TLS）、587番は途中から暗号化（STARTTLS）です。プロバイダの案内どおり465か587を入れてください（分からなければ465）`;
  if (/self.signed|unable to verify|certificate|CERT_/i.test(raw)) return "メールサーバーの証明書を確認できませんでした。セキュリティソフト（ESET・カスペルスキー等）や社内ネットワークがメール通信に割り込んでいる可能性があります。ソフトの「メール保護／SSLスキャン」をオフにするか、送信者プロフィールの「セキュリティソフトの影響で送れない場合」にチェックを入れてください";
  if (command === "MAIL FROM" && (rc === 553 || SENDER_REJECT_RE.test(raw))) return "差出人のアドレスを、この送信用アカウントでは使えないと断られました。送信者の「差出人として表示するアドレス」を空にするか、送信用アカウントで送信を許可されたアドレス（Gmailなら「他のアドレスからメールを送信」に登録したもの）にしてください";
  if (/ECONNRESET|socket hang up|Connection closed|Unexpected socket close|EPIPE/i.test(raw)) return "メールサーバーとの通信が途中で切れました。回線が不安定か、セキュリティソフト・VPN・社内ネットワークがメールの通信を止めている可能性があります。続く場合はセキュリティソフトのメール保護をオフにして試してください";
  if (/ETIMEDOUT|ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|EDNS|getaddrinfo|Connection timeout|^Timeout/i.test(raw)) return `メールサーバー（${host}:${sender.smtp_port || 465}）に接続できませんでした。ネットワークかSMTPホスト名・ポートを確認してください`;
  if (/\b5\.1\.1\b|user unknown|does not exist|no such user|address not found|recipient address rejected/i.test(raw)) return "宛先のメールアドレスが存在しません（アドレスの書き間違い・退職・廃止の可能性）";
  if (/\b5\.2\.2\b|mailbox (is )?full|over ?quota|quota exceeded/i.test(raw)) return "相手の受信箱がいっぱいで受け取ってもらえませんでした";
  if (/\b5\.3\.4\b|size exceeds|message (is )?too (large|big)|larger than allowed/i.test(raw)) return "メールが大きすぎて送れませんでした。添付ファイルを小さくするか、資料はリンクで送ってください";
  if (rc >= 400 && rc < 500) return `相手のメールサーバーが一時的に受け取りを断りました（${rc}）。時間を置いて自動で送り直します`;
  if (rc >= 500 && /\b5\.7\.\d+\b|spam|policy|blocked|rejected/i.test(raw)) return `相手のメールサーバーに受け取りを拒否されました（${rc}・迷惑メール対策や受信制限の可能性）`;
  return raw.slice(0, 200);
}

// ---- メール送信の一時停止 ----
// Gmail にログインを拒否された・一時停止された・1日の上限に達した・つながらない、のときに、
// 残りの会社を次々と「失敗」にしていた（実例: アカウント停止中に180件が数分で失敗）。
// 送信用アカウント単位で一定時間メール送信を止め、その会社は待機に戻す。停止中に何度もログインを試すと解除が遅れるため。
export type EmailPause = { until: number; reason: string };
const pauseKey = (sender: SenderProfile) => `email_pause:${(sender.smtp_user || `sender-${sender.id}`).trim().toLowerCase()}`;

/** 送信エラーの分け方。
 *  - unknown:   本文（DATA）を送り切った後に通信が切れた。届いているかもしれないので、送り直さず送信済みフォルダで確かめる
 *  - pause:     送信用アカウント側・回線側の問題。どの会社に送っても同じなので、アカウント単位で止めて待機に戻す
 *               （penalty=ウォームアップを1段下げる。上限・ログイン拒否のときだけ）
 *  - temporary: 宛先側の一時的な拒否（4xx）。少し置いて回数を限って送り直す
 *  - permanent: この宛先には送れない（5xx の宛先拒否など）。この会社だけ失敗にする
 *  以前は文字列の一致だけで判定していて、宛先の「552 5.2.2 Quota exceeded（受信箱がいっぱい）」で
 *  アカウントごと24時間止まったり、421/454 以外の 4xx を1回で失敗にしたり、本文を送った後の通信断で同じ相手に再送したりしていた */
export type SmtpErrorClass =
  | { kind: "unknown" }
  | { kind: "pause"; minutes: number; penalty: boolean }
  | { kind: "temporary" }
  | { kind: "permanent" };

export function classifySmtpError(e: unknown): SmtpErrorClass {
  const { raw, code, command, rc, unknownDelivery } = smtpErr(e);
  if (unknownDelivery) return { kind: "unknown" };
  // 送信用アカウントの1日の上限（どの段階で返ってきても、アカウント側の話）
  if (SENDER_LIMIT_RE.test(raw)) return { kind: "pause", minutes: 24 * 60, penalty: true };
  // ログイン拒否・アカウントの一時停止（AUTH の段階で返るもの）
  if (code === "EAUTH" || command.startsWith("AUTH") || ((rc === 534 || rc === 535) && !command) || AUTH_RE.test(raw)) return { kind: "pause", minutes: 60, penalty: true };
  // Gmail の「しばらく待ってから」（送りすぎ・ログインのしすぎ）。宛先ではなくこちらのアカウントへの制限
  if (/\b(421|454)[- ]?4\.7\.0\b/.test(raw)) return { kind: "pause", minutes: 60, penalty: true };
  // 差出人（MAIL FROM）の段階で断られた＝送信用アカウントや差出人アドレスの問題。どの会社に送っても同じ
  if (command === "MAIL FROM" && rc) {
    if (rc < 500) return { kind: "pause", minutes: 15, penalty: false };
    if (/quota|limit/i.test(raw)) return { kind: "pause", minutes: 24 * 60, penalty: true };
    // 553 5.7.1 差出人アドレスが使えない等。設定を直すまで直らないので長めに止める（送信者を保存すると解除される）
    return { kind: "pause", minutes: rc === 553 || SENDER_REJECT_RE.test(raw) ? 24 * 60 : 60, penalty: false };
  }
  // 応答コードのない通信の失敗（つながらない・途中で切れた）。本文を送り切る前なので、届いていない
  if (!rc && (["ECONNECTION", "ETIMEDOUT", "ESOCKET", "EDNS", "ETLS", "EPROXY"].includes(code) || NET_RE.test(raw))) return { kind: "pause", minutes: 10, penalty: false };
  // 接続直後（あいさつ・EHLO）での 4xx/5xx はサーバー側の都合。宛先とは関係ない
  if (command === "CONN" || command === "EHLO" || command === "HELO") return { kind: "pause", minutes: 10, penalty: false };
  if (rc >= 400 && rc < 500) return { kind: "temporary" };
  return { kind: "permanent" };
}

/** エラーが「一時停止すべき種類」なら停止時間（分）、そうでなければ null（古い呼び出し元のため残す） */
export function smtpPauseMinutes(e: unknown): number | null {
  const c = classifySmtpError(e);
  return c.kind === "pause" ? c.minutes : null;
}
export function emailPause(sender: SenderProfile): EmailPause | null {
  try {
    const p = JSON.parse(getSetting(pauseKey(sender), "null")) as EmailPause | null;
    return p && p.until > Date.now() ? p : null;
  } catch { return null; }
}
export function setEmailPause(sender: SenderProfile, minutes: number, reason: string) {
  setSetting(pauseKey(sender), JSON.stringify({ until: Date.now() + minutes * 60_000, reason }));
}
export function clearEmailPause(sender: SenderProfile) {
  getDb().prepare("DELETE FROM settings WHERE key=?").run(pauseKey(sender));
}

/** 接続テスト。つながらないサーバーで画面が何分も固まらないよう、timeoutMs で打ち切る */
export async function testSmtp(sender: SenderProfile, timeoutMs = 10_000): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      transport(sender, { timeoutMs }).verify(),
      new Promise((_, rej) => { timer = setTimeout(() => rej(Object.assign(new Error(`ETIMEDOUT 接続の確認が${Math.round(timeoutMs / 1000)}秒で終わりませんでした`), { code: "ETIMEDOUT" })), timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function isOptedOut(email: string): boolean {
  return Boolean(getDb().prepare("SELECT 1 FROM email_optouts WHERE email=?").get(email.trim().toLowerCase()));
}
export function optOut(email: string, reason: string, ownerUserId?: number) {
  const e = email.trim().toLowerCase();
  if (e) getDb().prepare("INSERT OR IGNORE INTO email_optouts (email, reason, owner_user_id) VALUES (?,?,?)").run(e, reason, ownerUserId ?? null);
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** 本文に法定の署名・停止案内を付けてテキスト/HTMLを作る（単体版は停止リンクが無いので「返信で停止」） */
/** 「メール配信停止」リンク（mailto）。押すと相手のメールソフトで件名「配信停止」・宛先入りのメールが作られ、
 *  送ってもらうと返信の自動確認（replies.ts）が「断り」にして除外リストに入れる。
 *  このアプリは各自のPCで動き外部から開けるURLを持てないため、Webの停止ページではなくメールで受け付ける。
 *  返信元のアドレスが送信先と違っても会社を特定できるよう、本文に送信先アドレスを入れておく */
export function unsubscribeMailto(replyTo: string, to = ""): string {
  const body = `配信停止を希望します。${to ? `\n対象アドレス: ${to}` : ""}\n（このまま送信してください）`;
  return `mailto:${replyTo}?subject=${encodeURIComponent("配信停止")}&body=${encodeURIComponent(body)}`;
}

/** 配信停止のページURL（Googleフォーム等）。設定されていれば、受け取った人はクリック1回で停止を申し出られる（#23）。
 *  どのアドレス宛てかを引き継げるよう、URLに ?email= を足す（Googleフォームの事前入力リンクにも使える） */
export function unsubscribeLink(sender: SenderProfile, to = ""): string {
  const base = (sender.unsubscribe_url ?? "").trim();
  if (!base || !/^https?:\/\//i.test(base)) return "";
  if (!to) return base;
  return base + (base.includes("?") ? "&" : "?") + `email=${encodeURIComponent(to)}`;
}

/** 配信停止の申し出を受け付けるアドレス。返信の自動確認（replies.ts）が読むのは送信用アカウント（smtp_user）の受信箱なので、
 *  必ずそこに届くようにする。以前は返信先（reply_email / email）宛てで、送信用アカウントと違うと申し出が除外リストに入らなかった。
 *  通常の返信先（Reply-To）は利用者が決めたとおりのまま変えない */
export function unsubscribeAddress(sender: Pick<SenderProfile, "smtp_user" | "reply_email" | "email">): string {
  // ユーザー名がメールアドレスの形でないサービス（プロバイダのアカウントID等）では、従来どおり返信先にする
  const user = (sender.smtp_user || "").trim();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(user) ? user : sender.reply_email || sender.email;
}

/** 返信先と配信停止の受付先が違うときの、本文末尾の案内文。返信に引用されたときに「断り」と誤判定しないよう、
 *  replies.ts の FOOTER_ECHO にも同じ書き出しを入れてある */
export const STOP_BY_MAIL_LEAD = "今後このご案内が不要な場合は、お手数ですが件名を「配信停止」として";

export function buildEmailBody(message: string, sender: SenderProfile, to = ""): { text: string; html: string } {
  const replyTo = sender.reply_email || sender.email;
  const stopAddr = unsubscribeAddress(sender);
  const stopUrl = unsubscribeLink(sender, to);
  const footer = [
    "──────────",
    `${sender.company}${sender.person ? ` ${sender.person}` : ""}`,
    sender.address ? `${sender.postal ? `〒${sender.postal} ` : ""}${sender.address}` : "",
    sender.tel ? `TEL: ${sender.tel}` : "",
    `メール: ${replyTo}`,
    sender.url || "",
    "",
    stopUrl
      ? `今後このご案内が不要な場合は、こちらから1クリックでお手続きいただけます: ${stopUrl}\n（${stopAddr === replyTo ? "本メールに「配信停止」とご返信いただいても構いません" : `${stopAddr} 宛てに「配信停止」とお送りいただいても構いません`}）`
      : stopAddr === replyTo
        ? `今後このご案内が不要な場合は、お手数ですが本メールに「配信停止」とご返信ください（${replyTo}）。以後お送りしません。`
        : `${STOP_BY_MAIL_LEAD} ${stopAddr} 宛てにお送りください。以後お送りしません。`,
  ].filter((l) => l !== "");
  const text = `${message.trim()}\n\n${footer.join("\n")}`;
  const paras = message.trim().split(/\n{2,}/).map((p) => `<p style="margin:0 0 1em;line-height:1.7">${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
  const html = `<div style="font-family:-apple-system,'Hiragino Sans','Noto Sans JP',sans-serif;font-size:14px;color:#1C1710;max-width:640px">${paras}<hr style="border:0;border-top:1px solid #ddd;margin:20px 0"><p style="font-size:12px;color:#555;line-height:1.7;margin:0">${footer.slice(1, -1).map(esc).join("<br>")}</p><p style="font-size:12px;color:#555;line-height:1.7;margin:12px 0 0">今後このご案内が不要な場合は、以下のリンクからお手続きください。以後お送りしません。<br><a href="${esc(stopUrl || unsubscribeMailto(stopAddr, to))}" style="color:#1a0dab">メール配信停止</a>${stopUrl ? `<br><span style="color:#888">（メールでのご連絡をご希望の場合は <a href="${esc(unsubscribeMailto(stopAddr, to))}" style="color:#1a0dab">こちら</a>）</span>` : ""}</p></div>`;
  return { text, html };
}

/** メールを1通送る。本文（DATA）を送り切った後に通信が切れた場合は、相手に届いている可能性があるので
 *  エラーに deliveryUnknown=true を付けて返す（呼び出し側は送り直さず「送信済みか不明」にする）。
 *  nodemailer は切断の時点を教えてくれないため、本文を流し終えたときに出るログ（tnx=message）で見分ける */
export async function sendEmail(sender: SenderProfile, input: { from: string; to: string; subject: string; text: string; html: string; attachments?: { path: string; filename: string }[] }): Promise<string> {
  const replyTo = sender.reply_email || sender.email;
  let dataSent = false;
  const noop = () => {};
  const logger: MailLogger = { trace: noop, debug: noop, warn: noop, error: noop, fatal: noop, info: (entry) => { if (entry?.tnx === "message") dataSent = true; } };
  try {
    const r = await transport(sender, { logger }).sendMail({
      from: { name: sender.company, address: input.from },
      to: input.to,
      replyTo,
      subject: input.subject,
      text: input.text,
      html: input.html,
      attachments: input.attachments,
      headers: {
        // 受信側（Gmail等）が「配信停止」ボタンを出すためのヘッダー。
        // 停止ページのURLがあれば、メールでの受付と両方を載せる（クリック1回で済むようになる: #23）
        "List-Unsubscribe": [unsubscribeLink(sender, input.to), unsubscribeMailto(unsubscribeAddress(sender), input.to)].filter(Boolean).map((u) => `<${u}>`).join(", "),
      },
    });
    return r.messageId ?? "";
  } catch (e) {
    // 本文を送り切った後で、サーバーの返事（250 / 4xx / 5xx）を受け取れずに切れた＝届いたか分からない
    if (dataSent && e && typeof e === "object" && !(e as { responseCode?: number }).responseCode) (e as { deliveryUnknown?: boolean }).deliveryUnknown = true;
    throw e;
  }
}
