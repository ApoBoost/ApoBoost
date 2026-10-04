// 文面生成: テンプレート差し込み / AI個別生成 / ハイブリッド（テンプレの骨格＋冒頭だけAI）
// AIプロバイダは本体の src/lib/server/llm.ts と同じ考え方（ANTHROPIC_API_KEY があれば Claude、無ければ Gemini、どちらも無ければテンプレのみ）
import type { Campaign, Job, SenderProfile } from "./db.js";
import { getDb } from "./db.js";

export type Vars = Record<string, string>;

/** 名前に「様」を付ける。連名（「真子 就有、石原 圭」「A／B」「A,B」「A および B」等）は一人ずつ「様」を付けて「、」でつなぐ。
 *  すでに 様/さん/殿 が付いていれば重ねない。空なら「ご担当者様」。
 *  「・」はカタカナ名の中（マイケル・ジョーダン）に出るため区切りとして扱わない。 */
export function withSama(raw: string | null | undefined): string {
  const parts = String(raw ?? "")
    .split(/[、,，／/＆&]|[\s　]+(?:および|及び|と)[\s　]+/)
    .map((x) => x.replace(/^[\s　]+|[\s　]+$/g, "").replace(/(様|さん|殿)$/, "").replace(/[\s　]+$/g, ""))
    .filter(Boolean);
  if (!parts.length) return "ご担当者様";
  return parts.map((x) => `${x}様`).join("、");
}

export function buildVars(job: Pick<Job, "company_name" | "industry" | "sub_industry" | "prefecture" | "representative">, sender: SenderProfile): Vars {
  return {
    会社名: job.company_name,
    企業名: job.company_name,
    業種: job.sub_industry || job.industry,
    大業界: job.industry,
    小業界: job.sub_industry,
    都道府県: job.prefecture,
    代表者名: job.representative,
    代表者: withSama(job.representative), // 連名は全員に様（「A、B様」にならないように）
    自社名: sender.company,
    担当者: sender.person,
    自社メール: sender.email,
    自社電話: sender.tel,
    自社URL: sender.url,
  };
}

export function renderTemplate(tpl: string, vars: Vars): string {
  // テンプレに「{{代表者名}}様」「{{代表者}}様」と書かれていても、連名で一人ずつ様が付く {{代表者}} に寄せる（様の重複も防ぐ）
  const t = tpl.replace(/\{\{\s*代表者名?\s*\}\}[\s　]*様/g, "{{代表者}}");
  // 知らない差し込み名（{{企業}} のような書き間違い）は置き換えずに残し、送る前の文面チェック（lintMessage）で止める。
  // 以前は黙って空文字になり「 様」「の件で」のような欠けた文面のまま送られていた。
  // 知っている名前で値が空のもの（{{業種}} が無い会社など）は、これまでどおり空にする（既存の文面が急に止まらないように）
  return t.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (m, k: string) => (Object.prototype.hasOwnProperty.call(vars, k) ? vars[k] ?? "" : m));
}

// ---- LLM ----
export type Provider = "anthropic" | "gemini" | "none";

// 選べるモデル（設定画面のドロップダウンと料金表の元）
export const AI_MODELS: Record<"anthropic" | "gemini", { id: string; label: string }[]> = {
  anthropic: [
    { id: "claude-haiku-4-5", label: "Claude Haiku（安い・速い。まずはこれ）" },
    { id: "claude-sonnet-5", label: "Claude Sonnet（文面の質が高い）" },
  ],
  gemini: [
    { id: "gemini-3.6-flash-lite", label: "Gemini Flash-Lite（最安）" },
    { id: "gemini-3.6-flash", label: "Gemini Flash（標準）" },
  ],
};
const DEFAULT_MODEL: Record<"anthropic" | "gemini", string> = { anthropic: "claude-haiku-4-5", gemini: "gemini-3.6-flash" };

export type AiConfig = { provider: Provider; apiKey: string; model: string; source: "settings" | "env" | "none" };

