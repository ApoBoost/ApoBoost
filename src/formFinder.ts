// 問い合わせフォームのページを見つける。DBのフォームURL → 企業URL内のリンク → よくあるパス の順。
import type { Page } from "playwright";

// 表記ゆれ対応（#3）: 送り仮名違い・英語・ローマ字・「メールフォーム」等も拾う
const CONTACT_LINK_RE = /(お問い?合わ?せ|お問合せ|お問い合せ|問合せ|問い合せ|ご相談|ご依頼|ご意見|ご質問|お見積|見積り?依頼|資料請求|メールフォーム|申し?込み?フォーム|contact|inquiry|inquire|enquiry|toiawase|otoiawase|soudan|mail-?form|mailform|form)/i;
const NEGATIVE_LINK_RE = /(採用|recruit|entry|求人|新卒|中途|faq|よくある|privacy|プライバシー|sitemap|login|ログイン|mypage|cart|カート|会員|member|ir\/|press|取材)/i;
const COMMON_PATHS = [
  "/contact/", "/contact", "/contact.html", "/contact.php", "/contact.cgi", "/contact/index.html", "/contact/index.php",
  "/inquiry/", "/inquiry", "/inquiry.html", "/inquiry.php", "/inquiry/index.html", "/enquiry/",
  "/otoiawase/", "/toiawase/", "/toiawase.html", "/otoiawase.html",
  "/form/", "/form", "/mailform/", "/mail-form/", "/mailform.html", "/mail/", "/form/contact/", "/contact/form/", "/contact/mail/",
  "/contact-us/", "/contactus/", "/contact_us/", "/contact-us", "/ja/contact/", "/jp/contact/", "/en/contact/",
  "/company/contact/", "/info/contact/", "/support/contact/", "/support/", "/soudan/", "/request/", "/estimate/",
];

// よく使われる外部フォームサービス（#4）。iframe や埋め込みスクリプトで入ることが多く、
// 本体のHTMLだけを見ると「フォーム無し」に見える
const FORM_SERVICE_RE: [string, RegExp][] = [
  ["Googleフォーム", /docs\.google\.com\/forms|forms\.gle/i],
  ["formrun", /formrun\.(app|io)/i],
  ["HubSpot", /(hsforms\.(net|com)|js\.hs-scripts\.com|hubspot)/i],
  ["Typeform", /typeform\.com/i],
  ["formzu", /formzu\.(com|net|jp)/i],
  ["フォームメーラー", /form-mailer\.jp|ssl\.form-mailer\.jp/i],
  ["Tayori", /tayori\.com/i],
  ["SATORI", /satori\.marketing|satoriapp\.com/i],
  ["Zoho", /zohopublic|forms\.zohopublic/i],
  ["SurveyMonkey", /surveymonkey/i],
  ["kintone", /kintoneapp\.com|form\.kintone/i],
  ["Shopify/Wix等のフォーム", /wix\.com\/form|shopify.*contact/i],
];

/** 外部フォームサービスが埋め込まれていれば、その名前と（あれば）フレームのURLを返す */
export async function detectFormService(page: Page): Promise<{ name: string; frameUrl: string } | null> {
  for (const fr of page.frames()) {
    const u = fr.url() || "";
    const hit = FORM_SERVICE_RE.find(([, re]) => re.test(u));
    if (hit) return { name: hit[0], frameUrl: u };
  }
  const html = await page.evaluate(() => {
    const srcs = Array.from(document.querySelectorAll("script[src], iframe[src], form[action]"))
      .map((e) => e.getAttribute("src") || e.getAttribute("action") || "")
      .join(" ");
    return srcs.slice(0, 4000);
  }).catch(() => "");
  const hit2 = FORM_SERVICE_RE.find(([, re]) => re.test(html));
  return hit2 ? { name: hit2[0], frameUrl: "" } : null;
}

