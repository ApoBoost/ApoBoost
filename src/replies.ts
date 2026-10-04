// 返信の自動確認。送信用メールアカウントの受信箱（IMAP）を定期的に読み、送った会社から届いたメールを
// キーワードで「返信あり／アポ／断り」に振り分けて、反応（form_jobs.outcome）に自動で記録する。
// AIは使わない（費用をかけない方針）。判定は外れることがあるので、メモに「自動判定」と根拠を残し、人が直せるようにする。
// 人が手で記録した反応は上書きしない。
import { ImapFlow } from "imapflow";
import type { Readable } from "node:stream";
import { getDb, getSetting, setSetting, FREE_MAIL_DOMAINS, jst, type SenderProfile } from "./db.js";
import { optOut, emailPause } from "./email.js";
import { notify } from "./notify.js";
import { S, settingOn } from "./settings.js";

export type IncomingMail = {
  from: string; // 差出人アドレス
  subject: string;
  text: string; // 本文（プレーンテキスト）
  date: Date;
  autoHeader: boolean; // Auto-Submitted 等の自動送信ヘッダーがあった
};

export type ReplyVerdict = { outcome: "replied" | "appointment" | "declined"; reason: string };

// 自動返信・受付確認・エラーメール。フォーム送信後に届く「お問い合わせを受け付けました」は会社のドメインから来るが、人の返信ではない
const AUTO_SUBJECT_RE = /(自動返信|自動応答|自動送信|自動配信|auto[- ]?reply|automatic reply|out of office|不在|受付完了|受け付けました|受付のお知らせ|受付確認|送信完了|お問い?合わ?せ(を)?(受け付け|受付|承り|ありがとう)|お問い?合わ?せ内容の確認|(お問い?合わ?せ|ご連絡|ご送信|送信|ご依頼|ご相談)(を)?(いただき|頂き)?(まして)?[、,]?(誠に|大変)?(ありがとう|有難う|有り難う)|フォーム(より|から)|受付番号|お問い?合わ?せ内容の?(ご)?確認|お問い?合わ?せ確認|お問い?合わ?せ\s*控え|登録(いただき|頂き)?ありがとう|Undeliver|Delivery Status|Mail Delivery|配信(に)?失敗|配信不能|returned mail|failure notice)/i;
const AUTO_BODY_RE = /(このメールは(自動|送信専用)|本メールは(自動|送信専用|システム)|(自動|システム)(で|により)?(送信|配信|返信)(され|して|いた|しており|しています)|送信専用(アドレス|メール)|(返信|ご返信)(いただいても|されても|頂いても)[^。\n]{0,20}(お答え|回答|対応|返答)(でき|いたしかね|致しかね)|以下の内容で(受け付け|受付|承り|送信)|下記の内容で(受け付け|受付|承り|送信)|自動送信した|自動返信です|(ウェブサイト|ホームページ|webサイト|WEBサイト|サイト)(より|から)(自動)?送信されて|(お送り|送信)(頂|いただ)きました内容(は|を)(以下|下記))/;
const AUTO_FROM_RE = /^(mailer-daemon|postmaster|no-?reply|do-?not-?reply|noreply|bounce)/i;

// 断り（今後送らない）。「本メッセージが不要な場合は…」等、こちらの文面の引用は本文から取り除いてから見る
const DECLINE_RE = /(辞退|拝辞|ご期待に(沿|添)(う|え)(こと|ず|かね)|ご希望に(沿|添)え(ず|ない|かね)|お見送り|今回は見送|難しい(という|との)?(結論|判断)|お断りさせ|不要です|不要でございます|必要(は|も)?(ござい|あり)ません|お断り|見送(り|らせ|ります|ることに)|遠慮(いた|致|させ|し|くだ|下さ)|控えさせ|差し控え|配信(を)?停止|送らないで|送付(は|を)?(不要|ご遠慮|お控え)|ご連絡(は|を)?(不要|結構|お控え|ご遠慮)|(今後|以後)[^。\n]{0,15}(不要|ご遠慮|お控え|控えて|送らない|結構)|検討(は|を)?(して)?(おりません|いたしかね|致しかね|できかね)|予定(は|が)?(ござい|あり)ません|間に合って|結構です|対応(いた|致)しかね|お受け(でき|いたし|致し)かね|(リスト|名簿)から(外|削除|除外)|営業(メール|のご連絡)?(は|を)?(お断り|禁止|受け付けて))/;
// アポ・前向き（日程調整や話を聞きたい）
const APPO_RE = /(日程|日時|候補日|ご都合|打ち?合わ?せ|面談|ミーティング|商談|お時間(を)?(いただ|頂|取|作|頂戴)|お話(を)?(伺|お聞き|聞かせ|聞き)|詳しく(伺|お聞き|聞きた|教えて|知りた)|zoom|teams|google\s*meet|オンライン(で|会議|面談|ミーティング)|ご来社|ご訪問|(資料|詳細|見積|お見積)(を|も)?(送|お送り|いただ|頂|ご送付|ください|下さい)|ご説明(を)?(いただ|頂|お願い)|お話(の|する)?(機会|場|時間)|機会を(頂戴|いただ|頂)|(予約|登録)(させて)?(いただ|頂)きました|予約(いた|致)しました|\d{1,2}月\d{1,2}日[^。\n]{0,12}\d{1,2}[:：]\d{2}|\d{1,2}\/\d{1,2}[^。\n]{0,12}\d{1,2}[:：]\d{2})/i;

/** 返信本文から、こちらが送った文面の引用・署名より下の部分を取り除く（引用内の「不要な場合は」等で誤判定しないため） */
const norm = (s: string) => s.replace(/[\s　▪️・■□●○◆◇▼▶︎*＊\-ー―─_=＝:：|｜>＞「」【】()（）]/g, "");

export function stripQuoted(text: string, sentMessage = ""): string {
  const sentLines = new Set(sentMessage.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length >= 8));
  // フォーム送信後の受付確認メール等は「お問い合わせ内容：（こちらの文面）」のように見出し付きで転記するため、
  // 行がこちらの文面に含まれる／行がこちらの文面の1行を含む場合も、こちらの文章とみなして除く
  const sentNorm = norm(sentMessage);
  const sentNormLines = sentMessage.split(/\r?\n/).map(norm).filter((l) => l.length >= 12);
  const isEcho = (line: string) => {
    const n = norm(line);
    if (n.length >= 10 && sentNorm.includes(n)) return true;
    return sentNormLines.some((l) => n.includes(l));
  };
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    // 引用の開始行が来たら、そこから下は全部引用とみなして打ち切る
    if (/^-{2,}\s*(Original Message|元のメッセージ|Forwarded message|転送)/i.test(line)) break;
    if (/^On .{5,200}wrote:$/i.test(line)) break;
    if (/^\d{4}(年|\/|-)\d{1,2}(月|\/|-)\d{1,2}日?.{0,80}(<|＜|&lt;)[^>＞]+@[^>＞]+(>|＞|&gt;).{0,10}[:：]?$/.test(line)) break;
    if (/^(差出人|From)\s*[:：]/i.test(line) && out.length > 0) break;
    if (/^(>|＞)/.test(line)) continue;
    if (/^\[?メール配信停止\]?(\s*<mailto:[^>]*>)?$/.test(line)) continue; // こちらの署名の配信停止リンクの文字
    if (sentLines.has(line) || (sentMessage && isEcho(line))) continue;
    out.push(raw);
  }
  return out.join("\n").trim();
}

/** 自動返信・受付確認・エラーメールなら true（反応として数えない） */
export function isAutoMail(m: IncomingMail): boolean {
  if (m.autoHeader) return true;
  if (AUTO_FROM_RE.test(m.from.split("@")[0] ?? "")) return true;
  if (AUTO_SUBJECT_RE.test(m.subject)) return true;
  return AUTO_BODY_RE.test(m.text.replace(/[ \t　]+/g, ""));
}