/** AI設定の解決順: 設定画面（DB）→ 環境変数 → なし。キーは data/ のDBに入り、gitには載らない */
export function activeAiConfig(): AiConfig {
  try {
    const db = getDb();
    const get = (k: string) => (db.prepare("SELECT value FROM settings WHERE key=?").get(k) as { value: string } | undefined)?.value ?? "";
    const provider = get("ai_provider");
    const apiKey = get("ai_api_key");
    if ((provider === "anthropic" || provider === "gemini") && apiKey) {
      const model = get("ai_model") || DEFAULT_MODEL[provider];
      const valid = AI_MODELS[provider].some((m) => m.id === model) ? model : DEFAULT_MODEL[provider];
      return { provider, apiKey, model: valid, source: "settings" };
    }
  } catch { /* DB未初期化のタイミングでは env にフォールバック */ }
  if (process.env.ANTHROPIC_API_KEY) return { provider: "anthropic", apiKey: process.env.ANTHROPIC_API_KEY, model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL.anthropic, source: "env" };
  if (process.env.GEMINI_API_KEY) return { provider: "gemini", apiKey: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL || DEFAULT_MODEL.gemini, source: "env" };
  return { provider: "none", apiKey: "", model: "", source: "none" };
}

export function activeProvider(): Provider {
  return activeAiConfig().provider;
}

/** 画面表示用: 「none」または「anthropic / claude-haiku-4-5」 */
export function aiStatusLabel(): string {
  const c = activeAiConfig();
  return c.provider === "none" ? "none" : `${c.provider} / ${c.model}`;
}

// ---- AIの利用量と上限（#66）----
// 「AIを使うといくらかかるか読めない」のが不安で使われない。使った量を記録し、月の上限を超えたら自動でテンプレに戻す。
// 料金は1Mトークンあたりの目安（円）。為替や改定で変わるため「目安」として表示する
const PRICE_JPY: Record<string, { in: number; out: number }> = {
  "claude-haiku-4-5": { in: 160, out: 800 },
  "claude-sonnet-5": { in: 480, out: 2400 },
  "gemini-3.6-flash-lite": { in: 20, out: 60 },
  "gemini-3.6-flash": { in: 50, out: 150 },
};
export type AiUsage = { calls: number; input: number; output: number; jpy: number };
const usageKey = () => `ai_usage:${new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 7)}`;

export function aiUsageThisMonth(): AiUsage {
  try {
    const row = getDb().prepare("SELECT value FROM settings WHERE key=?").get(usageKey()) as { value: string } | undefined;
    const u = row ? (JSON.parse(row.value) as AiUsage) : null;
    return u ?? { calls: 0, input: 0, output: 0, jpy: 0 };
  } catch { return { calls: 0, input: 0, output: 0, jpy: 0 }; }
}
export function aiMonthlyLimit(): number {
  try {
    const row = getDb().prepare("SELECT value FROM settings WHERE key='ai_monthly_limit_jpy'").get() as { value: string } | undefined;
    return Math.max(0, Number(row?.value ?? 0) || 0);
  } catch { return 0; }
}
/** 月の上限を超えているか（超えていたらAIを使わず、テンプレで送る） */
export function aiOverBudget(): boolean {
  const limit = aiMonthlyLimit();
  return limit > 0 && aiUsageThisMonth().jpy >= limit;
}
function recordUsage(model: string, input: number, output: number) {
  try {
    const p = PRICE_JPY[model] ?? { in: 200, out: 1000 };
    const add = (input / 1_000_000) * p.in + (output / 1_000_000) * p.out;
    const u = aiUsageThisMonth();
    const next: AiUsage = { calls: u.calls + 1, input: u.input + input, output: u.output + output, jpy: Math.round((u.jpy + add) * 100) / 100 };
    getDb().prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(usageKey(), JSON.stringify(next));
  } catch { /* 記録に失敗しても送信は続ける */ }
}