export const HAS_FORM_SCRIPT = `
(() => {
  const forms = Array.from(document.querySelectorAll('form'));
  const isVisible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  for (const f of forms) {
    const ta = f.querySelector('textarea');
    const inputs = Array.from(f.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button])'));
    // 本文欄が2ページ目（最初は非表示）にある段階式フォームも拾う: textarea があり、見えている入力欄が1つ以上
    if (ta && inputs.some(isVisible)) return true;
    // textarea が無くても、メール欄＋3つ以上の入力欄＋送信ボタンがあれば問い合わせフォームとみなす
    const vis = inputs.filter(isVisible);
    const hasMail = vis.some((i) => /mail|メール/i.test((i.getAttribute('name') || '') + (i.getAttribute('type') || '') + (i.getAttribute('placeholder') || '') + (i.id || '')));
    const btn = f.querySelector('button, input[type=submit], input[type=image]');
    if (vis.length >= 3 && hasMail && btn && !/search|検索|login|ログイン|newsletter|メルマガ/i.test(f.outerHTML.slice(0, 2000))) return true;
  }
  // formタグ無しでもtextarea + 送信ボタンがあれば（SPA系）
  const ta = document.querySelector('textarea');
  if (ta && isVisible(ta)) {
    const btn = Array.from(document.querySelectorAll('button, input[type=submit]')).find(b => /送信|確認|submit|send|次へ/i.test((b.innerText || b.value || '')));
    if (btn) return true;
  }
  // formタグ無し・textarea無しの疑似フォーム（JSで独自送信）: 見えている入力欄が3つ以上＋メール欄＋送信ボタンらしき要素
  const allInputs = Array.from(document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=search]), textarea')).filter(isVisible);
  const hasMail2 = allInputs.some((i) => /mail|メール|e-?mail/i.test((i.getAttribute('name') || '') + (i.getAttribute('type') || '') + (i.getAttribute('placeholder') || '') + (i.id || '')));
  const submitLike = Array.from(document.querySelectorAll('button, input[type=submit], [role=button], a')).some((b) => /送信|確認|申し込|申込|submit|send|問い?合わ?せる|内容を確認/i.test(((b.innerText || b.value || b.getAttribute('aria-label') || '')).trim()) && isVisible(b));
  if (allInputs.length >= 3 && hasMail2 && submitLike) return true;
  return false;
})()`;

// 「お問い合わせはこちら」等、クリックするとモーダル/パネルでフォームが開くトリガーを探して押す
const CLICK_TRIGGER_SCRIPT = `
(() => {
  const re = /(お問い?合わ?せ(はこちら|する|フォーム)?|問合せ|ご相談|ご依頼|資料請求|contact\\s*(us|form)?|inquiry|メールで(送る|問い合わせ)|フォームを開く|入力フォーム)/i;
  const isVisible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const cands = Array.from(document.querySelectorAll('button, a, [role=button], [onclick], [class*=contact], [class*=btn]'))
    .filter((el) => isVisible(el) && re.test(((el.innerText || el.getAttribute('aria-label') || el.value || '')).trim().slice(0, 40)) && (el.innerText || '').length < 30);
  if (!cands.length) return false;
  cands[0].scrollIntoView({ block: 'center' });
  cands[0].click();
  return true;
})()`;

