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

/** Googleのアプリパスワードは「abcd efgh ijkl mnop」の形でコピーされる。空白は除いて渡す */
function normalizePass(pass: string): string {
  const p = (pass ?? "").trim();
  return /^[a-z]{4}( [a-z]{4}){3}$/i.test(p) ? p.replace(/ /g, "") : p;
}

/** よくある入力ミスを、送信前に気づけるようにする */
export function checkSmtpPassword(sender: SenderProfile): string | null {
  const p = normalizePass(sender.smtp_pass);
  const isGoogle = /(^|\.)(gmail\.com|googlemail\.com)$/i.test((sender.smtp_user || "").split("@")[1] ?? "") || /google/i.test(sender.smtp_host || "smtp.gmail.com");
  if (isGoogle && !/^[a-z]{16}$/i.test(p)) {
    return "Googleのアプリパスワードは英小文字16文字です（例: abcdefghijklmnop）。いま入っているのは形が違います。ふだんGmailにログインするパスワードではなく、Googleアカウント → セキュリティ → 2段階認証プロセス → アプリパスワード で作った16文字を入れてください";
  }
  return null;
}

function transport(sender: SenderProfile) {
  const port = sender.smtp_port || 465;
  return nodemailer.createTransport({
    host: sender.smtp_host || "smtp.gmail.com", port, secure: port === 465,
    auth: { user: sender.smtp_user, pass: normalizePass(sender.smtp_pass) },
    // セキュリティソフト等が通信に割り込むPCでは証明書が差し替わり「self-signed certificate」で送れない。
    // 送信者ごとに明示的にオンにしたときだけ、証明書の検証をゆるめる
    ...(sender.tls_insecure ? { tls: { rejectUnauthorized: false } } : {}),
  });
}

/** SMTPの生エラーを、原因と直し方がわかる日本語にする */
export function explainSmtpError(e: unknown, sender: SenderProfile): string {
  const raw = String((e as Error)?.message ?? e);
  if (/535|BadCredentials|Username and Password not accepted/i.test(raw)) {
    const hint = checkSmtpPassword(sender);
    return `Googleにログインを拒否されました。${hint ?? "アプリパスワードが失効しているか、送信用メールアドレスが違う可能性があります"}`;
  }
  if (/534|Application-specific password required/i.test(raw)) return "このアカウントは2段階認証が必要です。Googleアカウントで2段階認証プロセスをオンにしてから、アプリパスワードを作り直してください";
  if (/self.signed|unable to verify|certificate|CERT_/i.test(raw)) return "メールサーバーの証明書を確認できませんでした。セキュリティソフト（ESET・カスペルスキー等）や社内ネットワークがメール通信に割り込んでいる可能性があります。ソフトの「メール保護／SSLスキャン」をオフにするか、送信者プロフィールの「セキュリティソフトの影響で送れない場合」にチェックを入れてください";
  if (/ETIMEDOUT|ECONNREFUSED|ENOTFOUND/i.test(raw)) return `メールサーバー（${sender.smtp_host || "smtp.gmail.com"}:${sender.smtp_port || 465}）に接続できませんでした。ネットワークかSMTPホスト名・ポートを確認してください`;
  if (/Daily user sending (limit|quota) exceeded|550-5\.4\.5/i.test(raw)) return "Gmailの1日の送信上限に達しました。翌日まで待つか、1日の上限を下げてください";
  return raw.slice(0, 200);
}

// ---- メール送信の一時停止 ----
// Gmail にログインを拒否された・一時停止された・1日の上限に達した・つながらない、のときに、
// 残りの会社を次々と「失敗」にしていた（実例: アカウント停止中に180件が数分で失敗）。
// 送信用アカウント単位で一定時間メール送信を止め、その会社は待機に戻す。停止中に何度もログインを試すと解除が遅れるため。
export type EmailPause = { until: number; reason: string };
const pauseKey = (sender: SenderProfile) => `email_pause:${(sender.smtp_user || `sender-${sender.id}`).trim().toLowerCase()}`;

/** エラーが「一時停止すべき種類」なら停止時間（分）、そうでなければ null */
export function smtpPauseMinutes(e: unknown): number | null {
  const raw = `${String((e as Error)?.message ?? e)} ${String((e as { response?: string })?.response ?? "")} ${String((e as { code?: string })?.code ?? "")}`;
  if (/Daily user sending|5\.4\.5|sending limit|quota exceeded/i.test(raw)) return 24 * 60;
  // 送信用アカウント側の問題（ログイン拒否・一時停止）。宛先1件の拒否（550 5.2.1 宛先アカウントが無効 等）では止めない
  if (/\b53[45]\b|BadCredentials|Username and Password not accepted|Application-specific password|5\.7\.(8|9|14)|log in via your web browser|EAUTH|\b421[- ]4\.7\.0|\b454[- ]4\.7\.0/i.test(raw)) return 60;
  if (/ETIMEDOUT|ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|ECONNRESET|EPIPE|ESOCKET|EDNS|getaddrinfo|Greeting never received|Connection closed/i.test(raw)) return 10;
  return null;
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

export async function testSmtp(sender: SenderProfile): Promise<void> {
  await transport(sender).verify();
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

export function buildEmailBody(message: string, sender: SenderProfile, to = ""): { text: string; html: string } {
  const replyTo = sender.reply_email || sender.email;
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
      ? `今後このご案内が不要な場合は、こちらから1クリックでお手続きいただけます: ${stopUrl}\n（本メールに「配信停止」とご返信いただいても構いません）`
      : `今後このご案内が不要な場合は、お手数ですが本メールに「配信停止」とご返信ください（${replyTo}）。以後お送りしません。`,
  ].filter((l) => l !== "");
  const text = `${message.trim()}\n\n${footer.join("\n")}`;
  const paras = message.trim().split(/\n{2,}/).map((p) => `<p style="margin:0 0 1em;line-height:1.7">${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
  const html = `<div style="font-family:-apple-system,'Hiragino Sans','Noto Sans JP',sans-serif;font-size:14px;color:#1C1710;max-width:640px">${paras}<hr style="border:0;border-top:1px solid #ddd;margin:20px 0"><p style="font-size:12px;color:#555;line-height:1.7;margin:0">${footer.slice(1, -1).map(esc).join("<br>")}</p><p style="font-size:12px;color:#555;line-height:1.7;margin:12px 0 0">今後このご案内が不要な場合は、以下のリンクからお手続きください。以後お送りしません。<br><a href="${esc(stopUrl || unsubscribeMailto(replyTo, to))}" style="color:#1a0dab">メール配信停止</a>${stopUrl ? `<br><span style="color:#888">（メールでのご連絡をご希望の場合は <a href="${esc(unsubscribeMailto(replyTo, to))}" style="color:#1a0dab">こちら</a>）</span>` : ""}</p></div>`;
  return { text, html };
}

export async function sendEmail(sender: SenderProfile, input: { from: string; to: string; subject: string; text: string; html: string; attachments?: { path: string; filename: string }[] }): Promise<string> {
  const replyTo = sender.reply_email || sender.email;
  const r = await transport(sender).sendMail({
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
      "List-Unsubscribe": [unsubscribeLink(sender, input.to), unsubscribeMailto(replyTo, input.to)].filter(Boolean).map((u) => `<${u}>`).join(", "),
    },
  });
  return r.messageId ?? "";
}