export async function llm(system: string, user: string, maxTokens = 600): Promise<string> {
  const c = activeAiConfig();
  if (aiOverBudget()) throw new Error(`今月のAI利用の上限（${aiMonthlyLimit()}円）に達したため、AIは使いません（テンプレートで送ります）。設定画面で上限を変更できます`);
  if (c.provider === "anthropic") {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": c.apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: c.model, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = (await res.json()) as { content: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } };
    recordUsage(c.model, j.usage?.input_tokens ?? 0, j.usage?.output_tokens ?? 0);
    return j.content.filter((c2) => c2.type === "text").map((c2) => c2.text ?? "").join("").trim();
  }
  if (c.provider === "gemini") {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${c.model}:generateContent?key=${c.apiKey}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: user }] }], generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 } }),
    });
    if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } };
    recordUsage(c.model, j.usageMetadata?.promptTokenCount ?? 0, j.usageMetadata?.candidatesTokenCount ?? 0);
    return (j.candidates?.[0]?.content?.parts ?? []).map((x) => x.text ?? "").join("").trim();
  }
  throw new Error("AIのAPIキーが設定されていません（設定画面から登録できます）");
}

/** 文面のAI生成の失敗が「自分側の原因」（どの会社でも同じように失敗する）かを見分ける。
 *  以前は APIキーの失効・残高切れ・混雑（429）・回線断のとき、待機中の会社を1社ずつ「失敗」にして、全社が次々失敗になっていた。
 *  - config:    APIキー・残高・モデルの問題。直すまで何度やっても失敗するので、キャンペーンを一時停止して知らせる
 *  - transient: 混雑・回線の問題。minutes 分だけAIを使う送信を止め、その後に自動で続ける
 *  - null:      その会社だけの問題（または判断できない）。これまでどおり、その会社を失敗にする */
export function aiErrorKind(e: unknown): { kind: "config" | "transient"; minutes: number } | null {
  const msg = `${String((e as Error)?.message ?? e)} ${String(((e as { cause?: { code?: string; message?: string } })?.cause?.code) ?? "")}`;
  const status = Number(msg.match(/^(?:anthropic|gemini) (\d{3})/)?.[1]) || 0;
  // 月の上限（設定）に達した: 次の文面からテンプレートに切り替わるので、止めずにすぐ続ける
  if (/今月のAI利用の上限/.test(msg)) return { kind: "transient", minutes: 0 };
  if (status === 401 || status === 403 || /invalid.{0,20}(api.?key|x-api-key)|API key not valid|API_KEY_INVALID|PERMISSION_DENIED|authentication_error|credit balance|billing|insufficient[_ ]quota/i.test(msg)) return { kind: "config", minutes: 0 };
  if (status === 404 || (status === 400 && /model/i.test(msg))) return { kind: "config", minutes: 0 };
  if (status === 429 || /rate.?limit|RESOURCE_EXHAUSTED/i.test(msg)) return { kind: "transient", minutes: 5 };
  if (status === 408 || status >= 500 || /overloaded/i.test(msg)) return { kind: "transient", minutes: 10 };
  // 回線断（Node の fetch は「fetch failed」＋原因のコード）。ブラウザ（Playwright）のタイムアウト等は会社ごとの問題なので含めない
  if (/fetch failed|ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|UND_ERR_|other side closed/i.test(msg)) return { kind: "transient", minutes: 10 };
  return null;
}

/** 接続テスト。成功なら null、失敗なら利用者向けの説明文を返す */
export async function testAiConnection(): Promise<string | null> {
  try {
    await llm("テスト接続です。", "「OK」とだけ返してください。", 16);
    return null;
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    if (/401|403|invalid.*key|API key|PERMISSION_DENIED|unauthorized/i.test(msg)) return "APIキーが正しくない可能性があります。コピーミスが無いか確認してください";
    if (/404|not.*found|model/i.test(msg) && /model/i.test(msg)) return "選んだモデルが使えないようです。別のモデルを試してください";
    if (/429|rate|quota|billing|credit/i.test(msg)) return "利用上限か支払い設定の問題のようです。プロバイダの管理画面で残高・上限を確認してください";
    if (/fetch failed|ENOTFOUND|ECONN|network/i.test(msg)) return "インターネット接続に失敗しました。回線を確認してください";
    return `接続に失敗しました: ${msg.slice(0, 160)}`;
  }
}