async function scanFrames(page: Page): Promise<boolean> {
  // 本体 → 埋め込み iframe（Googleフォーム・フォーム作成サービス等）の順に見る
  for (const fr of page.frames()) {
    // about:blank の隠しフレーム等で evaluate が返らないことがあるので、3秒で見切る
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const has = await Promise.race([fr.evaluate(HAS_FORM_SCRIPT), new Promise((res) => { timer = setTimeout(() => res(false), 3000); })]);
      if (has) return true;
    } catch {
      /* クロスオリジン等 */
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  return false;
}

// ---- 問い合わせ以外のフォーム（求職者向けの登録・応募・会員登録）を見分ける ----
// 人材会社のサイトでは「お問い合わせ」より「スタッフ登録」「お仕事をお探しの方」のフォームが目立つ場所にあり、
// 営業リストのURLがそちらを指していることもある。そこに入力すると、勝手に人材登録や応募をしたことになってしまう（実例あり）。
// 入力欄の中身（生年月日・希望職種・最寄駅…）と、ページの見出し・URL・ボタンの言葉から見分ける。
// 迷ったら「問い合わせフォーム」として扱う（企業向けの問い合わせを取りこぼす害もあるため、断定できるときだけ外す）
const NON_INQUIRY_SCRIPT = `
(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const forms = document.querySelectorAll('form');
  let best = null, bestN = 0;
  for (let i = 0; i < forms.length; i++) {
    const f = forms[i];
    if (f.getAttribute('role') === 'search' || f.querySelector('input[type=search], input[name="s"], input[name="q"]')) continue;
    const ins = f.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=image]), textarea, select');
    let n = 0; for (let k = 0; k < ins.length; k++) if (vis(ins[k])) n++;
    if (f.querySelector('textarea')) n += 3; // 本文欄のあるフォームを優先
    if (n > bestN) { bestN = n; best = f; }
  }
  // フォームの中の言葉（見出し・ラベル・ボタン）
  const formText = best ? (best.innerText || '').replace(/\\s+/g, ' ').slice(0, 6000) : '';
  // フォームの直前の見出し（フォームが何のためのものかを言っている）
  let heading = '';
  if (best) {
    let el = best;
    for (let hops = 0; el && hops < 6 && !heading; hops++) {
      let p = el.previousElementSibling;
      for (let k = 0; p && k < 4 && !heading; k++, p = p.previousElementSibling) {
        if (/^H[1-4]$/.test(p.tagName) || p.querySelector('h1,h2,h3,h4')) heading = (p.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 120);
      }
      el = el.parentElement;
    }
  }
  const hs = document.querySelectorAll('h1, h2, h3, title, [class*="title"], [class*="heading"], legend');
  const heads = []; for (let k = 0; k < hs.length && heads.length < 12; k++) { const t = (hs[k].innerText || hs[k].textContent || '').replace(/\\s+/g, ' ').trim(); if (t && t.length <= 80) heads.push(t); }
  const btns = []; if (best) { const bs = best.querySelectorAll('button, input[type=submit], input[type=image]'); for (let k = 0; k < bs.length; k++) btns.push((bs[k].innerText || bs[k].value || bs[k].getAttribute('alt') || '').trim()); }
  return { url: location.href, title: document.title || '', heading, heads: heads.join(' / '), btns: btns.join(' / '), formText, inputs: bestN };
})()`;
type FormPurpose = { url: string; title: string; heading: string; heads: string; btns: string; formText: string; inputs: number };

// 求職者向けの入力欄。企業からの問い合わせでは聞かれない項目
const JOBSEEKER_FIELD_RE = /(生年月日|年齢|性別|希望(職種|勤務地|給与|時給|月給|年収|勤務|業種|エリア|の働き方)|最寄(り)?駅|履歴書|職務経歴|職歴|保有資格|資格|学歴|就業(状況|形態|中)|現在の(職業|状況|お仕事)|雇用形態|勤務可能|扶養|国籍|在留|志望(動機)?|経験(職種|年数)|勤務開始)/g;
// 登録・応募を表す言葉（見出し・URL・ボタン）
const REGISTER_RE = /(人材登録|スタッフ登録|派遣登録|登録スタッフ|求職|お仕事(を)?(お)?(探|さが)し|仕事(を)?(お)?(探|さが)し|お仕事情報|登録フォーム|仮登録|本登録|web登録|エントリー|ご応募|応募(フォーム|する|はこちら|受付)|求人(へ|に)?(の)?応募|採用(エントリー|応募|フォーム|へのお問い?合わ?せ)|会員登録|新規登録|アカウント(登録|作成)|登録説明会|キャリア(相談|登録)|転職(相談|支援|サポート)|マイページ|entry|regist|recruit|jobseeker|signup|sign-up|apply)/i;
// 「求職者向け」と断定できる言葉。「お問い合わせ」と並んでいても、こちらを優先する（「求職者の方のお問い合わせ」等）
const JOBSEEKER_RE = /(求職者|お仕事(を)?(お)?(探|さが)し|仕事(を)?(お)?(探|さが)しの方|スタッフ登録|人材登録|派遣登録|働きたい方|転職をお考え|お仕事をご希望)/;
// 企業向け・問い合わせを表す言葉
const INQUIRY_RE = /(お問い?合わ?せ|お問合せ|問合せ|問い合せ|inquiry|contact|toiawase|ご相談|ご質問|ご依頼|お見積|見積)/i;
const CORPORATE_RE = /(企業(の|ご)?(方|様|担当|向け)|法人(の|ご)?(方|様|向け)|採用(ご)?担当|人材(を)?(お)?探し|ご利用(企業|法人)|発注|お取引|求人(を)?(ご)?掲載|求人(の)?ご依頼|スタッフ(を)?(お)?探し)/;

/** 問い合わせ以外のフォーム（求職者向けの登録・応募・会員登録）なら、その理由を返す。問い合わせフォームなら null */
export async function nonInquiryReason(page: Page): Promise<string | null> {
  let info: FormPurpose | null = null;
  for (const fr of page.frames()) {
    const r = await (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([fr.evaluate(NON_INQUIRY_SCRIPT) as Promise<FormPurpose>, new Promise<null>((res) => { timer = setTimeout(() => res(null), 3000); })]);
      } catch { return null; } finally { if (timer) clearTimeout(timer); }
    })();
    if (r && r.inputs > 0 && (!info || r.inputs > info.inputs)) info = r;
  }
  if (!info) return null;
  let path = "";
  try { path = decodeURIComponent(new URL(info.url).pathname); } catch { path = info.url; }
  const around = `${info.heading} ${info.heads} ${info.btns} ${info.title}`;
  const context = `${path} ${around}`;
  // 1) 入力欄が求職者向け（生年月日・希望職種・最寄駅…が3種類以上）
  const seen = new Set<string>();
  for (const m of info.formText.matchAll(JOBSEEKER_FIELD_RE)) seen.add(m[0].replace(/(生年月日|年齢|性別).*/, "$1"));
  if (seen.size >= 3) return `求職者向けの登録フォーム（${[...seen].slice(0, 3).join("・")} などの欄）`;
  // 2) 見出し・URLが「求職者向け」と言っていて、企業向けの言葉が無い
  const js = JOBSEEKER_RE.exec(around) ?? JOBSEEKER_RE.exec(path);
  if (js && !CORPORATE_RE.test(around)) return `求職者向けのページ（「${js[0]}」）`;
  // 3) 登録・応募の言葉があり、問い合わせの言葉が無い
  const rg = REGISTER_RE.exec(around) ?? REGISTER_RE.exec(path);
  if (rg && !INQUIRY_RE.test(context) && !CORPORATE_RE.test(around)) return `登録・応募フォーム（「${rg[0]}」）`;
  return null;
}

