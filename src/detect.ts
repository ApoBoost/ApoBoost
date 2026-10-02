// 営業お断り文言・CAPTCHA の検知。ここに引っかかったら突破せずスキップする。
export const REFUSAL_PATTERNS: RegExp[] = [
  /営業(目的|活動|のご案内|のお問い?合わ?せ|に関するお問い?合わ?せ|・?勧誘|等)?(は|の)?(固く|一切|、)?(お断り|ご遠慮|お控え)/,
  /セールス(目的|のお問い?合わ?せ|・?勧誘)?(は|の)?(固く|一切)?(お断り|ご遠慮|お控え)/,
  /勧誘(目的|等)?(のお問い?合わ?せ)?(は|の)?(固く|一切)?(お断り|ご遠慮|お控え)/,
  /売り?込み(のご連絡|等)?(は|の)?(固く|一切)?(お断り|ご遠慮)/,
  /(営業|セールス|勧誘|売り込み)[^。\n]{0,20}(お断り|ご遠慮|お控え)/,
  /(お断り|ご遠慮)[^。\n]{0,12}(営業|セールス|勧誘|売り込み)/,
  /自動(送信|入力)(ツール|プログラム)?[^。\n]{0,15}(禁止|お断り|ご遠慮)/,
  /(no|not)\s+(sales|solicitation|marketing)/i,
  // ここから #88 で追加。実際のサイトで見かける言い回しを増やした
  /(営業|セールス|勧誘|売り込み|広告|宣伝)[^。\n]{0,20}(目的|内容)[^。\n]{0,10}(ご利用|送信|投稿)[^。\n]{0,10}(禁止|できません|ご遠慮)/,
  /(商品|サービス|システム)[^。\n]{0,12}(売り込み|セールス|ご提案|営業)[^。\n]{0,12}(お断り|ご遠慮|受け付けて(おり)?ません)/,
  /(営業|セールス|勧誘|売り込み|ご提案)[^。\n]{0,20}(受け付けて(おり)?ません|対応(いた)?しかねます|返信(いた)?しません|一切応じ)/,
  /(当社|弊社|当院|当店)[^。\n]{0,10}(への)?(営業|セールス|勧誘)[^。\n]{0,16}(禁止|お断り|ご遠慮)/,
  /取引(先)?(の)?(勧誘|営業)[^。\n]{0,12}(お断り|ご遠慮)/,
  /(業者|企業)(様|さま)?(から)?の(営業|セールス|勧誘|売り込み|ご案内)[^。\n]{0,16}(お断り|ご遠慮|不要|受け付け)/,
  /(ご案内|DM|ダイレクトメール)[^。\n]{0,12}(は|の)[^。\n]{0,8}(お断り|ご遠慮|不要)/,
  /(solicitation|unsolicited)[^.\n]{0,30}(prohibited|declined|not accepted)/i,
];

export function detectRefusal(text: string): string | null {
  const t = text.replace(/\s+/g, "");
  for (const re of REFUSAL_PATTERNS) {
    const m = t.match(re);
    if (m) return m[0].slice(0, 60);
  }
  return null;
}

/** Cloudflare 等の「ブラウザ確認」ページ（自動アクセスの遮断）。CAPTCHA 扱いでスキップ */
export const CHALLENGE_RE = /(Checking your browser|Verify you are human|Just a moment|ブラウザを確認しています|あなたが人間であることを確認|Attention Required|Access denied|アクセスが拒否)/i;

export const CAPTCHA_SELECTORS = [
  "iframe[src*='recaptcha/api2/anchor']", // reCAPTCHA v2 checkbox（人が押す必要がある）
  "iframe[src*='recaptcha/api2/bframe']", // reCAPTCHA の画像認証ポップアップ（送信を押したあとに出る。普段は画面外に隠れている）
  "iframe[src*='recaptcha/enterprise/bframe']",
  ".g-recaptcha[data-size='normal']",
  ".g-recaptcha:not([data-size='invisible'])",
  "iframe[src*='hcaptcha.com']",
  ".h-captcha",
  "iframe[src*='challenges.cloudflare.com']",
  ".cf-turnstile",
  "img[src*='captcha']",
  "input[name*='captcha' i]",
  "input[name*='securimage' i]",
];

/** 目に見える（=人の操作を要求する）CAPTCHAがあるか。reCAPTCHA v3 / invisible は送信者に負担が無いので許容 */
export const CAPTCHA_CHECK_SCRIPT = `
(() => {
  const sels = ${JSON.stringify(CAPTCHA_SELECTORS)};
  for (const s of sels) {
    for (const el of document.querySelectorAll(s)) {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      // 画面外（top:-10000px 等）に隠してある要素は表示されていない扱い
      if (r.width > 20 && r.height > 20 && r.bottom > 0 && r.right > 0 && style.visibility !== 'hidden' && style.display !== 'none') return s;
    }
  }
  return null;
})()`;