const SYSTEM_BASE = `あなたは日本のBtoB営業担当のアシスタントです。企業の問い合わせフォームに送る営業メッセージを書きます。
守ること:
- 丁寧なビジネス日本語。誇張・断定・虚偽の実績は書かない。絵文字・記号装飾は使わない
- 相手企業の情報に触れるときは、渡された情報にある事実だけを使う。無い情報は推測で書かない
- 「お忙しいところ恐れ入ります」等の定型は最小限。相手にとっての具体的なメリットを1つに絞る
- 末尾に必ず連絡先（送信者名・メール）を入れる。返信不要・配信停止の一文を添える

文体（初対面の企業への礼儀。厳守）:
- 「〜ですね」「〜されていますね」「〜に取り組まれていますね」のような、馴れ馴れしい相づち・断定は使わない
- 相手企業を評価・講評しない（「素晴らしい」「注目しています」等も上から目線になるため不可）
- 相手のミッション・理念・スローガンを引用しない
- 相手企業への言及は1文までにとどめ、「〜と拝見いたしました」「〜と存じます」のような謙譲・推量の形で控えめに書く
- 全体を通して、初めて連絡する相手への謙虚で簡潔な文面にする`;

/** ハイブリッド: テンプレの {{AI冒頭}} 部分だけを企業ごとに生成 */
export async function generateOpening(job: Job, sender: SenderProfile, campaign: Campaign, site: { title: string; text: string }): Promise<string> {
  const info = [`会社名: ${job.company_name}`, job.industry && `業種: ${job.industry}${job.sub_industry ? ` / ${job.sub_industry}` : ""}`, job.prefecture && `所在地: ${job.prefecture}`, site.title && `サイトタイトル: ${site.title}`, site.text && `サイト本文（抜粋）: ${site.text.slice(0, 2000)}`]
    .filter(Boolean)
    .join("\n");
  const user = `次の企業に送る営業メッセージの「冒頭の1〜2文」だけを書いてください。この後にこちらのサービス紹介文が続きます。
相手企業の事業内容に「〜と拝見いたしました」のような謙譲表現で控えめに触れ、「なぜ貴社に連絡したか」が伝わるようにしてください。相づち（〜ですね）や講評は不可。挨拶（突然のご連絡失礼いたします 等）は不要で、いきなり本題の1〜2文だけを出力してください。60〜120文字。

【相手企業】
${info}

【こちらのサービス（参考）】
${campaign.template_text.slice(0, 800)}

${campaign.ai_instruction ? `【追加指示】\n${campaign.ai_instruction}` : ""}`;
  const out = await llm(SYSTEM_BASE, user, 300);
  return out.replace(/^["「]|["」]$/g, "").trim();
}

/** 全文AI生成 */
export async function generateFullMessage(job: Job, sender: SenderProfile, campaign: Campaign, site: { title: string; text: string }): Promise<string> {
  const info = [`会社名: ${job.company_name}`, job.industry && `業種: ${job.industry}${job.sub_industry ? ` / ${job.sub_industry}` : ""}`, job.prefecture && `所在地: ${job.prefecture}`, site.title && `サイトタイトル: ${site.title}`, site.text && `サイト本文（抜粋）: ${site.text.slice(0, 2500)}`]
    .filter(Boolean)
    .join("\n");
  const user = `次の企業の問い合わせフォームに送る営業メッセージ全文を書いてください。400〜600文字。冒頭は名乗りから入り、相手企業の事業には1文だけ謙譲表現（〜と拝見いたしました 等）で控えめに触れてください。そのうえで、こちらのサービスが相手にどう役立つかを1点に絞って伝え、最後に「ご興味があればご返信ください」と連絡先で締めてください。

【相手企業】
${info}

【こちらのサービス・伝えたいこと】
${campaign.template_text}

【送信者】
${sender.company} ${sender.person}
メール: ${sender.email}${sender.tel ? ` / 電話: ${sender.tel}` : ""}${sender.url ? ` / ${sender.url}` : ""}

${campaign.ai_instruction ? `【追加指示】\n${campaign.ai_instruction}` : ""}`;
  return llm(SYSTEM_BASE, user, 900);
}