/** 問い合わせフォームとして使えるページか（フォームがあり、かつ問い合わせ以外のフォームではない）。
 *  問い合わせ以外だったときは、その理由を note に残す（探索の最後まで見つからなかったときの説明に使う） */
async function usableContactPage(page: Page, note?: { reason?: string }): Promise<boolean> {
  if (!(await pageHasContactForm(page))) return false;
  const why = await nonInquiryReason(page);
  if (!why) return true;
  if (note) note.reason = note.reason ? note.reason : `${why}: ${page.url()}`;
  return false;
}

export async function pageHasContactForm(page: Page): Promise<boolean> {
  if (await scanFrames(page)) return true;
  // 外部フォームサービスを iframe で埋め込んでいるページ（#4）。
  // 中身を読み取れないことがあるが、このURLが入っている時点で入力フォームとみなしてよい
  if (page.frames().some((fr) => FORM_SERVICE_RE.some(([, re]) => re.test(fr.url() || "")))) return true;
  // JSで後から描画されるフォーム: 少し待って再スキャン
  for (let i = 0; i < 2; i++) {
    await page.waitForTimeout(1000);
    if (await scanFrames(page)) return true;
  }
  // スクロールしないと現れないフォーム（画面に入ったときだけ描画される遅延読み込みの埋め込み等。
  // 実例: リンクを開いてスクロールするとフォームが出るサイトが「フォーム無し」判定になっていた）。
  // ページ下端まで段階的にスクロールして、その都度スキャンし直す。
  try {
    const { total, step } = await page.evaluate(() => ({
      total: document.documentElement.scrollHeight,
      step: Math.max(400, Math.floor(window.innerHeight * 0.8)),
    }));
    for (let y = step; y < total + step && y < 30000; y += step) {
      await page.evaluate((yy) => window.scrollTo(0, yy), y);
      await page.waitForTimeout(350);
      if (await scanFrames(page)) return true;
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    // 画面に入ってから読み込む埋め込みフォーム（#5）: 通信が落ち着くのを待って、もう一度だけ見る
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(800);
    if (await scanFrames(page)) return true;
    if (page.frames().some((fr) => FORM_SERVICE_RE.some(([, re]) => re.test(fr.url() || "")))) return true;
  } catch {
    /* 遷移中・閉じたページ等は無視 */
  }
  return false;
}

/** 「お問い合わせはこちら」等をクリックしてモーダル/パネルで開くフォームを探す（最後の手段）。
    ページを遷移させる可能性があるので、リンク探索が全て終わった後にだけ呼ぶ。 */
async function tryClickTrigger(page: Page): Promise<boolean> {
  try {
    const clicked = await page.evaluate(CLICK_TRIGGER_SCRIPT).catch(() => false);
    if (!clicked) return false;
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1200);
    return scanFrames(page);
  } catch {
    return false;
  }
}

