// 社名の法人格（株式会社など）の判定と、企業HPの本文から正式名称（法人格つき）を読み取る。
// 「株式会社div」を「div」と取り込んでしまった等の取りこぼしを、AIを使わず会社自身の表記（フッター・会社概要・©）から補う。
const ENT = "株式会社|有限会社|合同会社|合資会社|合名会社|一般社団法人|一般財団法人|公益社団法人|公益財団法人|社会福祉法人|医療法人(?:社団|財団)?|学校法人|宗教法人|特定非営利活動法人|NPO法人|事業協同組合|協同組合";
const ENT_RE = new RegExp(`(?:${ENT}|㈱|㈲|\\(株\\)|（株）|\\(有\\)|（有）|\\bInc\\.?|\\bCo\\.,? ?Ltd\\.?|\\bLLC\\b|\\bCorp\\.?|\\bLtd\\.?|\\bK\\.K\\.)`, "i");

/** 社名に法人格が含まれているか */
export function hasEntity(name: string): boolean {
  return ENT_RE.test(name || "");
}

function normalize(s: string): string {
  return s.replace(/㈱|\(株\)|（株）/g, "株式会社").replace(/㈲|\(有\)|（有）/g, "有限会社").replace(/[\s　]+/g, " ");
}
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** HP本文から「法人格＋社名」または「社名＋法人格」を探し、見つかれば正式名称を返す（無ければ null）。
 *  社名に既に法人格があれば null（変更不要）。出現回数が多い形を採用し、同数なら前株（先に見つかった形）を優先。 */
export function extractLegalName(name: string, text: string): string | null {
  const core = (name || "").trim();
  if (!core || hasEntity(core)) return null;
  const t = normalize(text || "");
  const c = escapeRe(normalize(core));
  const pre = new RegExp(`(${ENT})\\s?(${c})(?![A-Za-z0-9])`, "gi");
  const suf = new RegExp(`(?<![A-Za-z0-9])(${c})\\s?(${ENT})`, "gi");
  const count = new Map<string, number>();
  for (const m of t.matchAll(pre)) { const k = `${m[1]}${m[2]}`; count.set(k, (count.get(k) ?? 0) + 1); }
  for (const m of t.matchAll(suf)) { const k = `${m[1]}${m[2]}`; count.set(k, (count.get(k) ?? 0) + 1); }
  if (!count.size) return null;
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
}


// ---- ブラウザを使わずにホームページの文字だけを読む（メール送信の会社でも社名を補えるように。AI不要・0円）----
const LITE_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

function htmlToText(html: string): { title: string; text: string } {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").trim();
  const body = html
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&copy;/g, "©").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/[ \t　]+/g, " ")
    .replace(/\s*\n\s*/g, "\n");
  return { title, text: body.slice(0, 20000) };
}

/** URL の HTML を取得して文字にする（文字コードは HTTP ヘッダ → meta charset の順で判定。Shift_JIS の古いサイト対策）。失敗時は空 */
export async function fetchSiteTextLite(url: string, timeoutMs = 7000): Promise<{ title: string; text: string }> {
  try {
    const r = await fetch(url, { headers: { "User-Agent": LITE_UA, Accept: "text/html,*/*", "Accept-Language": "ja" }, redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok || !/html|text/i.test(r.headers.get("content-type") || "text/html")) return { title: "", text: "" };
    const buf = new Uint8Array(await r.arrayBuffer());
    const head = new TextDecoder("latin1").decode(buf.slice(0, 4000));
    let cs = (r.headers.get("content-type")?.match(/charset=([\w-]+)/i)?.[1] || head.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1] || "utf-8").toLowerCase();
    if (/sjis|x-sjis|shift-jis/.test(cs)) cs = "shift_jis";
    let html: string;
    try { html = new TextDecoder(cs).decode(buf); } catch { html = new TextDecoder("utf-8").decode(buf); }
    return htmlToText(html);
  } catch {
    return { title: "", text: "" };
  }
}

/** 社名に法人格が無いとき、会社のホームページ（トップ → よくある会社概要ページ）の表記から正式名称を探す。
 *  見つからなければ null。text は site_cache に残せるようトップページ分を返す */
export async function findLegalNameFromSite(name: string, siteUrl: string): Promise<{ legal: string | null; top: { title: string; text: string } }> {
  let origin = "";
  try { origin = new URL(siteUrl).origin; } catch { return { legal: null, top: { title: "", text: "" } }; }
  const top = await fetchSiteTextLite(siteUrl);
  let legal = extractLegalName(name, `${top.title}\n${top.text}`);
  // 末尾スラッシュ有り・無しの片方でしか開けないサイトがあるので両方見る
  for (const p of ["/company/", "/company", "/about/", "/company.html", "/corporate/", "/profile/"]) {
    if (legal) break;
    const sub = await fetchSiteTextLite(origin + p, 5000);
    if (sub.text) legal = extractLegalName(name, `${sub.title}\n${sub.text}`);
  }
  return { legal, top };
}