// ---- 人の直しから覚える（#25）----
// 自動判定を人が直したとき、その返信に出てきた言い回しを覚えておき、次から同じ言い回しは同じ振り分けにする。
// AIは使わない（費用ゼロ）。覚えた言い回しは設定画面で一覧・削除できる。
type ReplyRule = { id: number; phrase: string; outcome: ReplyVerdict["outcome"]; source: string };
let rulesCache: { at: number; rules: ReplyRule[] } | null = null;

export function loadReplyRules(): ReplyRule[] {
  if (rulesCache && Date.now() - rulesCache.at < 60_000) return rulesCache.rules;
  try {
    const rules = getDb().prepare("SELECT id, phrase, outcome, source FROM reply_rules ORDER BY id DESC").all() as ReplyRule[];
    rulesCache = { at: Date.now(), rules };
    return rules;
  } catch { return []; }
}
export function clearReplyRulesCache() { rulesCache = null; }

/** 文章から「覚える価値のある言い回し」を取り出す。あいさつ文や短すぎる断片は覚えない */
export function phrasesFor(text: string): string[] {
  // あいさつ・署名だけの断片は覚えない。「担当に共有しました」のように、あいさつ語で始まるだけの文は覚える
  // （以前は「担当」「株式会社」で始まる文をすべて捨てていて、学習が効かない返信があった）
  const GENERIC = /^(お世話になります|お世話になっております|ご連絡(誠に)?ありがとうございます|ありがとうございます|(何卒|どうぞ)?よろしくお願い(いた|致)?します|はじめまして|拝啓|敬具|(株式会社|有限会社|合同会社)?[^、。]{0,12}(担当|部|課)?[^、。]{0,6}(です|と申します))$/;
  return text
    .split(/[。\n、．.]/)
    .map((x) => x.replace(/\s+/g, "").trim())
    .filter((x) => x.length >= 6 && x.length <= 28)
    .filter((x) => /[ぁ-んァ-ン一-龥]/.test(x) && !GENERIC.test(x))
    .slice(0, 2);
}

/** 人が直した反応から言い回しを覚える。覚えた件数を返す */
export function learnFromCorrection(text: string, outcome: ReplyVerdict["outcome"], source = ""): number {
  if (!outcome || !text) return 0;
  const db = getDb();
  let n = 0;
  for (const p of phrasesFor(text)) {
    try {
      const r = db.prepare("INSERT OR IGNORE INTO reply_rules(phrase, outcome, source) VALUES(?,?,?)").run(p, outcome, source.slice(0, 80));
      n += r.changes;
    } catch { /* 同じ言い回しは1つだけ */ }
  }
  if (n) clearReplyRulesCache();
  return n;
}

/** 覚えた言い回しでの判定。断り＞アポ＞返信ありの順に強く見る */
export function learnedVerdict(body: string): (ReplyVerdict & { excerpt: string }) | null {
  const s = body.replace(/[\s　]+/g, "");
  const rules = loadReplyRules();
  for (const want of ["declined", "appointment", "replied"] as const) {
    const hit = rules.find((r) => r.outcome === want && r.phrase && s.includes(r.phrase));
    if (hit) return { outcome: hit.outcome, reason: `覚えた言い回し「${hit.phrase}」`, excerpt: hit.phrase };
  }
  return null;
}

/** 返信をキーワードで振り分ける。断りとアポの両方の言葉がある場合は決めつけず「返信あり」にして人に任せる */
export function classifyReply(subject: string, body: string): ReplyVerdict & { excerpt: string } {
  // 件名は「Re: こちらの件名（商談機会について 等）」なので、キーワード判定には本文だけを使う（件名の「商談」でアポにしないため）
  const s = body.replace(/[ \t　]+/g, "");
  const around = (idx: number, len: number) => s.slice(Math.max(0, idx - 30), idx + len + 30).replace(/\s+/g, " ").trim();
  const dec = DECLINE_RE.exec(s);
  const app = APPO_RE.exec(s);
  // 配信停止の返信（本メールの案内どおり件名や本文の先頭に「配信停止」とだけ書いたもの）
  if (/^\s*(re:|RE:|Re:|fw:|Fwd:)?\s*配信停止/.test(subject) || /^配信停止/.test(s)) return { outcome: "declined", reason: "「配信停止」の返信", excerpt: around(0, 20) || subject.slice(0, 60) };
  // 人が直した結果から覚えた言い回しを先に見る（#25）
  const learned = learnedVerdict(s);
  if (learned) return learned;
  if (dec && !app) return { outcome: "declined", reason: `「${dec[0]}」`, excerpt: around(dec.index, dec[0].length) };
  if (app && !dec) return { outcome: "appointment", reason: `「${app[0]}」`, excerpt: around(app.index, app[0].length) };
  if (app && dec) return { outcome: "replied", reason: `「${dec[0]}」「${app[0]}」の両方があり判断できず`, excerpt: around(dec.index, dec[0].length) };
  return { outcome: "replied", reason: "振り分けの言葉なし", excerpt: s.slice(0, 60).replace(/\s+/g, " ") };
}

type SentJob = { id: number; company_name: string; email: string; domain: string; sent_at: string; outcome: string; outcome_note: string; message_used: string; owner_user_id: number | null };

// こちらのメールの署名・配信停止の案内（email.ts の buildEmailBody）。返信に引用されて「配信停止」で断りにならないよう除く
const FOOTER_ECHO = "今後このご案内が不要な場合は、お手数ですが本メールに「配信停止」とご返信ください\n以後お送りしません。\n今後このご案内が不要な場合は、以下のリンクからお手続きください。";

const RANK: Record<string, number> = { "": 0, replied: 1, appointment: 2, declined: 2 };

/** 届いた1通を、その受信箱から送った会社と突き合わせて反応を記録する。記録したら job id を返す */
export function applyIncomingMail(mailbox: string, m: IncomingMail): number | null {
  const db = getDb();
  const from = m.from.trim().toLowerCase();
  const fromDomain = from.split("@")[1] ?? "";
  if (!fromDomain || from === mailbox.toLowerCase()) return null;
  // 本メールの「配信停止」案内（List-Unsubscribe）を相手のメールソフトから押すと、件名「配信停止」・自動送信ヘッダー付きで届く。
  // これは相手の意思表示なので自動返信扱いにしない
  const unsubscribe = /^\s*配信停止/.test(m.subject);
  if (!unsubscribe && (m.autoHeader || AUTO_FROM_RE.test(from.split("@")[0] ?? ""))) return null;
  const job = findSentJob(mailbox, m);
  if (!job) return null;
  return recordReply(mailbox, m, job, unsubscribe);
}