import { CHALLENGE_RE } from "./detect.js";

// 「ブラウザ確認」が自動で解けなかったオリジン。同じサイトの候補URL（よくあるパス十数個）で
// 毎回10秒待たないための記憶。プロセス内だけで保持する
const challengeGaveUp = new Set<string>();

/** 4xx/5xx で着地したページが「ブラウザ確認（Checking your browser / Just a moment 等）」なら、
 *  自動で解けるのを最大10秒待つ。実例: grooves.com は 403 のチャレンジ→約2秒で本来のページへ自動遷移する。
 *  以前はステータス≥400を見た瞬間に諦めていたため、こうしたサイトが全て「フォーム無し」になっていた。
 *  解けたら true。本物の 4xx/5xx（チャレンジ文言なし）や、待っても解けない場合は false。 */
async function waitOutChallenge(page: Page, url: string): Promise<boolean> {
  let origin = "";
  try { origin = new URL(url).origin; } catch { /* 相対URL等 */ }
  if (origin && challengeGaveUp.has(origin)) return false;
  const onChallenge = async () => {
    try {
      const t = String(await page.evaluate(() => document.title + " " + (document.body?.innerText || "").slice(0, 1500)));
      return CHALLENGE_RE.test(t);
    } catch { return false; }
  };
  if (!(await onChallenge())) return false;
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(1000);
    if (!(await onChallenge())) return true; // 本来のページに切り替わった
  }
  if (origin) challengeGaveUp.add(origin);
  return false;
}

async function safeGoto(page: Page, url: string): Promise<boolean> {
  try {
    const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
    if (res && res.status() >= 400 && !(await waitOutChallenge(page, url))) return false;
    // フォームがもう見えているなら、通信が落ち着くのを待たずに進む（#123）。
    // 以前は必ず最大6秒待っていて、事前チェックで見つけたURLを直接開く場合でも時間がかかっていた
    if (await scanFrames(page)) { await page.waitForTimeout(400); return true; }
    // JSで描画されるフォーム（SPA・埋め込み）を待つ
    await page.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(500);
    return true;
  } catch {
    return false;
  }
}

function normalize(url: string): string {
  if (!url) return "";
  return url.startsWith("http") ? url : `https://${url}`;
}

/** 開けなかったURLの言い換え（#2）。https↔http・www有無を試す。
 *  「サイトにアクセスできない」で送れなかった会社が多く（実測163件）、1回の失敗で諦めていた */