/** キャンペーンのモードに応じて最終文面を作る */
/** A/Bテスト（#64）: 会社ごとに A と B を交互に割り当てる（ID の偶数・奇数。毎回同じ結果になる） */
export function variantFor(job: Pick<Job, "id">, campaign: Campaign): "A" | "B" {
  if (!campaign.ab_enabled || !String(campaign.template_b ?? "").trim()) return "A";
  return job.id % 2 === 0 ? "A" : "B";
}

/** 件名のローテーション（#65）: 同じ件名を大量に送ると迷惑メール判定されやすいので、登録した複数案を順番に使う */
export function subjectFor(job: Pick<Job, "id">, campaign: Campaign, variant: "A" | "B"): string {
  if (variant === "B" && String(campaign.subject_b ?? "").trim()) return campaign.subject_b.trim();
  const list = [campaign.subject_text || "サービスのご案内", ...String(campaign.subject_alts ?? "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean)];
  return list[job.id % list.length];
}

export async function composeMessage(job: Job, sender: SenderProfile, campaign: Campaign, site: { title: string; text: string }): Promise<{ subject: string; message: string; aiUsed: boolean; variant: "A" | "B" }> {
  const vars = buildVars(job, sender);
  vars["資料リンク"] = campaign.material_url || "";
  const variant = variantFor(job, campaign);
  const template = variant === "B" ? campaign.template_b : campaign.template_text;
  // 件名の {{AI冒頭}} は以前から空にしていたので、そのまま空にする（知らない名前の扱いだけを変える）
  const subject = renderTemplate(subjectFor(job, campaign, variant), { ...vars, AI冒頭: "" });
  let message: string;
  let aiUsed = false;
  const canAi = activeProvider() !== "none" && !aiOverBudget();

  if (campaign.mode === "ai" && canAi) {
    message = await generateFullMessage(job, sender, campaign, site);
    aiUsed = true;
  } else if (campaign.mode === "hybrid" && canAi && template.includes("{{AI冒頭}}")) {
    let opening = "";
    try { opening = await generateOpening(job, sender, campaign, site); } catch { opening = ""; }
    const weak = opening.replace(/\s/g, "").length < 25 || /^(申し訳|すみません|I |As an AI)/.test(opening) || /\{\{/.test(opening);
    if (weak) opening = vars.業種 ? `${vars.業種}の事業を展開されている貴社に、ぜひご案内したいサービスがありご連絡いたしました。` : "貴社のホームページを拝見し、ぜひご案内したいサービスがありご連絡いたしました。";
    else aiUsed = true;
    message = renderTemplate(template, { ...vars, AI冒頭: opening });
  } else {
    // テンプレのみ（AI不可・AIの上限超過の場合のフォールバックも兼ねる）
    const fallbackOpening = vars.業種 ? `${vars.業種}の事業を展開されている貴社に、ぜひご案内したいサービスがありご連絡いたしました。` : "貴社のホームページを拝見し、ぜひご案内したいサービスがありご連絡いたしました。";
    message = renderTemplate(template, { ...vars, AI冒頭: fallbackOpening });
  }
  message = message.trim();
  // フォーム送信では資料を添付できないので、公開リンクを本文末尾に載せる（メールは添付ファイルで送るため載せない）。
  // テンプレに {{資料リンク}} を自分で置いている場合は二重にしない。
  // キャンペーンで「メールの本文にもこのリンクを載せる」にした場合はメールにも載せる
  const linkInBody = job.channel === "form" || (job.channel === "email" && Number((campaign as { material_url_in_email?: number }).material_url_in_email ?? 0) === 1);
  if (linkInBody && campaign.material_url && !message.includes(campaign.material_url)) {
    message += `\n\n▼サービス資料はこちらからご覧いただけます\n${campaign.material_url}`;
  }
  return { subject, message, aiUsed, variant };
}

// ---- NGワード ----
export function loadNgWords(): string[] {
  try {
    const rows = getDb().prepare("SELECT value FROM settings WHERE key='ng_words'").get() as { value: string } | undefined;
    return rows ? (JSON.parse(rows.value) as string[]) : [];
  } catch {
    return [];
  }
}
export function findNgWords(text: string, words = loadNgWords()): string[] {
  return words.filter((w) => w && text.includes(w));
}

// 新規キャンペーンの初期文面。どの会社でも使えるひな形にし、【ここに…】を書き換えないと送信できないようにする
// （以前は開発元のサービス紹介文が入っており、他社が気づかずに送ると別会社の宣伝になってしまうため）
export const DEFAULT_TEMPLATE = `{{会社名}}
{{代表者}}

突然のご連絡失礼いたします。{{自社名}}の{{担当者}}と申します。

{{AI冒頭}}

弊社は【ここにサービス名と、何を提供しているかを1〜2行で】を提供しております。
【ここに、相手の会社にとってのメリットを1〜2行で】

もしご興味がございましたら、本メールへのご返信、または下記までご連絡いただけますと幸いです。
サービス資料をお送りいたします。

{{自社名}} {{担当者}}
メール: {{自社メール}}
電話: {{自社電話}}
{{自社URL}}

※本メッセージが不要な場合は、お手数ですが上記メールまでその旨ご連絡ください。以後のご連絡は控えさせていただきます。`;
export const DEFAULT_SUBJECT = "【ここに件名】のご案内";

export type Lint = { level: "error" | "warn"; text: string };

/** 送る前の文面チェック。error は送信を止める、warn は注意表示 */
export function lintMessage(message: string, subject: string, channel: "form" | "email" | "both" = "both"): Lint[] {
  const out: Lint[] = [];
  if (/【ここに/.test(message)) out.push({ level: "error", text: "本文の【ここに…】の部分が未記入です" });
  if (/【ここに/.test(subject)) out.push({ level: "error", text: "件名の【ここに…】の部分が未記入です" });
  const leftover = message.match(/\{\{[^}]+\}\}/g);
  if (leftover) out.push({ level: "error", text: `差し込みが置き換わっていません: ${Array.from(new Set(leftover)).join(" ")}` });
  const subjectLeft = subject.match(/\{\{[^}]+\}\}/g);
  if (subjectLeft) out.push({ level: "error", text: `件名の差し込みが置き換わっていません: ${Array.from(new Set(subjectLeft)).join(" ")}` });
  const len = message.replace(/\s/g, "").length;
  if (len < 120) out.push({ level: "warn", text: `本文が短すぎます（${len}文字）。200〜500文字が目安です` });
  if (len > 1200) out.push({ level: "warn", text: `本文が長すぎます（${len}文字）。600文字以内が目安です` });
  const spam = ["無料", "今すぐ", "限定", "絶対", "100%", "必ず", "儲か", "保証", "激安", "格安", "最安", "驚き", "秘密", "緊急", "先着", "当選", "お金", "稼げ", "!!", "！！", "★", "☆", "■■"];
  const hits = spam.filter((w) => message.includes(w) || subject.includes(w));
  if (hits.length) out.push({ level: "warn", text: `迷惑メール判定されやすい語: ${hits.join("、")}` });
  const urls = message.match(/https?:\/\/\S+/g) ?? [];
  if (urls.length > 2) out.push({ level: "warn", text: `URLが${urls.length}個あります。2個以内が安全です` });
  if (!/(@|メール|mail)/i.test(message)) out.push({ level: "warn", text: "連絡先（メールアドレス）が本文にありません" });
  if (channel !== "form" && !/(不要|停止|配信|ご連絡は控え)/.test(message)) out.push({ level: "warn", text: "「不要な場合はご連絡ください」の一文がありません" });
  if (!subject.trim()) out.push({ level: "warn", text: "件名が空です" });
  // 件名が長いとメール一覧で途中で切れて読まれにくい（全角30文字が目安）
  else if (subject.trim().length > 30) out.push({ level: "warn", text: `件名が長めです（${subject.trim().length}文字）。30文字以内だと一覧で切れずに読まれやすくなります` });
  // 改行の無い長文は読みにくい（段落で区切ると開封後に読んでもらいやすい）
  if (len >= 200 && !message.includes("\n")) out.push({ level: "warn", text: "本文に改行がありません。2〜3段落に分けると読みやすくなります" });
  return out;
}