/** この受信箱から送った会社のうち、届いたメールの差出人に当たる会社を探す（直近90日）。見つからなければ undefined */
export function findSentJob(mailbox: string, m: IncomingMail): SentJob | undefined {
  const db = getDb();
  const from = m.from.trim().toLowerCase();
  const fromDomain = from.split("@")[1] ?? "";
  if (!fromDomain || from === mailbox.toLowerCase()) return undefined;
  const unsubscribe = /^\s*配信停止/.test(m.subject);
  const at = m.date.toISOString().replace("T", " ").slice(0, 19);
  // この受信箱（送信用アカウント）を使う送信者から、このメールより前に送った会社（直近90日）
  const base = `SELECT j.id, j.company_name, j.email, j.domain, j.sent_at, j.outcome, j.outcome_note, j.message_used, s.owner_user_id
    FROM form_jobs j JOIN form_campaigns c ON c.id=j.campaign_id JOIN sender_profiles s ON s.id=c.sender_id
    WHERE j.is_test=0 AND j.status='sent' AND j.sent_at IS NOT NULL AND j.sent_at <= ? AND j.sent_at >= datetime(?, '-90 days')
      AND lower(s.smtp_user)=?`;
  let job = db.prepare(`${base} AND lower(j.email)=? ORDER BY j.sent_at DESC LIMIT 1`).get(at, at, mailbox.toLowerCase(), from) as SentJob | undefined;
  // アドレスが違っても、同じ会社のドメイン（サブドメイン含む）からの返信なら同じ会社とみなす。フリーメールは別人の可能性があるので除く
  if (!job && !FREE_MAIL_DOMAINS.has(fromDomain)) {
    const parts = fromDomain.split(".");
    const cands = parts.map((_, i) => parts.slice(i).join(".")).filter((d) => d.includes(".") && !/^(co|ne|or|ac|go|com|net|org)\.[a-z]{2}$/.test(d));
    const ph = cands.map(() => "?").join(",");
    if (cands.length) job = db.prepare(`${base} AND (lower(j.domain) IN (${ph}) OR (j.email<>'' AND lower(substr(j.email, instr(j.email,'@')+1)) IN (${ph}))) ORDER BY j.sent_at DESC LIMIT 1`).get(at, at, mailbox.toLowerCase(), ...cands, ...cands) as SentJob | undefined;
  }
  // 「メール配信停止」リンクから作られたメールは、本文に送信先アドレスが入っている（転送先や個人アドレスから送られても特定できる）
  if (!job && unsubscribe) {
    const target = m.text.match(/対象アドレス[:：]\s*([^\s<>]+@[^\s<>]+)/)?.[1]?.toLowerCase();
    if (target) job = db.prepare(`${base} AND lower(j.email)=? ORDER BY j.sent_at DESC LIMIT 1`).get(at, at, mailbox.toLowerCase(), target) as SentJob | undefined;
  }
  return job;
}

/** 突き合わせた会社に、届いたメールの反応（返信あり・アポ・断り）を記録する。記録したら job id */
function recordReply(mailbox: string, m: IncomingMail, job: SentJob, unsubscribe: boolean): number | null {
  const db = getDb();
  const at = m.date.toISOString().replace("T", " ").slice(0, 19);
  const body = stripQuoted(m.text, `${job.message_used}\n${FOOTER_ECHO}`);
  // 自動返信の判定は引用を除いた本文で行う（引用されたこちらの文面の言葉で誤判定しないため）
  if (!unsubscribe && !looksHuman(body, mailbox) && isAutoMail({ ...m, text: body })) return null;
  const v = classifyReply(m.subject, body);
  // 人が手で付けた反応は触らない。自動で付けたものは、より強い判定（アポ・断り）が来たときだけ上げる
  const auto = job.outcome === "" || job.outcome_note.startsWith("自動判定");
  if (!auto || RANK[v.outcome] <= (RANK[job.outcome] ?? 0)) return null;
  // 一覧で「どこを見て判定したか」が分かるよう、判定に使った言葉の前後の本文を残す（時刻は東京時間）
  const note = `自動判定（キーワード: ${v.reason}）${jst(at)} 件名「${m.subject.slice(0, 50)}」 本文「…${v.excerpt.slice(0, 90)}…」`.slice(0, 300);
  db.prepare("UPDATE form_jobs SET outcome=?, outcome_note=?, appo_seen_at=NULL, updated_at=datetime('now') WHERE id=?").run(v.outcome, note, job.id);
  // アポ・返信が来たら、すぐ知らせる（#134）。受信箱は15分ごとに読んでいるのに、これまでは画面を開くまで分からなかった
  if (v.outcome !== "declined" && settingOn(S.notifyReply)) {
    notify(v.outcome === "appointment" ? "アポの返信が来ました" : "返信が来ました", `${job.company_name}: ${v.excerpt.slice(0, 60)}`, `reply:${job.id}:${v.outcome}`);
  }
  if (v.outcome === "declined") {
    // 手で「断り」を押したときと同じく、今後この会社には送らない（誤判定でも送らない側に倒す）
    if (job.domain) db.prepare("INSERT OR IGNORE INTO form_suppressions(domain, reason) VALUES(?,?)").run(job.domain, `断り・返信から自動判定（${job.company_name}）`);
    if (job.email) optOut(job.email, `断り・返信から自動判定（${job.company_name}）`, job.owner_user_id ?? undefined);
  }
  return job.id;
}

function errText(e: unknown): string {
  const x = e as { message?: string; responseText?: string } | undefined;
  return String(x?.responseText || x?.message || e).slice(0, 160);
}

/** 1通ずつ振り分ける係を作る。ラベル（フォルダ）は最初に使うときに作る。失敗しても読み取りは続ける */
type Sorter = ((uid: number, cat: InboxCategory) => Promise<boolean>) & { names: string[]; failures: string[]; counts: Partial<Record<InboxCategory, number>> };
function makeSorter(getClient: () => ImapFlow, gmail: boolean, ownNames: string[]): Sorter {
  const ready = new Set<string>();
  let delimiter = "/";
  const ensure = async (path: string[]): Promise<string | null> => {
    const key = path.join("\u0000");
    if (ready.has(key)) return path.join(delimiter);
    const client = getClient();
    try {
      const list = await client.list();
      delimiter = list.find((x) => x.delimiter)?.delimiter ?? "/";
      const full = path.join(delimiter);
      const exists = list.some((x) => x.path === full || x.name === path[path.length - 1] && x.path.endsWith(full));
      if (!exists) await client.mailboxCreate(path).catch((e) => fail(`ラベル「${full}」を作れませんでした: ${errText(e)}`));
      ready.add(key);
      return full;
    } catch (e) { fail(`ラベル一覧を読めませんでした: ${errText(e)}`); return null; }
  };
  // 失敗しても読み取りは続けるが、黙って失敗すると「振り分けたはずなのに受信箱に残っている」原因が分からないため、理由を控えておく
  const failures: string[] = [];
  const fail = (msg: string) => { if (failures.length < 5 && !failures.includes(msg)) failures.push(msg); };
  const fn = (async (uid: number, cat: InboxCategory) => {
    const rule = INBOX_LABEL[cat];
    const client = getClient();
    try {
      const target = await ensure(rule.path);
      if (!target) return false;
      if (rule.seen) await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true }).catch(() => {});
      if (rule.star) await client.messageFlagsAdd(String(uid), ["\\Flagged"], { uid: true }).catch(() => {});
      if (rule.archive) {
        // Gmail では「ラベルを付けて受信箱から外す」、それ以外では「フォルダに移す」になる
        await client.messageMove(String(uid), target, { uid: true });
      } else if (gmail) {
        // Gmail ではコピー＝ラベルを付ける（受信箱に残る）。Gmail以外はコピーすると重複するので、ラベルは付けない
        await client.messageCopy(String(uid), target, { uid: true });
      }
      fn.counts[cat] = (fn.counts[cat] ?? 0) + 1;
      return true;
    } catch (e) {
      // 接続が切れただけなら、呼び出し側がつなぎ直してやり直す（失敗には数えない）
      if (client.usable) fail(`${rule.path.join("/")} へ移せませんでした: ${errText(e)}`);
      return false;
    }
  }) as Sorter;
  fn.names = ownNames;
  fn.failures = failures;
  fn.counts = {};
  return fn;
}