export function urlVariants(url: string): string[] {
  const out: string[] = [];
  try {
    const u = new URL(normalize(url));
    const hosts = u.hostname.startsWith("www.") ? [u.hostname, u.hostname.slice(4)] : [u.hostname, `www.${u.hostname}`];
    for (const proto of [u.protocol, u.protocol === "https:" ? "http:" : "https:"]) {
      for (const h of hosts) {
        const v = new URL(u.toString());
        v.protocol = proto; v.hostname = h;
        const s = v.toString();
        if (!out.includes(s)) out.push(s);
      }
    }
  } catch {
    return [normalize(url)].filter(Boolean);
  }
  return out;
}

/** sitemap.xml から問い合わせページらしいURLを拾う（#1）。
 *  トップページにリンクが無い・JSメニューでリンクを読めないサイトでも、サイトマップには載っていることが多い */
async function urlsFromSitemap(page: Page, origin: string): Promise<string[]> {
  const read = async (u: string): Promise<string> => {
    try {
      const res = await page.request.get(u, { timeout: 10000, failOnStatusCode: false });
      if (!res.ok()) return "";
      const body = await res.text();
      return body.length > 3_000_000 ? body.slice(0, 3_000_000) : body;
    } catch { return ""; }
  };
  const locsOf = (xml: string) => Array.from(xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)).map((m) => m[1]);
  const candidates: string[] = [];
  // robots.txt に書かれたサイトマップも見る
  const robots = await read(`${origin}/robots.txt`);
  const fromRobots = Array.from(robots.matchAll(/^\s*sitemap:\s*(\S+)/gim)).map((m) => m[1]);
  const sitemaps = [...new Set([...fromRobots, `${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`, `${origin}/sitemap-index.xml`])].slice(0, 4);
  for (const sm of sitemaps) {
    const xml = await read(sm);
    if (!xml) continue;
    const locs = locsOf(xml);
    // サイトマップ索引なら、問い合わせが載っていそうな子サイトマップを1つだけ辿る
    if (/<sitemapindex/i.test(xml)) {
      const child = locs.find((l) => /(page|post|main|top|1)/i.test(l)) ?? locs[0];
      if (child) candidates.push(...locsOf(await read(child)));
    } else candidates.push(...locs);
    if (candidates.length > 3000) break;
  }
  return candidates
    .filter((u) => u.startsWith(origin) && CONTACT_LINK_RE.test(u) && !NEGATIVE_LINK_RE.test(u))
    .slice(0, 5);
}