// ---- 受信箱の振り分け ----
// 送信用のGmailには、フォームに送った会社からの「お問い合わせありがとうございます」という自動返信が大量に届き、
// 本物の返信（アポ・断り）が埋もれていた。届いたメールを次のように振り分ける:
//   ・自動返信・受付確認 → ラベル「ApoBoost/自動返信」に移して、受信箱から外す（既読にする）
//   ・届かなかったメール → ラベル「ApoBoost/届かなかった」に移して、受信箱から外す
//   ・アポ → ラベル「ApoBoost/アポ」を付けてスターを付ける（受信箱に残す）
//   ・返信・断り → ラベル「ApoBoost/返信」「ApoBoost/断り」を付ける（受信箱に残す）
// 営業と関係のないメール（カード会社の通知など）には触らない。消すことはしない（「すべてのメール」とラベルから見られる）。
export type InboxCategory = "auto" | "bounce" | "appointment" | "replied" | "declined";
export const INBOX_LABEL: Record<InboxCategory, { path: string[]; archive: boolean; star: boolean; seen: boolean }> = {
  auto: { path: ["ApoBoost", "自動返信"], archive: true, star: false, seen: true },
  bounce: { path: ["ApoBoost", "届かなかった"], archive: true, star: false, seen: true },
  appointment: { path: ["ApoBoost", "アポ"], archive: false, star: true, seen: false },
  replied: { path: ["ApoBoost", "返信"], archive: false, star: false, seen: false },
  declined: { path: ["ApoBoost", "断り"], archive: false, star: false, seen: false },
};

const squash = (s: string) => s.replace(/[\s　]+/g, "");
/** 人が書いたメールらしい（書き出しで名乗っている）。受付確認の自動返信は「〇〇と申します」とは書かない。
 *  ただし受付確認は、こちらが送った文面（「田中と申します」）を写し返すので、こちらの名前での名乗りは数えない */
function looksHuman(body: string, mailbox: string): boolean {
  const head = squash(body).slice(0, 260);
  const ours = ownNamePartsFor(mailbox);
  for (const mm of head.matchAll(/(.{0,14})と申します/g)) {
    const prefix = mm[1] ?? "";
    if (!ours.some((p) => prefix.includes(p))) return true;
  }
  return false;
}
/** この受信箱を使う送信者の名前（姓・名・会社名）。「こちらの名乗り」を見分けるのに使う */
const namePartCache = new Map<string, string[]>();
function ownNamePartsFor(mailbox: string): string[] {
  const hit = namePartCache.get(mailbox);
  if (hit) return hit;
  const rows = getDb().prepare("SELECT company, person, person_kana FROM sender_profiles WHERE lower(smtp_user)=?").all(mailbox.toLowerCase()) as { company: string; person: string; person_kana: string }[];
  const parts = new Set<string>();
  for (const r of rows) {
    for (const p of `${r.person} ${r.person_kana}`.split(/[\s　]+/)) if (p.length >= 1) parts.add(p);
    const core = squash(r.company).replace(/(株式会社|有限会社|合同会社)/g, "");
    if (core.length >= 2) parts.add(core);
  }
  const list = [...parts];
  namePartCache.set(mailbox, list);
  return list;
}

/** 件名だけで「問い合わせの受付確認」と分かる言い回し */
const RECEIPT_SUBJECT_RE = /((お問い?合わ?せ|お問合せ|問い?合わ?せ|ご相談|ご依頼|資料請求|ご応募|応募|エントリー|フォーム).{0,24}(ありがとう|有難う|有り難う|受付|受け付け|承り|完了|確認|控|自動)|(ありがとう|受付|受け付け|承り)(ました|ございました|ございます)?.{0,12}(お問い?合わ?せ|問い?合わ?せ)|送信(ありがとう|完了|内容|控)|受付(完了|確認|のお知らせ)|受信完了|自動(返信|送信|応答|配信)|auto[- ]?reply|thank you for (your )?(inquiry|contacting)|への(お)?問い?合わ?せ$|メールフォーム|(お問い?合わ?せ|お問合せ)(フォーム)?(より|から)|フォーム(を)?送信(しました|いたしました|致しました|完了)|自動送信通知|オートメーションメール|^(【[^】]{1,40}】\s*)?(お問い?合わ?せ|お問合せ)\s*$|^【(お問い?合わ?せ|お問合せ)】|^.{1,40}[\s　](お問い?合わ?せ|お問合せ)$)/i;
// 「【自動送信通知】」のように、件名だけで受付確認と断定できる言い回し（会社名に「セキュリティ」等が入っていても受付確認とみなす）
const STRONG_RECEIPT_SUBJECT_RE = /(自動(送信|返信|応答)|受付(完了|確認)|フォーム(より|から|送信)|オートメーションメール)/;
/** 本文の書き出しで「受付確認」と分かる言い回し（件名に出ていないフォーム作成サービス等の受付確認用） */
const RECEIPT_BODY_RE = /(送信が完了|受付が完了|受け付けました|受付いたしました|受付致しました|(お問い?合わ?せ|お問合せ|ご連絡)(を)?(承り|受領)(いた|致|し|ました)|(お問い?合わ?せ|お問合せ)(を)?(いただき|頂き)(まして)?[、,]?(誠に)?ありがとう|への(お問い?合わ?せ|お問合せ)(を)?(ありがとう|有難う)|以下の内容(で|にて)(送信|受け付け|受付|承り)|下記の内容(で|にて)(送信|受け付け|受付|承り)|自動返信です|システムからの自動|フォーム(を)?送信(いた|致|し)ました)/;
/** 受信箱から外してはいけない種類の知らせ（契約・署名・セキュリティ・支払い・審査など） */
const SENSITIVE_RE = /(署名|契約|締結|申込書|セキュリティ|請求|お支払|支払い|審査|ログイン|パスワード|認証コード|アカウント|招待|共有され)/;

/** 届いた1通が、営業の送信に関係するメールなら、その種類を返す。関係なければ null（触らない）。
 *  受信箱から外す（"auto"）のは、確かな手がかりがあるときだけにする。
 *  人のメールを外してしまう害は、自動返信が受信箱に残る害よりずっと大きいため、迷ったら外さない */
export function inboxCategory(mailbox: string, m: IncomingMail, ownNames: string[]): InboxCategory | null {
  const from = m.from.trim().toLowerCase();
  if (!from || from === mailbox.toLowerCase()) return null;
  // 自社のアドレス（社内のやり取り）と Google（フォームの回答の控え・セキュリティ通知など）からのメールには触らない
  const dom = from.split("@")[1] ?? "";
  if (dom === (mailbox.toLowerCase().split("@")[1] ?? "") || /(^|\.)google\.com$/.test(dom)) return null;
  const unsubscribe = /^\s*配信停止/.test(m.subject);
  const human = /^\s*(re|fw|fwd)\s*[:：]/i.test(m.subject);          // こちらのメールへの返信・転送は人のメール
  // 会社名に「セキュリティ」等が入っていて受付確認を取り逃した例（プルコセキュリティ）があるので、件名が受付確認と断定できるときは除く
  const sensitive = SENSITIVE_RE.test(m.subject) && !STRONG_RECEIPT_SUBJECT_RE.test(m.subject);
  const receipt = RECEIPT_SUBJECT_RE.test(m.subject) || RECEIPT_BODY_RE.test(squash(m.text).slice(0, 300));
  const machine = m.autoHeader || AUTO_FROM_RE.test(from.split("@")[0] ?? "");
  const job = findSentJob(mailbox, m);
  if (job) {
    if (unsubscribe) return "declined";
    const body = stripQuoted(m.text, `${job.message_used}\n${FOOTER_ECHO}`);
    // 受付確認の自動返信は、こちらの文面（日程・商談 など）を写し返すので、言葉で判定するとアポや断りに見えてしまう。
    // 先に「人の返信か」を見て、人でなく受付確認の手がかりがあれば自動返信にする
    const humanMail = human || looksHuman(body, mailbox);
    if (!humanMail && !sensitive && (RECEIPT_SUBJECT_RE.test(m.subject) || machine || isAutoMail({ ...m, text: body }))) return "auto";
    return classifyReply(m.subject, body).outcome;
  }
  // 送った会社と差出人が結びつかないメール（フォーム作成サービスのアドレスから届く等）は、
  // 件名が受付確認の言い回しで、しかも中身がこちらの送信と結びつくときだけ「自動返信」にする
  if (human || sensitive || !receipt) return null;
  const hay = squash(`${m.subject}\n${m.text}`);
  const ours = ownNames.map(squash).filter((x) => x.length >= 3);
  if (ours.some((x) => hay.includes(x))) return "auto";
  // 「田中 様」のように姓だけで呼ぶ受付確認（日発運送の実例）。件名だけで受付確認と断定できるときに限る
  if (STRONG_RECEIPT_SUBJECT_RE.test(m.subject)) {
    const surnames = ownNames.map((n) => n.split(/[\s　]+/)[0] ?? "").map(squash).filter((x) => x.length >= 2);
    if (surnames.some((x) => hay.includes(x + "様") || hay.includes(x + "さま"))) return "auto";
  }
  if (sentTemplateLines(mailbox).filter((l) => hay.includes(l)).length >= 2) return "auto";
  if (namesRecentlySentCompany(mailbox, m.date, hay)) return "auto";
  return null;
}

/** 届いた時刻の直前3時間に、この受信箱から送った会社の名前が本文に入っているか（法人格を除いた名前で比べる） */
function namesRecentlySentCompany(mailbox: string, at: Date, hay: string): boolean {
  const to = at.toISOString().replace("T", " ").slice(0, 19);
  const from = new Date(at.getTime() - 3 * 3600_000).toISOString().replace("T", " ").slice(0, 19);
  const rows = getDb().prepare(`SELECT j.company_name n FROM form_jobs j JOIN form_campaigns c ON c.id=j.campaign_id JOIN sender_profiles s ON s.id=c.sender_id
    WHERE lower(s.smtp_user)=? AND j.status='sent' AND j.is_test=0 AND j.sent_at BETWEEN ? AND ? LIMIT 500`).all(mailbox.toLowerCase(), from, to) as { n: string }[];
  return rows.some((r) => {
    const core = squash(r.n).replace(/(株式会社|有限会社|合同会社|合資会社|一般社団法人|一般財団法人|社会福祉法人|医療法人|学校法人|\(株\)|（株）|\(有\)|（有）)/g, "");
    return core.length >= 3 && hay.includes(core);
  });
}

/** この受信箱から送った文面のうち、どの会社にも共通する行（テンプレートの行）。受付確認メールの「控え」の見分けに使う */
const templateLineCache = new Map<string, { at: number; lines: string[] }>();
function sentTemplateLines(mailbox: string): string[] {
  const hit = templateLineCache.get(mailbox);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.lines;
  const rows = getDb().prepare(`SELECT j.message_used m FROM form_jobs j JOIN form_campaigns c ON c.id=j.campaign_id JOIN sender_profiles s ON s.id=c.sender_id
    WHERE lower(s.smtp_user)=? AND j.status='sent' AND j.is_test=0 AND j.message_used<>'' ORDER BY j.id DESC LIMIT 300`).all(mailbox.toLowerCase()) as { m: string }[];
  const freq = new Map<string, number>();
  for (const r of rows) for (const l of new Set(r.m.split(/\r?\n/).map(squash).filter((x) => x.length >= 15))) freq.set(l, (freq.get(l) ?? 0) + 1);
  // 3社以上で同じ行＝テンプレートの行（会社名などが入った行は除かれる）
  const lines = [...freq.entries()].filter(([, c]) => c >= 3).map(([l]) => l);
  templateLineCache.set(mailbox, { at: Date.now(), lines });
  return lines;
}

// ---- 届かなかったメール（エラーで戻ってきたメール）の検知 ----
// 以前は「アドレス不明」などで戻ってきても「送信済み」のままで、同じアドレスに送り続けて Gmail の評価を下げていた
// （実例: 1000通中 約200通が戻ってきていた）。戻りメールから宛先を読み取り、その会社を「失敗」にする。
const BOUNCE_SUBJECT_RE = /(Undeliver|Delivery Status Notification \(Failure\)|Delivery Status Notification$|Mail Delivery (Subsystem|Failed|failure)|Returned mail|Mail System Error|failure notice|Delivery has failed|Undelivered Mail|配信(に)?失敗|配信不能|送信できませんでした|届きませんでした)/i;
const BOUNCE_FROM_RE = /^(mailer-daemon|postmaster|mail-daemon|mailerdaemon)$/i;

export type BounceKind = "hard" | "full" | "size" | "other";
export function bounceKind(text: string): BounceKind {
  if (/mailbox (is )?full|over ?quota|quota exceeded|mailbox size limit|容量(が|を)?(超|いっぱい)|5\.2\.2/i.test(text)) return "full";
  if (/5\.3\.4|size exceeds|message (is )?too large|too big|サイズ(の制限|が制限)/i.test(text)) return "size";
  if (/5\.1\.\d|user unknown|unknown user|does not exist|no (such )?(mailbox|user)|mailbox unavailable|recipient address rejected|invalid recipient|address not found|アドレス不明|見つからなかった|DNS Error|domain name not found|host or domain name not found|Unknown recipient|5\.4\.1|5\.2\.1/i.test(text)) return "hard";
  return "other";
}
const BOUNCE_LABEL: Record<BounceKind, string> = { hard: "宛先不明（アドレスやドメインが存在しない）", full: "相手の受信箱がいっぱい", size: "メールが大きすぎて受け取れない（添付を外すかリンクにしてください）", other: "相手のサーバーに拒否された" };

/** 戻りメールなら、送った会社を「失敗」にして job id を返す。戻りメールでなければ null */
/** 届かなかったことを知らせるメール（配信遅延の通知は除く）なら、本文に出てくる宛先アドレス。違えば null */
function bounceAddrs(mailbox: string, m: IncomingMail): string[] | null {
  const local = (m.from.split("@")[0] ?? "").toLowerCase();
  if (!BOUNCE_FROM_RE.test(local) && !BOUNCE_SUBJECT_RE.test(m.subject)) return null;
  if (/delay|遅延|will retry|まだ配信を試みて/i.test(m.subject)) return null; // 配信遅延の通知は失敗ではない
  return Array.from(new Set((m.text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? []).map((a) => a.toLowerCase())))
    .filter((a) => a !== mailbox.toLowerCase() && !BOUNCE_FROM_RE.test(a.split("@")[0]) && !/googlemail\.com$|google\.com$/.test(a));
}

/** 配送サーバーからの通知（戻り・遅延）か。添付の「元のメールのヘッダー」も読むかどうかの判断に使う */
export function isDeliveryNotice(m: { from: string; subject: string }): boolean {
  return BOUNCE_FROM_RE.test((m.from.split("@")[0] ?? "").toLowerCase()) || BOUNCE_SUBJECT_RE.test(m.subject);
}

// このアプリが送ったメールには、配信停止用のヘッダー（件名「配信停止」の mailto）が必ず付いている。
// 戻りメールに添付された元のヘッダーにこれがあれば、別のPCのApoBoostから同じアカウントで送った分でも「うちの送信」と分かる
// （古い版はヘッダーを Q エンコードしていたので、その形も見る）
const APP_SENT_RE = /List-Unsubscribe:[\s\S]{0,200}?subject(=|=3D)(%E9%85%8D%E4%BF%A1|=E9=85=8D=E4=BF=A1|配信停止)/i;

/** このアプリから送ったメールが戻ってきたものか（記録済みかどうかは問わない）。振り分け用。
 *  applyBounce は「送信済み」の送信だけを失敗に書き換えるので、2回目に読んだときは null になり、
 *  それを見て振り分けると、記録済みの戻りメールがいつまでも受信箱に残ってしまう */