/** フォームのあるページへ遷移する。見つかれば最終URL、無ければ null */
export async function findContactForm(page: Page, formUrl: string, siteUrl: string, note: { reason?: string } = {}): Promise<string | null> {
  const tried = new Set<string>();
  // 開いた結果のURL（リダイレクト後）で、もう調べたページ。どのパスでもトップへ転送するサイトだと、
  // よくあるパス約40本で毎回同じトップページをスクロールして調べ直し、1社に何分もかかっていた
  const examined = new Set<string>();
  const keyOf = (u: string) => u.split("#")[0].replace(/\/(index\.(html?|php))?$/i, "");
  const tryUrl = async (u: string) => {
    if (!u || tried.has(u)) return false;
    tried.add(u);
    if (!(await safeGoto(page, u))) return false;
    const k = keyOf(page.url());
    if (examined.has(k)) return false;
    examined.add(k);
    return usableContactPage(page, note);
  };

  if (formUrl && (await tryUrl(normalize(formUrl)))) return page.url();
  // フォームURLが開けなかった場合、https/http・www有無を言い換えて試す（#2）
  if (formUrl) {
    for (const v of urlVariants(formUrl).slice(1, 4)) if (await tryUrl(v)) return page.url();
  }

  const site = normalize(siteUrl || formUrl);
  if (!site) return null;
  let origin: string;
  try {
    origin = new URL(site).origin;
  } catch {
    return null;
  }

  // トップページを開く。開けなければ https/http・www有無を言い換えて試す（#2）
  let opened = await safeGoto(page, site);
  if (!opened) {
    for (const v of urlVariants(site).slice(1, 4)) {
      if (await safeGoto(page, v)) { opened = true; origin = new URL(v).origin; break; }
    }
  }
  // トップページ内のリンクから探す（フッターのリンクを優先: #1）
  if (opened) {
    examined.add(keyOf(page.url()));
    if (await usableContactPage(page, note)) return page.url();
    const links: { href: string; text: string; footer: boolean }[] = await page.evaluate(() =>
      Array.from(document.querySelectorAll("a[href]")).map((a) => {
        const el = a as HTMLAnchorElement;
        return {
          href: el.href,
          text: (el.innerText || a.getAttribute("title") || a.getAttribute("aria-label") || "").trim(),
          // フッター（またはページ下部）のリンクは、問い合わせページである確率が高い
          footer: Boolean(el.closest("footer, [class*='footer'], [id*='footer']")),
        };
      })
    );
    const candidates = links
      .filter((l) => l.href.startsWith("http") && !NEGATIVE_LINK_RE.test(l.href + " " + l.text))
      .filter((l) => CONTACT_LINK_RE.test(l.text) || CONTACT_LINK_RE.test(l.href))
      .sort((a, b) => score(b) - score(a))
      .slice(0, 5);
    for (const c of candidates) {
      if (await tryUrl(c.href.split("#")[0])) return page.url();
    }
  }

  // よくあるパス。存在しないパスにも 200 で同じ「見つかりません」ページを返すサイトで時間がかかりすぎないよう、全体で90秒まで
  const pathsUntil = Date.now() + 90_000;
  for (const p of COMMON_PATHS) {
    if (Date.now() > pathsUntil) break;
    if (await tryUrl(origin + p)) return page.url();
  }

  // sitemap.xml / robots.txt のサイトマップから探す（#1）。
  // JSで作られたメニューなどでトップのリンクを読めないサイトでも、ここに載っていることが多い
  for (const u of await urlsFromSitemap(page, origin)) {
    if (await tryUrl(u)) return page.url();
  }

  // 「会社概要」ページ経由（問い合わせリンクが会社概要の中にだけあるサイト向け: #1）
  if (await safeGoto(page, origin + "/company/") || (await safeGoto(page, site))) {
    const sub: string[] = await page.evaluate(() =>
      Array.from(document.querySelectorAll("a[href]"))
        .map((a) => (a as HTMLAnchorElement).href)
        .filter((h) => /(company|about|corporate|profile|outline|会社)/i.test(h))
        .slice(0, 6)
    ).catch(() => []);
    for (const u of sub.slice(0, 2)) {
      if (!(await safeGoto(page, u))) continue;
      if (await usableContactPage(page, note)) return page.url();
      const link: string | null = await page.evaluate((reSrc) => {
        const re = new RegExp(reSrc, "i");
        const a = Array.from(document.querySelectorAll("a[href]")).find((x) => re.test(((x as HTMLAnchorElement).innerText || "") + " " + (x as HTMLAnchorElement).href));
        return a ? (a as HTMLAnchorElement).href : null;
      }, CONTACT_LINK_RE.source).catch(() => null);
      if (link && (await tryUrl(link.split("#")[0]))) return page.url();
    }
  }

  // 最後の手段: トップに戻り「お問い合わせはこちら」等を押してモーダル/パネルを開く
  if (await safeGoto(page, site)) {
    // 押した先が登録・応募フォーム（「お問い合わせ・ご登録」のようなリンク）だったら使わない
    if ((await tryClickTrigger(page)) && !(await nonInquiryReason(page).then((why) => { if (why && !note.reason) note.reason = `${why}: ${page.url()}`; return why; }))) return page.url();
  }
  return null;

  function score(l: { href: string; text: string; footer: boolean }) {
    let s = 0;
    if (/お問い?合わ?せ|お問合せ|contact/i.test(l.text)) s += 3;
    if (/contact|inquiry|toiawase/i.test(l.href)) s += 2;
    if (l.href.startsWith(origin)) s += 2;
    if (l.footer) s += 2;
    if (/form/i.test(l.href)) s += 1;
    if (/資料請求|見積/i.test(l.text)) s -= 1; // 問い合わせフォームの方が本命
    return s;
  }
}