export function isOurBounce(mailbox: string, m: IncomingMail): boolean {
  const addrs = bounceAddrs(mailbox, m);
  if (!addrs) return false;
  if (APP_SENT_RE.test(m.text)) return true;
  if (!addrs.length) return false;
  const db = getDb();
  return addrs.some((addr) => !!db.prepare(`SELECT 1 FROM form_jobs j JOIN form_campaigns c ON c.id=j.campaign_id JOIN sender_profiles s ON s.id=c.sender_id
    WHERE j.is_test=0 AND j.channel='email' AND lower(j.email)=? AND lower(s.smtp_user)=? LIMIT 1`).get(addr, mailbox.toLowerCase()));
}

/** このアプリから送ったメールの「配信が遅れています」通知か（失敗ではないので記録はしないが、受信箱からは外す） */
export function isOurDelayNotice(m: IncomingMail): boolean {
  return isDeliveryNotice(m) && /delay|遅延|will retry|まだ配信を試みて/i.test(m.subject) && APP_SENT_RE.test(m.text);
}

export function applyBounce(mailbox: string, m: IncomingMail): number | null {
  const addrs = bounceAddrs(mailbox, m);
  if (!addrs) return null;
  const db = getDb();
  const at = m.date.toISOString().replace("T", " ").slice(0, 19);
  for (const addr of addrs) {
    const job = db.prepare(`SELECT j.id, j.company_name, j.result_text FROM form_jobs j JOIN form_campaigns c ON c.id=j.campaign_id JOIN sender_profiles s ON s.id=c.sender_id
      WHERE j.is_test=0 AND j.channel='email' AND j.status='sent' AND lower(j.email)=? AND lower(s.smtp_user)=? AND j.sent_at <= datetime(?, '+10 minutes') AND j.sent_at >= datetime(?, '-30 days')
      ORDER BY j.sent_at DESC LIMIT 1`).get(addr, mailbox.toLowerCase(), at, at) as { id: number; company_name: string; result_text: string } | undefined;
    if (!job) continue;
    const kind = bounceKind(m.text + " " + m.subject);
    const reasonLine = (m.text.match(/(\b[45]\d\d[ -][245]\.\d{1,3}\.\d{1,3}[^\n]{0,120}|アドレス不明[^\n]{0,80}|メールサイズ[^\n]{0,80}|DNS Error[^\n]{0,80})/i)?.[0] ?? "").trim();
    db.prepare("UPDATE form_jobs SET status='failed', prev_status='sent', prev_result=?, result_text=?, updated_at=datetime('now') WHERE id=? AND status='sent'")
      .run(job.result_text, `送信後に戻ってきた（届かなかった）: ${BOUNCE_LABEL[kind]}（${addr}）${reasonLine ? `\n${reasonLine}` : ""}`, job.id);
    // 存在しないアドレスには今後も送らない（送り続けると迷惑メール送信者とみなされやすくなる）
    if (kind === "hard") optOut(addr, `宛先不明で届かなかった（${job.company_name}）`);
    return job.id;
  }
  return null;
}

/** SMTPホストから受信用（IMAP）ホストを推定する */
export function imapHostFor(sender: SenderProfile): string {
  const h = (sender.smtp_host || "smtp.gmail.com").trim().toLowerCase();
  if (/office365|outlook|hotmail|live\.com/.test(h)) return "outlook.office365.com";
  return h.replace(/^smtp(-mail)?\./, "imap.");
}

type ScanState = { mailbox: string; uidvalidity: string; last_uid: number; checked_at: string | null; error: string; found: number };

function ensureTable() {
  getDb().exec(`CREATE TABLE IF NOT EXISTS reply_scans (
    mailbox TEXT PRIMARY KEY,
    uidvalidity TEXT NOT NULL DEFAULT '',
    last_uid INTEGER NOT NULL DEFAULT 0,
    checked_at TEXT,
    error TEXT NOT NULL DEFAULT '',
    found INTEGER NOT NULL DEFAULT 0
  )`);
}

async function readStream(s: Readable, max = 200_000): Promise<string> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of s) { const b = Buffer.isBuffer(c) ? c : Buffer.from(c); chunks.push(b); n += b.length; if (n > max) break; }
  return Buffer.concat(chunks).toString("utf8");
}

type Node = { part?: string; type: string; disposition?: string; childNodes?: Node[] };
/** 戻りメールに添付された配送レポート・元のメールのヘッダー。サーバーによっては本文に元の宛先が書かれず、ここにしか無い */
function findReportParts(n: Node | undefined, out: Node[] = []): Node[] {
  if (!n) return out;
  if (/^(message\/(delivery-status|global-delivery-status|rfc822|global|global-headers)|text\/rfc822-headers)$/i.test(n.type ?? "")) out.push(n);
  for (const c of n.childNodes ?? []) findReportParts(c, out);
  return out;
}

function findTextPart(n: Node | undefined, type: string): Node | undefined {
  if (!n) return undefined;
  if (n.type === type && n.disposition !== "attachment") return n;
  for (const c of n.childNodes ?? []) { const f = findTextPart(c, type); if (f) return f; }
  return undefined;
}

let checking = false;

/** 送信用アカウントごとに受信箱を1回確認する。戻り値は記録した件数 */
export async function checkReplies(): Promise<{ recorded: number; errors: string[] }> {
  if (checking) return { recorded: 0, errors: [] };
  checking = true;
  ensureTable();
  const db = getDb();
  let recorded = 0;
  const errors: string[] = [];
  try {
    // 直近90日に送信済みがある送信用アカウントだけ見る（受信箱ごとに1回）
    const senders = db.prepare(`SELECT s.* FROM sender_profiles s WHERE s.smtp_user<>'' AND s.smtp_pass<>'' AND s.reply_check=1
      AND EXISTS (SELECT 1 FROM form_jobs j JOIN form_campaigns c ON c.id=j.campaign_id WHERE c.sender_id=s.id AND j.status='sent' AND j.is_test=0 AND j.sent_at >= datetime('now','-90 days'))
      ORDER BY s.id`).all() as SenderProfile[];
    const seen = new Set<string>();
    for (const s of senders) {
      const mailbox = s.smtp_user.trim().toLowerCase();
      if (seen.has(mailbox)) continue;
      seen.add(mailbox);
      // ログインを拒否された・アカウントが一時停止された場合だけ、受信箱にもログインしない（何度も試すと解除が遅れるため）。
      // 「1日の送信上限」「通信エラー」で送信を止めているだけなら、受信箱は読む（以前はここで一緒に止まり、返信の記録も止まっていた）
      const pausedAny = emailPause(s);
      const paused = pausedAny && /ログイン|拒否|パスワード|2段階|一時停止され|認証|Username|BadCredentials/i.test(pausedAny.reason) ? pausedAny : null;
      if (paused) {
        db.prepare(`INSERT INTO reply_scans(mailbox, checked_at, error) VALUES(?,datetime('now'),?) ON CONFLICT(mailbox) DO UPDATE SET checked_at=excluded.checked_at, error=excluded.error`)
          .run(mailbox, `メール送信の一時停止中のため、受信箱の確認も休止しています（${paused.reason}）`);
        continue;
      }
      const state = (db.prepare("SELECT * FROM reply_scans WHERE mailbox=?").get(mailbox) as ScanState | undefined) ?? { mailbox, uidvalidity: "", last_uid: 0, checked_at: null, error: "", found: 0 };
      const open = async () => {
        const c = new ImapFlow({ host: imapHostFor(s), port: 993, secure: true, auth: { user: s.smtp_user, pass: s.smtp_pass.replace(/^([a-z]{4}) ([a-z]{4}) ([a-z]{4}) ([a-z]{4})$/i, "$1$2$3$4") }, logger: false, socketTimeout: 60_000, ...(s.tls_insecure ? { tls: { rejectUnauthorized: false } } : {}) });
        c.on("error", () => { /* 切断等。下でつなぎ直すか、catch で拾う */ });
        await c.connect();
        return { c, l: await c.getMailboxLock("INBOX") };
      };
      let client: ImapFlow | null = null;
      let found = 0;
      try {
        let opened = await open();
        client = opened.c;
        let lock = opened.l;
        try {
          const mb = client.mailbox;
          const validity = mb && typeof mb === "object" ? String(mb.uidValidity) : "";
          let uids: number[];
          // 振り分けをオンにして最初の1回は、すでに受信箱に溜まっているメールもさかのぼって振り分ける
          const sortOn = Number((s as SenderProfile & { inbox_sort?: number }).inbox_sort ?? 1) === 1;
          // v2: 受付確認の見分け方を広げた（2026-10-04）ので、受信箱に残っていた分をもう一度さかのぼって振り分ける
          const sweepKey = `inbox_sorted_v2:${mailbox}`;
          const needSweep = sortOn && !getSetting(sweepKey, "");
          if (!needSweep && state.uidvalidity === validity && state.last_uid > 0) {
            uids = ((await client.search({ uid: `${state.last_uid + 1}:*` }, { uid: true })) || []).filter((u) => u > state.last_uid);
          } else {
            // 初回（または受信箱が作り直された）: 最初の送信の前日以降に届いたメールを見る
            const first = db.prepare(`SELECT MIN(j.sent_at) t FROM form_jobs j JOIN form_campaigns c ON c.id=j.campaign_id JOIN sender_profiles s ON s.id=c.sender_id
              WHERE lower(s.smtp_user)=? AND j.status='sent' AND j.is_test=0 AND j.sent_at >= datetime('now','-90 days')`).get(mailbox) as { t: string | null };
            const since = new Date(new Date((first.t ?? "").replace(" ", "T") + "Z").getTime() - 86400_000);
            uids = (await client.search({ since: isNaN(since.getTime()) ? new Date(Date.now() - 7 * 86400_000) : since }, { uid: true })) || [];
          }
          let maxUid = state.uidvalidity === validity ? state.last_uid : 0;
          // 振り分けの準備: Gmail なら「ラベル」、それ以外のメールサービスなら「フォルダ」として扱う
          const gmail = client.capabilities.has("X-GM-EXT-1");
          const sorter = sortOn ? makeSorter(() => client!, gmail, [s.company, s.person, s.label].filter(Boolean)) : null;
          let sorted = 0;
          // 受信箱を長く読んでいると Gmail 側から接続を切られることがある。以前は切れた後のメールを黙って飛ばし、
          // しかも「読んだ」扱いにしていたため、振り分けも返信の記録も漏れていた。切れたらつなぎ直して続きから読む
          let reconnects = 0;
          let lost = false;
          const reconnect = async (): Promise<boolean> => {
            if (reconnects >= 5) return false;
            reconnects++;
            try { lock.release(); } catch { /* 既に切れている */ }
            try { client!.close(); } catch { /* 既に閉じている */ }
            try {
              opened = await open();
              client = opened.c;
              lock = opened.l;
              const v = client.mailbox && typeof client.mailbox === "object" ? String(client.mailbox.uidValidity) : "";
              return v === validity; // 受信箱が作り直されていたら、次回に最初から読み直す
            } catch { return false; }
          };
          const list = uids.sort((a, b) => a - b).slice(0, 2000);
          for (let i = 0; i < list.length; i++) {
            const uid = list[i];
            const msg = await client.fetchOne(String(uid), { uid: true, envelope: true, bodyStructure: true, internalDate: true, headers: ["auto-submitted", "x-autoreply", "x-autorespond", "precedence", "x-auto-response-suppress"] }, { uid: true }).catch(() => false as const);
            if (!msg) {
              if (!client.usable) {
                if (await reconnect()) { i--; continue; } // 同じメールから読み直す
                lost = true;
                break;
              }
              maxUid = Math.max(maxUid, uid); // もう無いメール（移動・削除済み）
              continue;
            }
            const addr = msg.envelope?.from?.[0]?.address ?? "";
            if (!addr) { maxUid = Math.max(maxUid, uid); continue; }
            const hdr = msg.headers ? msg.headers.toString("utf8") : "";
            const autoHeader = /auto-submitted:\s*auto-/i.test(hdr) || /x-autore(ply|spond):/i.test(hdr) || /precedence:\s*(auto_reply|bulk|junk)/i.test(hdr);
            let text = "";
            const node = findTextPart(msg.bodyStructure as Node | undefined, "text/plain") ?? findTextPart(msg.bodyStructure as Node | undefined, "text/html");
            if (node) {
              try {
                const dl = await client.download(String(uid), node.part || "1", { uid: true, maxBytes: 200_000 });
                text = await readStream(dl.content);
                if (node.type === "text/html") text = text.replace(/<br\s*\/?>|<\/(p|div|tr|li)>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
              } catch { /* 本文が読めなくても件名だけで判定する */ }
              if (!text && !client.usable) { // 本文を読む途中で切れた
                if (await reconnect()) { i--; continue; }
                lost = true;
                break;
              }
            }
            if (isDeliveryNotice({ from: addr, subject: msg.envelope?.subject ?? "" })) {
              // 元の宛先（To・Final-Recipient）と、このアプリが送ったかどうかの目印は、添付のヘッダー側にある。
              // 元のメールの本文までは足さない（本文の言葉で「戻りの理由」を取り違えないため）
              for (const p of findReportParts(msg.bodyStructure as Node | undefined).slice(0, 3)) {
                try {
                  const dl = await client.download(String(uid), p.part || "2", { uid: true, maxBytes: 30_000 });
                  const raw = await readStream(dl.content, 30_000);
                  text += "\n" + (/rfc822$|^message\/global$/i.test(p.type ?? "") ? raw.split(/\r?\n\r?\n/)[0] : raw);
                } catch { /* 読めなければ本文だけで判定する */ }
              }
            }
            const date = msg.internalDate ? new Date(msg.internalDate) : (msg.envelope?.date ? new Date(msg.envelope.date) : new Date());
            const incoming = { from: addr, subject: msg.envelope?.subject ?? "", text, date, autoHeader };
            let cat: InboxCategory | null;
            if (applyBounce(mailbox, incoming) != null || isOurBounce(mailbox, incoming)) { // 戻りメールは送信結果に反映（反応ではない）
              cat = "bounce";
            } else if (isOurDelayNotice(incoming)) {
              cat = "auto";
            } else {
              if (applyIncomingMail(mailbox, incoming) != null) found++;
              cat = sorter ? inboxCategory(mailbox, incoming, sorter.names) : null;
            }
            maxUid = Math.max(maxUid, uid); // 記録まで済んだ。ここから先（振り分け）が切れても、記録はやり直さない
            if (sorter && cat) {
              let ok = await sorter(uid, cat);
              if (!ok && !client.usable) {
                if (!(await reconnect())) { lost = true; break; }
                ok = await sorter(uid, cat);
              }
              if (ok) sorted++;
            }
          }
          // 移せなかったメールがあれば、次回もさかのぼってやり直す
          if (needSweep && !lost && uids.length <= 2000 && !sorter?.failures.length) setSetting(sweepKey, new Date().toISOString());
          if (sorter) {
            const label: Record<InboxCategory, string> = { auto: "自動返信", bounce: "届かなかった", appointment: "アポ", replied: "返信", declined: "断り" };
            const detail = Object.entries(sorter.counts).map(([k, n]) => `${label[k as InboxCategory]}${n}`).join("・");
            if (sorted) console.log(`[apoboost] 受信箱（${mailbox}）を振り分けました: ${sorted}通（${detail}）`);
            if (sorter.failures.length) console.warn(`[apoboost] 受信箱（${mailbox}）の振り分けで失敗がありました: ${sorter.failures.join(" / ")}`);
          }
          if (lost) console.warn(`[apoboost] 受信箱（${mailbox}）の読み取り中に接続が切れました。次回、続きから読みます`);
          db.prepare(`INSERT INTO reply_scans(mailbox, uidvalidity, last_uid, checked_at, error, found) VALUES(?,?,?,datetime('now'),'',?)
            ON CONFLICT(mailbox) DO UPDATE SET uidvalidity=excluded.uidvalidity, last_uid=excluded.last_uid, checked_at=excluded.checked_at, error='', found=reply_scans.found+excluded.found`)
            .run(mailbox, validity, maxUid, found);
        } finally {
          try { lock.release(); } catch { /* 切断済み */ }
        }
        await client.logout().catch(() => {});
        recorded += found;
      } catch (e) {
        const raw = String((e as Error)?.message ?? e);
        const msg = /auth|login|credentials|535|invalid/i.test(raw + String((e as { responseText?: string })?.responseText ?? ""))
          ? `受信箱（${mailbox}）にログインできませんでした。送信者プロフィールのアプリパスワードを確認してください`
          : /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|timeout/i.test(raw)
            ? `受信箱（${imapHostFor(s)}）に接続できませんでした（ネットワーク、またはこのメールサービスが受信の読み取りに対応していない可能性）`
            : `受信箱（${mailbox}）の確認に失敗: ${raw.slice(0, 120)}`;
        errors.push(msg);
        db.prepare(`INSERT INTO reply_scans(mailbox, checked_at, error) VALUES(?,datetime('now'),?) ON CONFLICT(mailbox) DO UPDATE SET checked_at=excluded.checked_at, error=excluded.error`).run(mailbox, msg);
        try { client?.close(); } catch { /* 既に閉じている */ }
      }
    }
  } finally {
    checking = false;
  }
  return { recorded, errors };
}

export function isCheckingReplies(): boolean {
  return checking;
}

/** キャンペーン画面に出す「返信の自動確認」の状態（このキャンペーンの送信用アカウント分） */
export function replyScanStatus(sender: SenderProfile | undefined): { enabled: boolean; checkedAt: string | null; error: string } {
  if (!sender || !sender.smtp_user || !sender.smtp_pass || sender.reply_check === 0) return { enabled: false, checkedAt: null, error: "" };
  ensureTable();
  const r = getDb().prepare("SELECT checked_at, error FROM reply_scans WHERE mailbox=?").get(sender.smtp_user.trim().toLowerCase()) as { checked_at: string | null; error: string } | undefined;
  return { enabled: true, checkedAt: r?.checked_at ?? null, error: r?.error ?? "" };
}

// ---- 送信の途中でアプリが止まったメールの確認 ----
// 以前は「送信済みか不明・要確認」にして、利用者に Gmail の送信済みフォルダを見てもらっていた。
// 同じ受信箱の読み取り（IMAP）で送信済みフォルダを裏で確認し、送れていれば「送信済み」、
// 送れていなければ「待機」に戻して続きから自動で送る。

export const INTERRUPTED_PREFIX = "送信中にアプリが止まったため中断";

/** 送信済みフォルダにあった同じ宛先のメールの日時から判断する。
 *  中断した送信の開始時刻（claimAt）より少し前以降に送ったものがあれば送信済み。
 *  無い場合、Gmail（送信済みフォルダに必ず控えが残る）なら未送信と判断してよい。それ以外のサービスは控えが残らないことがあるので決めない */
export function decideInterrupted(sentDates: Date[], claimAt: Date, keepsSentCopy: boolean): { verdict: "sent"; at: Date } | { verdict: "not_sent" } | { verdict: "unknown" } {
  const hit = sentDates.filter((d) => d.getTime() >= claimAt.getTime() - 2 * 60_000).sort((a, b) => a.getTime() - b.getTime())[0];
  if (hit) return { verdict: "sent", at: hit };
  return keepsSentCopy ? { verdict: "not_sent" } : { verdict: "unknown" };
}

type InterruptedRow = { id: number; email: string; updated_at: string; sender_id: number };

/** 起動時に呼ぶ。送信中に止まったメールを送信済みフォルダで確認して、送信済み／待機に振り分ける。戻り値は振り分けた件数 */
export async function verifyInterruptedEmails(): Promise<{ sent: number; requeued: number; unknown: number }> {
  const db = getDb();
  const rows = db.prepare(`SELECT j.id, j.email, j.updated_at, c.sender_id FROM form_jobs j JOIN form_campaigns c ON c.id=j.campaign_id
    WHERE j.status='failed' AND j.channel='email' AND j.email<>'' AND j.result_text LIKE ?`).all(`${INTERRUPTED_PREFIX}%`) as InterruptedRow[];
  const out = { sent: 0, requeued: 0, unknown: 0 };
  const bySender = new Map<number, InterruptedRow[]>();
  for (const r of rows) bySender.set(r.sender_id, [...(bySender.get(r.sender_id) ?? []), r]);
  for (const [senderId, jobs] of bySender) {
    const s = db.prepare("SELECT * FROM sender_profiles WHERE id=?").get(senderId) as SenderProfile | undefined;
    if (!s || !s.smtp_user || !s.smtp_pass) { out.unknown += jobs.length; continue; }
    const keepsSentCopy = /gmail|google/i.test(s.smtp_host || "smtp.gmail.com");
    const client = new ImapFlow({ host: imapHostFor(s), port: 993, secure: true, auth: { user: s.smtp_user, pass: s.smtp_pass.replace(/^([a-z]{4}) ([a-z]{4}) ([a-z]{4}) ([a-z]{4})$/i, "$1$2$3$4") }, logger: false, socketTimeout: 60_000, ...(s.tls_insecure ? { tls: { rejectUnauthorized: false } } : {}) });
    client.on("error", () => { /* 下の catch で拾う */ });
    try {
      await client.connect();
      const sentBox = (await client.list()).find((b) => b.specialUse === "\\Sent");
      if (!sentBox) { out.unknown += jobs.length; await client.logout().catch(() => {}); continue; }
      const lock = await client.getMailboxLock(sentBox.path);
      try {
        for (const j of jobs) {
          const claimAt = new Date(j.updated_at.replace(" ", "T") + "Z");
          const uids = (await client.search({ to: j.email, since: new Date(claimAt.getTime() - 86400_000) }, { uid: true })) || [];
          const dates: Date[] = [];
          for (const uid of uids) {
            const m = await client.fetchOne(String(uid), { uid: true, internalDate: true }, { uid: true });
            if (m && m.internalDate) dates.push(new Date(m.internalDate));
          }
          const d = decideInterrupted(dates, claimAt, keepsSentCopy);
          if (d.verdict === "sent") {
            db.prepare("UPDATE form_jobs SET status='sent', sent_at=?, result_text=?, updated_at=datetime('now') WHERE id=? AND status='failed'")
              .run(d.at.toISOString().replace("T", " ").slice(0, 19), `メール送信（${j.email}）※送信中にアプリが止まったが、送信済みフォルダで送信を確認`, j.id);
            out.sent++;
          } else if (d.verdict === "not_sent") {
            // 送れていなかったので待機に戻す（実行中のキャンペーンなら続きで自動送信される）
            db.prepare("UPDATE form_jobs SET status='queued', result_text=?, updated_at=datetime('now') WHERE id=? AND status='failed'")
              .run("再送信待ち: 送信中にアプリが止まったが、送信済みフォルダに無く未送信と確認", j.id);
            out.requeued++;
          } else out.unknown++;
        }
      } finally {
        lock.release();
      }
      await client.logout().catch(() => {});
    } catch {
      // つながらなければ「要確認」のまま（次の起動でもう一度確認する）
      out.unknown += jobs.length;
      try { client.close(); } catch { /* 既に閉じている */ }
    }
  }
  return out;
}
