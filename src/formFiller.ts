// フォームの項目を見つけて入力し、確認画面を経て送信し、結果を判定する。
import type { Page, Frame } from "playwright";
import type { SenderProfile } from "./db.js";

export type FieldInfo = {
  idx: number;
  tag: "input" | "textarea" | "select";
  type: string;
  name: string;
  id: string;
  sig: string; // ラベル・placeholder・name・id・周辺テキストを連結した判定用文字列
  required: boolean;
  options: { value: string; text: string; disabled?: boolean }[];
  checked: boolean;
  formIndex: number;
  maxlength: number;
  placeholder: string;
  inputmode: string;
  pattern: string;
  glabel: string; // ラジオ・チェックボックス用: 設問の見出し（fieldsetのlegend等）。それ以外は空
};

export type Category =
  | "message" | "company" | "department" | "name" | "name_last" | "name_first"
  | "kana" | "kana_last" | "kana_first" | "email" | "email_confirm" | "tel"
  | "postal" | "address" | "prefecture" | "url" | "subject" | "agree" | "type" | "position" | "ignore";

// 順番に意味がある（先に当たったものが勝つ）
const RULES: [Category, RegExp][] = [
  ["ignore", /(fax|ファックス|ファクス|password|パスワード|search|検索|captcha|認証コード|画像の文字|クーポン|coupon)/i],
  ["email_confirm", /((メール|mail).{0,12}(確認|再入力|confirm)|(確認|confirm|re-?enter).{0,12}(メール|mail))/i],
  ["email", /(メール|e-?mail|mail)/i],
  ["kana_last", /((フリガナ|ふりがな|カナ|kana|セイ)(.{0,6})?(姓|せい|セイ|苗字|last|sei\b)|(姓|せい|苗字).{0,6}(フリガナ|ふりがな|カナ|kana)|kana_sei|sei_kana|kana_last|last_kana|lastkana)/i],
  ["kana_first", /((フリガナ|ふりがな|カナ|kana|メイ)(.{0,6})?(名|めい|メイ|first|mei\b)|(名|めい).{0,6}(フリガナ|ふりがな|カナ|kana)|kana_mei|mei_kana|kana_first|first_kana|firstkana)/i],
  ["kana", /(フリガナ|ふりがな|カナ|kana|furigana|よみ|ヨミ|ruby|phonetic)/i],
  ["name_last", /(姓|苗字|名字|lastname|last_name|last-name|family|\bsei\b|surname)/i],
  // 部署名は「〜名」で下の名前に当たってしまうので、名前の判定より先に見る（「部署名」に下の名前が入る事故の対策）
  ["department", /(部署|部門|department|division)/i],
  // 「住所1（都道府県）」は都道府県の選択欄なので、住所より先に判定する
  ["prefecture", /(都道府県|prefecture|pref\b)/i],
  // 住所の欄（住所3（町名番地）等）は名前より先に判定する。「町名」の「名」を下の名前と誤判定し、住所欄に名前が入る事故があった
  ["address", /(住所\s*[0-9０-９]|町名|番地|丁目|建物名|市区町村|street\s*address|address\s*line)/i],
  ["name_first", /(^|[^氏会社品件題法人職媒校体署門舗設院織課局室属町])名(?![前称刺簿])|firstname|first_name|first-name|given|\bmei\b/i], // 校体: 「学校名」「団体名」、署門舗…: 「部署名」「店舗名」「施設名」、町: 「町名」を下の名前と誤判定した事故の対策
  ["company", /(会社|企業|法人|社名|貴社|御社|団体|組織|屋号|店舗名|店名|company|corp|organization|organisation|firm)/i],
  ["position", /(役職|職位|position|title.*役)/i],
  ["name", /(氏名|お名前|名前|担当者|ご担当|your-name|\bname\b|fullname|full_name|full-name)/i],
  ["tel", /(電話|tel|phone|携帯|mobile|連絡先番号)/i],
  ["postal", /(郵便|〒|zip|postal|postcode)/i],
  ["prefecture", /(都道府県|prefecture|pref\b)/i],
  ["address", /(住所|所在地|address|addr|市区町村|番地|建物)/i],
  ["url", /(url|ホームページ|hp|サイト|website|web\s*site|ウェブ)/i],
  ["subject", /(件名|題名|タイトル|subject|your-subject|\btitle\b)/i],
  ["agree", /(同意|承諾|了承|agree|accept|consent|privacy|プライバシー|個人情報|規約|policy|確認しました)/i],
  ["type", /(種別|種類|区分|カテゴリ|category|type|項目|目的|about|ご用件|用件|内容を選択|お問い?合わ?せ内容$)/i],
  ["message", /(内容|本文|メッセージ|message|comment|コメント|備考|詳細|ご要望|ご相談|ご質問|お問い?合わ?せ|問合せ|inquiry|body|detail|remarks|note)/i],
];

export function classify(f: FieldInfo): Category {
  if (f.tag === "textarea") {
    // textarea は原則メッセージ。住所欄などの例外だけ弾く
    if (/(住所|address)/i.test(f.sig) && !/(内容|message|本文)/i.test(f.sig)) return "address";
    return "message";
  }
  if (f.type === "email") return /(確認|confirm|re-?enter)/i.test(f.sig) ? "email_confirm" : "email";
  // type=tel は「数字のキーボードを出すため」に郵便番号やFAXにも使われる（pica-corp.jp / klgc.co.jp の実例: 郵便番号欄に電話番号が入っていた）
  if (f.type === "tel") {
    const own0 = f.sig.split(" || ")[0];
    if (/(fax|ファックス|ファクス)/i.test(own0)) return "ignore";
    if (/(郵便|〒|zip|postal|postcode)/i.test(own0) && !/(電話|tel\b|phone)/i.test(own0)) return "postal";
    return "tel";
  }
  if (f.type === "url") return "url";
  if (["file", "hidden", "submit", "button", "reset", "image", "password", "search", "color", "range"].includes(f.type)) return "ignore";
  const [own, ctx = ""] = f.sig.split(" || ");
  if (f.type === "radio" || f.type === "checkbox") {
    // 選択肢のラベル（「メール」「電話」など）は項目名ではないので、同意だけ自分のラベルで判定し、あとは設問側の見出しで判定
    if (RULES.find(([c]) => c === "agree")![1].test(own)) return "agree";
    for (const [cat, re] of RULES) if (cat !== "ignore" && cat !== "message" && re.test(ctx)) return cat === "email" || cat === "tel" || cat === "name" ? "type" : cat;
    return "type";
  }
  // まず要素自身の手がかり（name/id/placeholder/ラベル/直前テキスト）だけで判定し、決まらなければ周辺テキストも含めて判定
  const fix = (cat: Category): Category => (cat === "type" && f.tag === "input" && /(内容|本文|message|ご相談|ご質問|ご要望)/i.test(f.sig) ? "message" : cat);
  for (const [cat, re] of RULES) if (re.test(own)) return fix(cat);
  for (const [cat, re] of RULES) if (re.test(f.sig)) return fix(cat);
  if (f.tag === "select") return "type";
  return "ignore";
}

// ページ内の入力項目を収集し、各要素に data-fo-idx を振る
const COLLECT_SCRIPT = `
(() => {
  const isVisible = (el) => {
    const st = getComputedStyle(el);
    if (el.type === 'radio' || el.type === 'checkbox') {
      // カスタムデザインで本体が隠れている（opacity:0 / 画面外）ことが多いので、ラベルの可視性で判断
      const lab = el.closest('label') || (el.id ? document.querySelector('label[for="' + CSS.escape(el.id) + '"]') : null);
      if (lab) { const lr = lab.getBoundingClientRect(); const ls = getComputedStyle(lab); return lr.width > 0 && lr.height > 0 && ls.display !== 'none' && ls.visibility !== 'hidden'; }
      // labelに包まれていないMUI/Jicoo型（input自体はopacity:0で、見えているのは親のコントロール）: 親2階層までの可視性で判断
      if (st.display === 'none' || el.getAttribute('aria-hidden') === 'true') return false; // display:none は隠し欄とみなす
      let anc = el.parentElement;
      for (let i = 0; i < 2 && anc; i++, anc = anc.parentElement) {
        const ar = anc.getBoundingClientRect(); const as = getComputedStyle(anc);
        if (ar.width > 0 && ar.height > 0 && as.display !== 'none' && as.visibility !== 'hidden' && as.opacity !== '0') return true;
      }
      return false;
    }
    if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    const r = el.getBoundingClientRect();
    // 画面外に飛ばしてあるハニーポット（left:-9999px 等）は触らない。
    // 注意: フォーム入力後にページがスクロールすると、正規の欄でも rect.top/bottom が負になる（画面の上に隠れるだけ）。
    // これを honeypot と誤判定しないよう、ドキュメント座標（scrollを足す）で -1000px より外に飛ばされているものだけ除外する。
    const docLeft = r.left + window.scrollX;
    const docTop = r.top + window.scrollY;
    if (docLeft < -1000 || docTop < -1000 || docLeft > document.documentElement.scrollWidth + 1000) return false;
    // 親が画面外・高さゼロで隠しているケース
    let p = el.parentElement; let hops = 0;
    while (p && hops < 4) { const pr = p.getBoundingClientRect(); const ps = getComputedStyle(p); if (ps.display === 'none' || ps.visibility === 'hidden' || (pr.width === 0 && pr.height === 0 && ps.overflow === 'hidden') || (pr.left + window.scrollX) < -1000) return false; p = p.parentElement; hops++; }
    if (el.type === 'radio' || el.type === 'checkbox') return r.width > 0 || r.height > 0;
    return r.width > 0 && r.height > 0;
  };
  // 要素自身に近い手がかり（ラベル・直前のテキスト）。周辺テキストより優先して判定に使う
  const ownText = (el) => {
    const parts = [];
    if (el.id) document.querySelectorAll('label[for="' + CSS.escape(el.id) + '"]').forEach(l => parts.push(l.innerText));
    const wrap = el.closest('label'); if (wrap) parts.push(wrap.innerText);
    if (el.getAttribute('aria-label')) parts.push(el.getAttribute('aria-label'));
    if (el.getAttribute('aria-labelledby')) { const l = document.getElementById(el.getAttribute('aria-labelledby')); if (l) parts.push(l.innerText); }
    let prev = el.previousSibling; let hops = 0;
    while (prev && hops < 3) { const t = (prev.textContent || '').trim(); if (t) { if (t.length <= 12) parts.push(t); break; } prev = prev.previousSibling; hops++; }
    // labelに包まれていないカスタム選択肢（Jicoo等）: 選択肢の文字が親コンテナ側にあるので、短いテキストなら拾う
    if (!parts.length && (el.type === 'radio' || el.type === 'checkbox')) {
      let anc = el.parentElement;
      for (let i = 0; i < 2 && anc; i++, anc = anc.parentElement) {
        const t = (anc.innerText || '').trim();
        if (t) { if (t.length <= 24) parts.push(t); break; }
      }
    }
    return parts.join(' ');
  };
  // 周辺の見出し。確度の高い順に見て、最初に見つかったものだけ使う（複数を混ぜると別の欄の言葉を拾う）
  const labelText = (el) => {
    // テーブル型フォーム: 同じ行の th / 先頭 td
    const tr = el.closest('tr'); if (tr) { const th = tr.querySelector('th, td'); if (th && !th.contains(el)) { const t = (th.innerText || '').trim(); if (t) return t; } }
    // dl 型: 直前の dt
    const dd = el.closest('dd'); if (dd) { let p = dd.previousElementSibling; while (p && p.tagName !== 'DT') p = p.previousElementSibling; if (p) { const t = (p.innerText || '').trim(); if (t) return t; } }
    // 直前の兄弟ブロック（<p>会社名</p><input> や <div class=label>）
    let sib = el.previousElementSibling; let hops = 0;
    while (sib && hops < 2) { const t = (sib.innerText || '').trim(); if (t && t.length <= 40 && !sib.querySelector('input,textarea,select')) return t; sib = sib.previousElementSibling; hops++; }
    // 汎用: 親ブロック内のテキスト（短いもの）。
    // 内側の箱が注意書きだけ（「※個人の方は…」等）でラベル本体がその外側にあるサイト（Jicoo等）があるため、
    // 条件を満たす箱のうち一番外側のものを採用する（inputsが2個以下という制約で隣の欄の文言は混ざらない）
    let box = el.parentElement; hops = 0; let best = '';
    while (box && hops < 5) {
      const t = (box.innerText || '').trim();
      if (t && t.length < 80 && box.querySelectorAll('input,textarea,select').length <= 2) best = t;
      box = box.parentElement; hops++;
    }
    return best;
  };
  // 必須の印を読み取る。文字の「必須」「*」だけでなく、画像の「必須」（alt）、必須を表す class、「電話番号※」のような ※・＊ も拾う。
  // これを読み落とすと、「電話番号は必須の欄にだけ入れる」設定のときに空のまま送ろうとして弾かれる
  // （本番の失敗470件のうち236件がこれだった。a-qua-west.co.jp / bellstaff.co.jp / jhn.co.jp など）
  const markIn = (node, strict) => {
    if (!node) return false;
    const t = (node.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 60);
    if (/任意|optional/i.test(t)) return false;
    if (/必須|required|[*＊]/i.test(t)) return true;
    // ※ は注意書き（※半角数字）にも使われるので、見出しの末尾か、見出しセルの先頭に付いているときだけ必須とみなす
    if (/※$/.test(t) || (strict && /^※\\s*[^\\s※]{1,14}$/.test(t))) return true;
    if (node.querySelector('img[alt*="必須"], img[src*="hissu"], img[src*="required"], img[src*="must"]')) return true;
    const marks = node.querySelectorAll('[class*="required"], [class*="Required"], [class*="hissu"], [class*="must"], [class*="need"]');
    for (let k = 0; k < marks.length; k++) { if (!/^(INPUT|TEXTAREA|SELECT|FORM)$/.test(marks[k].tagName)) return true; }
    return false;
  };
  const reqMark = (el) => {
    // テーブル型: 同じ行の、入力欄を含まないセル（見出しセル・「必須」だけのセル）
    const tr = el.closest('tr');
    if (tr) { const cells = tr.children; for (let k = 0; k < cells.length; k++) { if (!cells[k].contains(el) && !cells[k].querySelector('input,textarea,select') && markIn(cells[k], true)) return true; } }
    // dl 型: 直前の dt
    const dd = el.closest('dd'); if (dd) { let p = dd.previousElementSibling; while (p && p.tagName !== 'DT') p = p.previousElementSibling; if (markIn(p, true)) return true; }
    // label[for] と、包んでいる label
    if (el.id) { try { if (markIn(document.querySelector('label[for="' + CSS.escape(el.id) + '"]'), true)) return true; } catch (e) {} }
    if (markIn(el.closest('label'), true)) return true;
    // 入力欄が2つ以下の、いちばん近い箱（1項目ぶんの枠）
    let box = el.parentElement; let hops = 0;
    while (box && hops < 4) {
      if (box.querySelectorAll('input:not([type=hidden]),textarea,select').length > 2) break;
      if ((box.innerText || '').trim().length > 0 && markIn(box, false)) return true;
      box = box.parentElement; hops++;
    }
    return false;
  };
  // 前回の採番を消す（段階式フォームで古い要素と番号が重なるのを防ぐ）
  document.querySelectorAll('[data-fo-idx]').forEach((e) => e.removeAttribute('data-fo-idx'));
  // Array.from は使わない: 古い prototype.js を読み込むサイトは Array.from を書き換えていて、要素でないものが返り
  // 「el.getBoundingClientRect is not a function」で落ちていた（sow-net.com / asensa.co.jp の実例）
  const toArr = (list) => { const a = []; for (let k = 0; k < list.length; k++) a.push(list[k]); return a; };
  const forms = toArr(document.querySelectorAll('form'));
  const els = toArr(document.querySelectorAll('input, textarea, select'));
  const out = [];
  let i = 0;
  for (const el of els) {
    const type = (el.getAttribute('type') || (el.tagName === 'TEXTAREA' ? 'textarea' : el.tagName === 'SELECT' ? 'select' : 'text')).toLowerCase();
    if (type === 'hidden' || type === 'submit' || type === 'button' || type === 'reset' || type === 'image') continue;
    if (!isVisible(el)) continue;
    const nm = ((el.getAttribute('name') || '') + ' ' + (el.id || '') + ' ' + (el.className || '')).toLowerCase();
    if (/honeypot|honey_pot|hp_field|_hp\b|bot-?field|botcheck|nospam|do-?not-?fill|leave-?blank|website2|url2/.test(nm)) continue;
    el.setAttribute('data-fo-idx', String(i));
    const own = [ownText(el), el.getAttribute('placeholder'), el.getAttribute('name'), el.id, el.getAttribute('autocomplete'), el.getAttribute('title')].filter(Boolean).join(' | ').replace(/\\s+/g, ' ').slice(0, 200);
    const sig = own + ' || ' + labelText(el).replace(/\\s+/g, ' ').slice(0, 200);
    const required = el.required || el.getAttribute('aria-required') === 'true' || /必須|required|\\*/.test(labelText(el).slice(0, 60)) || /required|必須/i.test(String(el.className || '')) || reqMark(el);
    const options = el.tagName === 'SELECT' ? toArr(el.options).map(o => ({ value: o.value, text: (o.textContent || '').trim(), disabled: !!o.disabled })) : [];
    // ラジオ・チェックボックスの「設問見出し」: fieldsetのlegend → グループ全体を包む箱の直前にある見出し → labelの外側、の順で探す
    let glabel = '';
    if (type === 'radio' || type === 'checkbox') {
      const fs2 = el.closest('fieldset');
      const legend = fs2 ? fs2.querySelector('legend') : null;
      if (legend && legend.innerText.trim()) glabel = legend.innerText.trim();
      else {
        // fieldsetが無いレイアウト（Jicoo等）: 選択肢群をまとめて包む箱まで上がり、その手前の見出しを拾う
        let gc = el.parentElement; let h2 = 0;
        while (gc && gc.querySelectorAll("input[type='radio'],input[type='checkbox']").length < 2 && h2 < 6) { gc = gc.parentElement; h2++; }
        for (let up = 0; gc && up < 2 && !glabel; up++, gc = gc.parentElement) {
          let ps = gc.previousElementSibling; let k = 0; let note = '';
          while (ps && k < 3) {
            const t = (ps.innerText || '').trim();
            if (t && t.length < 80 && !ps.querySelector('input,textarea,select')) {
              // 「※複数選択可…」のような注意書きは見出しではないので、さらに手前を見る
              if (/^[※（(]/.test(t)) { note = note || t; } else { glabel = t; break; }
            }
            ps = ps.previousElementSibling; k++;
          }
          if (!glabel && note) glabel = note;
        }
        if (!glabel) { const wrap2 = el.closest('label'); glabel = labelText(wrap2 || el); }
      }
      glabel = (glabel || '').replace(/\\s+/g, ' ').slice(0, 80);
    }
    out.push({ idx: i, tag: el.tagName.toLowerCase(), type, name: el.getAttribute('name') || '', id: el.id || '', sig, required, options, checked: !!el.checked, formIndex: forms.indexOf(el.closest('form')), maxlength: Number(el.getAttribute('maxlength') || 0), placeholder: el.getAttribute('placeholder') || '', inputmode: el.getAttribute('inputmode') || '', pattern: el.getAttribute('pattern') || '', glabel });
    i++;
  }
  return out;
})()`;

/** 見えていない textarea（段階式フォームの2ページ目など）があるか */
export async function hasHiddenTextarea(target: Page | Frame): Promise<boolean> {
  return target.evaluate(() => Array.from(document.querySelectorAll("form textarea")).some((t) => { const r = t.getBoundingClientRect(); return r.width === 0 || r.height === 0; })).catch(() => false);
}

export async function collectFields(target: Page | Frame): Promise<FieldInfo[]> {
  return (await target.evaluate(COLLECT_SCRIPT)) as FieldInfo[];
}

export type FillValues = {
  sender: SenderProfile;
  subject: string;
  message: string;
};

function splitName(full: string): [string, string] {
  const parts = full.trim().split(/[\s　]+/);
  if (parts.length >= 2) return [parts[0], parts.slice(1).join(" ")];
  const n = full.trim();
  if (n.length >= 3) return [n.slice(0, Math.min(2, n.length - 1)), n.slice(Math.min(2, n.length - 1))];
  // 分けられない短い名前で [n, n] を返すと「田中 田中」になる。名は空にして未入力扱いにする
  return [n, ""];
}
function splitTel(tel: string): string[] {
  const digits = tel.replace(/[^\d]/g, "");
  if (tel.includes("-")) return tel.split("-");
  if (digits.length === 11) return [digits.slice(0, 3), digits.slice(3, 7), digits.slice(7)];
  if (digits.length === 10) return digits.startsWith("03") || digits.startsWith("06") ? [digits.slice(0, 2), digits.slice(2, 6), digits.slice(6)] : [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6)];
  return [digits];
}
function splitPostal(p: string): string[] {
  const d = p.replace(/[^\d]/g, "");
  return d.length === 7 ? [d.slice(0, 3), d.slice(3)] : [d];
}
const PREFS = ["北海道","青森県","岩手県","宮城県","秋田県","山形県","福島県","茨城県","栃木県","群馬県","埼玉県","千葉県","東京都","神奈川県","新潟県","富山県","石川県","福井県","山梨県","長野県","岐阜県","静岡県","愛知県","三重県","滋賀県","京都府","大阪府","兵庫県","奈良県","和歌山県","鳥取県","島根県","岡山県","広島県","山口県","徳島県","香川県","愛媛県","高知県","福岡県","佐賀県","長崎県","熊本県","大分県","宮崎県","鹿児島県","沖縄県"];
function prefectureOf(address: string): string {
  return PREFS.find((p) => address.startsWith(p) || address.startsWith(p.replace(/[都府県]$/, ""))) ?? "";
}
/** 都道府県の選択肢から、送信者の都道府県に当たるものを探す。「東京」「大阪」のように都府県を付けない表記にも合わせる。
 *  合わなければ undefined（先頭の「北海道」などを代わりに選ぶと、事実と違う所在地を送ることになる） */
function matchPrefOption(options: FieldInfo["options"], pref: string): FieldInfo["options"][number] | undefined {
  if (!pref) return undefined;
  const short = pref === "北海道" ? pref : pref.replace(/[都府県]$/, "");
  return options.find((o) => !o.disabled && o.value !== "" && [o.text.trim(), o.value.trim()].some((t) => t === pref || t === short));
}
/** select の「選択して下さい」（value が空）や選べない選択肢を除く */
const realOptions = (options: FieldInfo["options"]) => options.filter((o) => o.value !== "" && !o.disabled);

/** 住所を「都道府県／市区町村／町名番地／建物名」に分ける。分かれた入力欄があるフォーム用。
 *  例: 東京都港区新橋4-5-1 アーバン新橋ビル3階 → 東京都 / 港区 / 新橋4-5-1 / アーバン新橋ビル3階 */
export function splitAddress(address: string): { pref: string; city: string; town: string; building: string } {
  const a = (address ?? "").trim();
  const pref = prefectureOf(a);
  let rest = pref ? a.slice(a.startsWith(pref) ? pref.length : pref.replace(/[都府県]$/, "").length) : a;
  // 建物名は「スペース以降」か「ビル・マンション名＋階/号室」で切り出す
  let building = "";
  const sp = rest.search(/[ 　]/);
  if (sp >= 0) { building = rest.slice(sp).trim(); rest = rest.slice(0, sp); }
  else {
    const b = rest.match(/(?:[^\d\s]{2,})(?:ビル|マンション|ハイツ|コーポ|タワー|荘)[^\s]*$/);
    if (b) { building = b[0]; rest = rest.slice(0, rest.length - b[0].length); }
  }
  // 市区町村は「郡+町村」「市+区」も1つとして扱う
  // 政令市は「札幌市北区」までを市区町村として扱う（郡＋町村も1つにまとめる）
  const m = rest.match(/^((?:.+?[郡])?)((?:.+?市(?:.+?区)?)|(?:.+?[区町村]))/);
  const city = m ? `${m[1] ?? ""}${m[2]}` : "";
  const town = city ? rest.slice(city.length).trim() : rest.trim();
  return { pref, city, town, building };
}

export type FillReport = { filled: string[]; unfilled: string[]; hasMessage: boolean; log: string[] };

/** 電話・郵便番号を「ハイフン無しの数字だけ」で入れるべき欄か（maxlength / pattern / inputmode / placeholder / ラベルから判断） */
function wantsDigitsOnly(f: FieldInfo, hyphenLen: number): boolean {
  if (f.placeholder.includes("-") || f.placeholder.includes("－")) return false;
  if (f.maxlength > 0 && f.maxlength < hyphenLen) return true;
  if (f.inputmode === "numeric" || f.inputmode === "tel" && f.maxlength > 0 && f.maxlength < hyphenLen) return true;
  if (f.pattern && /^\^?\[?0-9\]?[\d\\{},+*]*\$?$/.test(f.pattern) && !f.pattern.includes("-")) return true;
  if (/(半角数字のみ|ハイフンなし|ハイフン無し|ハイフン不要|数字のみ)/.test(f.sig)) return true;
  return false;
}

// ---- 単純な入力起因エラーの自動修正ルール（拡張しやすいように配列で持つ）----
// 送信でバリデーションに弾かれたとき、値を機械的に直して1回だけ入れ直す。ルールを足すだけで対応を増やせる。
const hiraToKata = (s: string) => s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
export const FIXUP_RULES: { label: string; cats: Category[]; apply: (v: string) => string }[] = [
  { label: "カナ欄のスペース除去", cats: ["kana", "kana_last", "kana_first"], apply: (v) => v.replace(/[\s　]+/g, "") },
  { label: "ひらがな→カタカナ", cats: ["kana", "kana_last", "kana_first"], apply: hiraToKata },
  { label: "前後の空白を除去", cats: ["company", "name", "name_last", "name_first", "email", "email_confirm", "tel", "url", "address"], apply: (v) => v.trim() },
  { label: "メールの全角→半角", cats: ["email", "email_confirm"], apply: (v) => v.replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/　/g, "") },
];
function applyFixups(cat: Category, value: string): string {
  let v = value;
  for (const r of FIXUP_RULES) if (r.cats.includes(cat)) v = r.apply(v);
  return v;
}

/** textarea の maxlength に収まるように、段落の切れ目で短くする */
function fitMessage(message: string, max: number): string {
  if (!max || message.length <= max) return message;
  const cut = message.slice(0, max);
  const at = Math.max(cut.lastIndexOf("\n\n"), cut.lastIndexOf("。"));
  return (at > max * 0.5 ? cut.slice(0, at + 1) : cut).trim();
}

/** 収集した項目に値を入れる。戻り値は入力レポート */
/** カタカナ→ひらがな。「ふりがな（ひらがな）」の欄にカタカナを入れて弾かれる失敗があった（#120） */
export const kataToHira = (s: string) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

export async function fillFields(target: Page | Frame, fields: FieldInfo[], v: FillValues, opts: { requireMessage?: boolean; normalize?: boolean; mode?: "fill" | "type"; kana?: "hira" | "kata"; numFormat?: "digits" | "hyphen" } = {}): Promise<FillReport> {
  const s = v.sender;
  // normalize 時は「カナのスペース除去」などの修正ルールを通す（送信エラー後の埋め直し用）
  const nz = (cat: Category, value: string) => (opts.normalize ? applyFixups(cat, value) : value);
  // フリガナ欄をひらがなで入れるべきか: ラベルに「ひらがな」とある、またはエラー文で「ひらがなで」と言われた（#120）
  const kanaFor = (f: FieldInfo, cat: Category, value: string) => {
    const own = f.sig.split(" || ")[0] + " " + f.placeholder;
    const wantHira = opts.kana === "hira" || (opts.kana !== "kata" && (/(ひらがな|平仮名)/.test(own) || /^[ぁ-ん\s　]+$/.test(f.placeholder.trim())) && !/(カタカナ|片仮名|カナ)/.test(own.replace(/フリガナ/g, "")));
    const base = nz(cat, value);
    return wantHira ? kataToHira(base) : base;
  };
  const [lastName, firstName] = splitName(s.person);
  const [lastKana, firstKana] = splitName(s.person_kana || "");
  const email = s.email;
  const tels = splitTel(s.tel);
  const postals = splitPostal(s.postal);
  const report: FillReport = { filled: [], unfilled: [], hasMessage: false, log: [] };

  // メッセージ欄を含むフォームだけを対象にする（検索フォームやニュースレター欄を誤って埋めない）
  const msgField = fields.find((f) => classify(f) === "message" && f.tag === "textarea") ?? fields.find((f) => classify(f) === "message");
  if (!msgField && opts.requireMessage !== false) return report;
  // 段階式フォームの1ページ目（本文欄はまだ出ていない）は、見えている欄を全部対象にする
  const scoped = msgField ? fields.filter((f) => f.formIndex === msgField.formIndex) : fields;

  // 項目の種類。欄を1つずつ単独で判定すると、「姓・名」のように1つのラベルに入力欄が2つ並ぶフォームで
  // 2欄とも「姓」になり「田中 田中」と送ってしまう（実例: di-v.co.jp の name_last#2,name_last#3）。
  // 同様に「フリガナ」＋「メイ」で セイ欄にフルネーム・メイ欄に崩れた値が入った例もある。
  // 隣り合う2欄が同じ系統（名前／カナ）で「左=姓・右=名」になっていなければ、左を姓・右を名に振り分ける。
  const catMap = new Map<number, Category>();
  for (const f of scoped) catMap.set(f.idx, classify(f));
  const textLike = scoped.filter((f) => f.tag === "input" && !["radio", "checkbox", "hidden", "submit", "button", "reset", "image", "file"].includes(f.type));
  const looksPaired = (a: FieldInfo, b: FieldInfo) => {
    if (/(姓|苗字|名字).{0,4}名|セイ.{0,4}メイ|last.{0,12}first|first.{0,12}last/i.test(`${a.sig} ${b.sig}`)) return true;
    const base = (n: string) => n.replace(/(\[\d+\]|[_-]?\d+)$/, "");
    return Boolean(a.name && b.name && a.name !== b.name && base(a.name) === base(b.name));
  };
  const family = (c: Category | undefined) => (c === "name" || c === "name_last" || c === "name_first" ? "name" : c === "kana" || c === "kana_last" || c === "kana_first" ? "kana" : null);
  for (let i = 0; i + 1 < textLike.length; i++) {
    const a = textLike[i], b = textLike[i + 1];
    if (a.formIndex !== b.formIndex) continue;
    const ca = catMap.get(a.idx), cb = catMap.get(b.idx), fam = family(ca);
    if (!fam || fam !== family(cb)) continue;
    const last = `${fam}_last` as Category, first = `${fam}_first` as Category;
    if (ca === last && cb === first) { i++; continue; } // 正しく判定済み
    const kind = (c: Category | undefined) => (c === last ? "L" : c === first ? "F" : "G"); // G=区別なし（氏名・フリガナ）
    const k = kind(ca) + kind(cb);
    // LL/FF/GF/LG は明らかに姓名の2欄。GG は「お名前 [ ][ ]」のようにラベル共有か name が連番のときだけ。FL（名→姓の順）はそのまま
    if (k === "LL" || k === "FF" || k === "GF" || k === "LG" || (k === "GG" && looksPaired(a, b))) {
      catMap.set(a.idx, last); catMap.set(b.idx, first);
      report.log.push(`姓名を振り分け: idx${a.idx}=${last} idx${b.idx}=${first}（元 ${ca},${cb}）`);
      i++;
    }
  }
  // メール欄の直後にある「確認のためもう一度…」の欄は、ラベルに「メール」が無くても確認欄として扱う
  for (let i = 0; i + 1 < textLike.length; i++) {
    const a = textLike[i], b = textLike[i + 1];
    if (a.formIndex !== b.formIndex) continue;
    if (catMap.get(a.idx) !== "email") continue;
    const cb = catMap.get(b.idx);
    if (cb === "email_confirm" || cb === "email") continue;
    const confirmish = /(確認|もう一度|再入力|再度|verify|confirm|re-?enter|kakunin)/i.test(`${b.sig} ${b.name} ${b.placeholder}`);
    if (!confirmish) continue;
    if (b.type !== "email" && b.type !== "text" && b.type !== "") continue;
    catMap.set(b.idx, "email_confirm");
    report.log.push(`メール確認欄として判定: idx${b.idx}（元 ${cb}）`);
  }

  const catOf = (f: FieldInfo): Category => catMap.get(f.idx) ?? classify(f);

  // 電話欄が2つ以上あっても、分割入力（03 / 1234 / 5678）とは限らない。「電話番号」と「携帯電話」のように別々の欄だと、
  // 片方に市外局番だけ・もう片方に残りの数字だけが入っていた。同じ見出しを共有する／name が連番／1つ目が5桁以下、のときだけ分割とみなす
  const telSplit = (() => {
    const tl = scoped.filter((x) => x.tag === "input" && classify(x) === "tel");
    if (tl.length < 2) return false;
    const [a, b] = tl;
    if (a.maxlength > 0 && a.maxlength <= 5) return true;
    const ownL = (x: FieldInfo) => x.sig.split(" || ")[0];
    const ctxL = (x: FieldInfo) => (x.sig.split(" || ")[1] || "").trim();
    const other = /(携帯|mobile|keitai|直通|緊急|日中|自宅|会社|勤務先|fax)/i;
    if (other.test(ownL(a)) !== other.test(ownL(b))) return false;
    if (ctxL(a) && ctxL(a) === ctxL(b)) return true;
    const base = (n: string) => n.replace(/(\[\d*\]|[_-]?\d+)$/, "");
    return Boolean(a.name && b.name && a.name !== b.name && base(a.name) === base(b.name));
  })();
  // 送信後のエラー文で「ハイフンなしで」「ハイフンを入れて」と言われたときは、電話・郵便番号の書き方を合わせる
  const numFmt = (value: string, f: FieldInfo, hyphenLen: number, hyphened: string) =>
    opts.numFormat === "digits" ? value.replace(/[^\d]/g, "")
      : opts.numFormat === "hyphen" ? hyphened
      : wantsDigitsOnly(f, hyphenLen) ? value.replace(/[^\d]/g, "") : value;
  // 必須の見出しを共有するチェックボックス群（「ご興味のあるサービス（必須）」等）は、1つ選べば足りる。全部にチェックしない
  const checkedGroups = new Set<string>();
  const groupKey = (f: FieldInfo) => f.name.replace(/\[\]$/, "") || f.glabel;
  for (const f of scoped) if (f.type === "checkbox" && f.checked && groupKey(f)) checkedGroups.add(groupKey(f));

  const counters: Record<string, number> = {};
  const loc = (f: FieldInfo) => target.locator(`[data-fo-idx="${f.idx}"]`);
  const setText = async (f: FieldInfo, value: string) => {
    if (!value) return false;
    try {
      if (opts.mode === "type") {
        // React系フォーム（Jicoo等）は fill() の値セットを認識しないことがあるので、実際のキー入力で入れる。
        // 既存値はキーボードで全選択→削除して消す（fill("") はReactの制御下だと消えないことがある）
        const l = loc(f);
        await l.click({ timeout: 3000 }).catch(() => {});
        await l.press("ControlOrMeta+a").catch(() => {});
        await l.press("Delete").catch(() => {});
        await l.pressSequentially(value, { delay: 5, timeout: 20000 });
        await l.evaluate((e) => (e as HTMLElement).blur()).catch(() => {});
      } else {
        await loc(f).fill(value, { timeout: 4000 });
      }
      return true;
    } catch (e) {
      report.log.push(`fill失敗 idx=${f.idx}: ${String(e).slice(0, 80)}`);
      return false;
    }
  };

  // ラジオ・チェックボックスは name ごとにまとめて扱う
  const radioGroups = new Map<string, FieldInfo[]>();
  for (const f of scoped) {
    if (f.type === "radio") {
      const k = f.name || `r${f.idx}`;
      radioGroups.set(k, [...(radioGroups.get(k) ?? []), f]);
    }
  }
  const handledRadio = new Set<string>();

  for (const f of scoped) {
    const cat = catOf(f);
    if (cat === "ignore") continue;
    const nth = (counters[cat] = (counters[cat] ?? 0) + 1);
    let ok = false;

    if (f.type === "radio") {
      const key = f.name || `r${f.idx}`;
      if (handledRadio.has(key)) continue;
      handledRadio.add(key);
      const group = radioGroups.get(key) ?? [f];
      const pick = pickOption(group.map((g) => ({ f: g, text: g.sig.split(" || ")[0] })), cat);
      if (pick) ok = await ensureChecked(target, pick.f);
    } else if (f.type === "checkbox") {
      const inCheckedGroup = cat !== "agree" && !!groupKey(f) && checkedGroups.has(groupKey(f));
      const shouldCheck = cat === "agree" || ((f.required || (cat === "type" && nth === 1)) && !inCheckedGroup);
      if (shouldCheck && !f.checked) {
        ok = await ensureChecked(target, f);
        // 同意（プライバシーポリシー等）に自動でチェックを入れたことは記録に残す。
        // 「勝手に同意した」と言われたときに、何に同意したのかを説明できるようにしておく
        if (ok && cat === "agree") report.log.push(`同意チェックを自動でチェック: 「${(f.sig.split(" || ")[0] || "同意").slice(0, 40)}」`);
        if (ok && groupKey(f)) checkedGroups.add(groupKey(f));
      } else ok = f.checked || (inCheckedGroup && !!f.required);
    } else if (f.tag === "select") {
      let value: string | undefined;
      if (cat === "prefecture") {
        value = matchPrefOption(f.options, prefectureOf(s.address))?.value;
      } else {
        const pick = pickOption(realOptions(f.options).map((o) => ({ f: o, text: o.text + " " + o.value })), cat);
        value = pick?.f.value;
      }
      if (value !== undefined) {
        try { await loc(f).selectOption(value, { timeout: 3000 }); ok = true; } catch { report.log.push(`select失敗 idx=${f.idx}`); }
      }
    } else {
      switch (cat) {
        case "message": {
          const msg = fitMessage(v.message, f.maxlength);
          if (msg.length < v.message.length) report.log.push(`本文を${f.maxlength}文字に短縮`);
          ok = await setText(f, msg); if (ok) report.hasMessage = true; break;
        }
        case "subject": ok = await setText(f, v.subject); break;
        case "company": ok = await setText(f, nz(cat, s.company)); break;
        case "department": ok = await setText(f, "営業部"); break;
        case "position": ok = await setText(f, "担当"); break;
        case "name": ok = await setText(f, nz(cat, s.person)); break;
        case "name_last": ok = await setText(f, nz(cat, lastName)); break;
        case "name_first": ok = await setText(f, nz(cat, firstName)); break;
        case "kana": ok = await setText(f, kanaFor(f, cat, s.person_kana || s.person)); break;
        case "kana_last": ok = await setText(f, kanaFor(f, cat, lastKana || lastName)); break;
        case "kana_first": ok = await setText(f, kanaFor(f, cat, firstKana || firstName)); break;
        case "email": case "email_confirm": ok = await setText(f, nz(cat, email)); break;
        case "tel": {
          // 「電話番号が必須の欄にだけ入力する」設定なら任意の欄は空のまま。
          // 必須表示を読み取れずサイトに弾かれた場合に備え、埋め直し（normalize）のときは入力する
          if (s.tel_required_only && !f.required && !opts.normalize) { report.log.push(`電話は任意の欄なので未入力 idx=${f.idx}`); continue; }
          // 分割入力（3分割が多いが、2分割＝市外局番とそれ以降、のフォームもある）
          const telBoxes = telSplit ? countOf(scoped, "tel") : 1;
          const val = telBoxes >= 3 && tels.length > 1 ? (tels[nth - 1] ?? "")
            : telBoxes === 2 && tels.length > 1 ? (nth === 1 ? tels[0] : tels.slice(1).join(""))
            : numFmt(s.tel, f, s.tel.length, tels.length > 1 ? tels.join("-") : s.tel);
          ok = await setText(f, val); break;
        }
        case "postal": {
          const boxes = countOf(scoped, "postal");
          const digits = s.postal.replace(/[^\d]/g, "");
          // 3分割（まれ）にも対応: 1つ目3桁・残りを分ける
          const val = boxes >= 3 && digits.length === 7 ? [digits.slice(0, 3), digits.slice(3, 5), digits.slice(5)][nth - 1] ?? ""
            : boxes === 2 ? (postals[nth - 1] ?? "")
            : numFmt(s.postal, f, s.postal.length, postals.length === 2 ? postals.join("-") : s.postal);
          ok = await setText(f, val); break;
        }
        case "prefecture": ok = await setText(f, prefectureOf(s.address)); break;
        case "address": {
          // 「住所2（市区町村）」のように分かれている欄は、ラベルに合わせて入れ分ける（1欄だけのフォームは従来どおり全部入れる）
          const parts = splitAddress(s.address);
          const sig = f.sig;
          const val = /(建物|マンション|ビル名|部屋|号室|アパート)/.test(sig) ? parts.building
            : /(市区町村|市町村|区市町村|city)/i.test(sig) ? parts.city
            : /(町名|番地|丁目|street|address.?[23])/i.test(sig) ? [parts.town, ""].filter(Boolean).join("")
            : nth === 1 ? s.address : "";
          ok = await setText(f, val); break;
        }
        case "url": ok = await setText(f, s.url); break;
        case "type": case "agree": break;
      }
    }
    (ok ? report.filled : report.unfilled).push(`${cat}#${f.idx}${f.required ? "*" : ""}`);
  }
  return report;

  function countOf(list: FieldInfo[], cat: Category) {
    return list.filter((x) => x.tag === "input" && classify(x) === cat).length;
  }
}

/** 送信でバリデーションに弾かれたあと、まだ空のまま残っている「必須」項目を安全な値で埋める（#6）。
 *  判定できなかった質問（例: 「ご予算」「どこで知りましたか」）が必須だと、何度やっても送れずに失敗していた。
 *  ここで埋めるのは「必須」かつ「空」の項目だけで、FAX・パスワード・認証コードには触らない。
 *  自由記述は「特になし」、選択肢は当たり障りのないものを選ぶ。 */
export async function fillRequiredLeftovers(target: Page | Frame, log: string[]): Promise<number> {
  const fields = await collectFields(target);
  let filled = 0;
  const doneGroups = new Set<string>();
  const label = (f: FieldInfo) => (f.sig.split(" || ")[0] || f.name || `項目${f.idx}`).slice(0, 30);
  for (const f of fields) {
    if (!f.required) continue;
    if (NEVER_AI_RE.test(f.sig)) continue;
    const cat = classify(f);
    if (cat === "ignore") continue;
    try {
      if (f.type === "radio") {
        const key = f.name || `r${f.idx}`;
        if (doneGroups.has(key)) continue;
        const group = fields.filter((x) => x.type === "radio" && (x.name || `r${x.idx}`) === key);
        doneGroups.add(key);
        if (group.some((x) => x.checked)) continue;
        const pick = pickOption(group.map((g) => ({ f: g, text: g.sig.split(" || ")[0] })), cat);
        if (pick && (await ensureChecked(target, pick.f))) { filled++; log.push(`必須の選択を補完: 「${label(f)}」→「${pick.text.slice(0, 20)}」`); }
        continue;
      }
      if (f.type === "checkbox") {
        if (f.checked) continue;
        if (await ensureChecked(target, f)) { filled++; log.push(`必須のチェックを補完: 「${label(f)}」`); }
        continue;
      }
      const el = target.locator(`[data-fo-idx="${f.idx}"]`).first();
      const current = await el.inputValue().catch(() => "");
      if (String(current).trim()) continue;
      if (f.tag === "select") {
        const pick = pickOption(realOptions(f.options).map((o) => ({ f: o, text: `${o.text} ${o.value}` })), cat);
        if (pick) { await el.selectOption(pick.f.value, { timeout: 3000 }).catch(() => {}); filled++; log.push(`必須の選択を補完: 「${label(f)}」→「${pick.f.text.slice(0, 20)}」`); }
        continue;
      }
      // 値があるはずの欄（メール・電話など）が空なのは別の原因なので、ここでは触らない
      if (["email", "email_confirm", "tel", "postal", "url", "message"].includes(cat)) continue;
      await el.fill("特になし", { timeout: 3000 });
      filled++;
      log.push(`必須の自由記述を補完: 「${label(f)}」→「特になし」`);
    } catch {
      /* 1項目入れられなくても、他の項目は続ける */
    }
  }
  return filled;
}

/** 確認画面にだけある同意・必須のチェックボックスにチェックを入れる。
 *  確認画面には本文欄が無いので fillFields は何もせず、同意のチェックが入らないまま送信を押して止まっていた。
 *  チェックボックス以外（ヘッダーの検索欄など）には触らない */
export async function checkConfirmAgreements(target: Page | Frame, fields: FieldInfo[], log: string[]): Promise<number> {
  let n = 0;
  for (const f of fields) {
    if (f.type !== "checkbox" || f.checked) continue;
    const cat = classify(f);
    if (cat !== "agree" && !f.required) continue;
    if (cat === "ignore" || NEVER_AI_RE.test(f.sig)) continue;
    if (await ensureChecked(target, f)) {
      n++;
      log.push(`確認画面の${cat === "agree" ? "同意" : "必須の"}チェックを自動でチェック: 「${(f.sig.split(" || ")[0] || f.name || "同意").slice(0, 40)}」`);
    }
  }
  return n;
}

/** Googleフォームなどの「見た目だけの選択肢」（role=radio / role=checkbox）を選ぶ（#119）。
 *  これらは input 要素ではないため、これまで存在に気づけず「この質問は必須です」で弾かれていた。
 *  requiredOnly=true のときは必須の設問だけ、false のときは未選択の設問すべてを対象にする（エラー後の埋め直し用） */
export async function fillAriaChoices(target: Page | Frame, log: string[], opts: { requiredOnly?: boolean } = {}): Promise<number> {
  type G = { g: number; kind: "radio" | "checkbox"; label: string; options: { i: number; text: string }[] };
  let groups: G[] = [];
  try {
    groups = await target.evaluate((requiredOnly) => {
      const out: { g: number; kind: "radio" | "checkbox"; label: string; options: { i: number; text: string }[] }[] = [];
      const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const isRequired = (box: Element) => {
        const item = box.closest('[role="listitem"], fieldset, .question, [data-required]') ?? box;
        return box.getAttribute("aria-required") === "true" || item.querySelector('[aria-required="true"]') !== null
          || /(\*|＊|必須)/.test(((item.querySelector('[role="heading"], legend, label') as HTMLElement | null)?.innerText ?? "").slice(0, 80));
      };
      const labelOf = (box: Element) => {
        const item = box.closest('[role="listitem"], fieldset, .question') ?? box;
        return (((item.querySelector('[role="heading"], legend') as HTMLElement | null)?.innerText) || box.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim().slice(0, 40);
      };
      let gi = 0;
      document.querySelectorAll('[role="radiogroup"]').forEach((box) => {
        const opts = Array.from(box.querySelectorAll('[role="radio"]')).filter(vis);
        if (!opts.length || opts.some((o) => o.getAttribute("aria-checked") === "true")) return;
        if (requiredOnly && !isRequired(box)) return;
        const g = gi++;
        out.push({ g, kind: "radio", label: labelOf(box), options: opts.map((o, i) => { o.setAttribute("data-fo-aria", `${g}-${i}`); return { i, text: (o.getAttribute("aria-label") || (o as HTMLElement).innerText || o.getAttribute("data-value") || "").trim() }; }) });
      });
      // チェックボックスの設問（同じ listitem の中の role=checkbox をひとまとまりとみなす）
      const seen = new Set<Element>();
      document.querySelectorAll('[role="checkbox"]').forEach((cb) => {
        const box = cb.closest('[role="list"], [role="group"], [role="listitem"], fieldset');
        if (!box || seen.has(box)) return;
        seen.add(box);
        const opts = Array.from(box.querySelectorAll('[role="checkbox"]')).filter(vis);
        if (!opts.length || opts.some((o) => o.getAttribute("aria-checked") === "true")) return;
        if (!isRequired(box)) return; // チェックボックスは必須の設問だけ（任意のものに勝手にチェックしない）
        const g = gi++;
        out.push({ g, kind: "checkbox", label: labelOf(box), options: opts.map((o, i) => { o.setAttribute("data-fo-aria", `${g}-${i}`); return { i, text: (o.getAttribute("aria-label") || (o as HTMLElement).innerText || "").trim() }; }) });
      });
      return out;
    }, opts.requiredOnly !== false);
  } catch { return 0; }
  let filled = 0;
  for (const g of groups) {
    const pick = pickOption(g.options.map((o) => ({ f: o, text: o.text })), "type");
    if (!pick) continue;
    try {
      await target.locator(`[data-fo-aria="${g.g}-${pick.f.i}"]`).first().click({ timeout: 3000 });
      filled++;
      log.push(`選択式の設問に回答: 「${g.label || "（見出しなし）"}」→「${pick.text.slice(0, 20)}」`);
    } catch { /* 押せなくても他の設問は続ける */ }
  }
  return filled;
}

/** 入力チェックで引っかかっている欄の名前を集める（#122）。
 *  「送信ボタンが有効になりません」だけでは、人が直すときにどの欄を見ればよいか分からなかった */
export async function describeInvalidFields(target: Page | Frame): Promise<string[]> {
  try {
    return await target.evaluate(() => {
      const out: string[] = [];
      const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const label = (el: Element) => {
        const id = el.getAttribute("id");
        const byFor = id ? (document.querySelector(`label[for="${CSS.escape(id)}"]`) as HTMLElement | null)?.innerText : "";
        const wrap = (el.closest("label") as HTMLElement | null)?.innerText;
        const row = (el.closest("tr, dl, .form-group, .field, p, li") as HTMLElement | null)?.innerText;
        return (byFor || wrap || el.getAttribute("aria-label") || el.getAttribute("placeholder") || (row ?? "").split("\n")[0] || el.getAttribute("name") || "").replace(/\s+/g, " ").trim().slice(0, 24);
      };
      const cands = Array.from(document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea')).filter(vis);
      for (const el of cands) {
        const f = el as HTMLInputElement;
        const invalid = el.getAttribute("aria-invalid") === "true" || (typeof f.checkValidity === "function" && !f.checkValidity())
          || ((f.required || el.getAttribute("aria-required") === "true") && !(f.type === "checkbox" || f.type === "radio" ? f.checked : String(f.value ?? "").trim()));
        if (!invalid) continue;
        const l = label(el);
        if (l && !out.includes(l)) out.push(l);
        if (out.length >= 5) break;
      }
      return out;
    });
  } catch { return []; }
}

/** 確認画面などの「戻る」を押す（#121）。「前画面に戻って正しく入力してください」と言われたときに使う */
export async function clickBackButton(target: Page | Frame, page: Page): Promise<boolean> {
  try {
    const idx = await target.evaluate(() => {
      const vis = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const els = Array.from(document.querySelectorAll('button, input[type=button], input[type=submit], a, [role=button]')).filter(vis);
      const hit = els.find((el) => /^(前(の)?(画面|ページ)?(に|へ)?)?(戻る|もどる|修正(する)?|入力(画面)?(に|へ)戻る|back)$/i.test((((el as HTMLElement).innerText || (el as HTMLInputElement).value || "")).replace(/[\s<>＜＞«»←]/g, "")));
      if (!hit) return false;
      hit.setAttribute("data-fo-back", "1");
      return true;
    });
    if (!idx) { await page.goBack({ timeout: 8000 }).catch(() => {}); return true; }
    await target.locator('[data-fo-back="1"]').first().click({ timeout: 4000 });
    await page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(600);
    return true;
  } catch { return false; }
}

/** チェックボックス／ラジオを確実にONにする（カスタムデザインで本体が隠れている場合はラベルクリック→JS） */
async function ensureChecked(target: Page | Frame, f: FieldInfo): Promise<boolean> {
  const el = target.locator(`[data-fo-idx="${f.idx}"]`).first();
  const isOn = () => el.evaluate((e) => (e as HTMLInputElement).checked).catch(() => false);
  // まず label / label[for] の実クリック（React系はこれでないと状態が更新されない）
  try { await el.check({ timeout: 2000 }); } catch {}
  if (await isOn()) return true;
  if (f.id) { try { await target.locator(`label[for="${f.id}"]`).first().click({ timeout: 1500 }); } catch {} }
  if (await isOn()) return true;
  // React系（Jicoo/MUI等）: 入力本体は透明。見えている祖先要素（選択肢の見た目）を実クリックすると onChange が発火する
  try {
    const box = await el.evaluateHandle((e) => {
      let a: Element = e;
      for (let p = e.parentElement, i = 0; i < 3 && p; i++, p = p.parentElement) {
        const r = p.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) { a = p; break; }
      }
      return a;
    });
    const handle = box.asElement();
    if (handle) await handle.click({ timeout: 1500 }).catch(() => {});
  } catch {}
  if (await isOn()) return true;
  // 最後の手段: force クリック → JSで直接ON＋イベント発火
  try { await el.check({ timeout: 1500, force: true }); } catch {}
  if (await isOn()) return true;
  try { await el.evaluate((e) => { const i = e as HTMLInputElement; const lab = i.closest("label"); if (lab) lab.click(); if (!i.checked) { i.checked = true; i.dispatchEvent(new Event("input", { bubbles: true })); i.dispatchEvent(new Event("change", { bubbles: true })); } }); } catch {}
  return isOn();
}

/** ラジオ／セレクトの選択肢から「営業の問い合わせ」に一番近いものを選ぶ */
function pickOption<T>(opts: { f: T; text: string }[], cat: Category): { f: T; text: string } | undefined {
  const valid = opts.filter((o) => o.text.trim() && !/(選択して(ください|下さい)|選んで(ください|下さい)|お選び(ください|下さい)|please select|^[-ー－─=＝▼▽*＊\s]*(選択|未選択|選択なし)?[-ー－─=＝▼▽*＊\s]*$)/i.test(o.text.trim()));
  if (!valid.length) return undefined;
  if (cat === "agree") return valid.find((o) => /(同意する|同意します|agree|はい|yes)/i.test(o.text)) ?? valid[0];
  // 都道府県は送信者の所在地と合うものだけ（matchPrefOption）。合わないのに先頭の「北海道」を選ぶと事実と違う値を送る
  if (cat === "prefecture") return undefined;
  // 明らかに場違いな選択肢（採用・クレーム・取材・個人のお客様 など）は先に除く。
  // 先頭の選択肢をそのまま選ぶと「採用について」等になり、相手に不自然に見える（返信も来ない）
  // 「お仕事をお探しの方／企業の方」のような二択で求職者側を選ぶと、人材登録や応募をしたことになる（実例あり）
  const AVOID = /(採用|求人|エントリー|新卒|中途|アルバイト|resume|recruit|苦情|クレーム|返品|交換|修理|故障|不具合|解約|退会|キャンセル|取材|報道|プレス|press|寄付|見学|individual|個人のお客様|一般のお客様|お客様専用|会員|ログイン|パスワード|求職|お仕事(を)?(お)?(探|さが)し|仕事(を)?(お)?(探|さが)し|働きたい|転職|就職|応募|登録(希望|したい|について)|スタッフ(登録|希望|の方)|派遣で|個人の方|一般の方)/i;
  const preferred = valid.filter((o) => !AVOID.test(o.text));
  const pool = preferred.length ? preferred : valid;
  const prefer = [
    /(企業|法人)(の|ご)?(方|様|担当|お客様)|採用(ご)?担当|人材(を)?(お)?探し|ご利用(企業|法人)|求人(を)?(ご)?(掲載|依頼)/,
    /その他/,
    /(ご提案|提案|協業|業務提携|パートナー|取引|仕入|business|アライアンス)/i,
    /(サービス|商品|製品|導入).{0,8}(について|に関する|案内|のご相談|検討)/,
    /(法人|企業|ビジネス|会社)(の)?(お客様|様|向け)?/,
    /(お問い?合わ?せ|ご相談|general|other|inquiry)/i,
  ];
  for (const re of prefer) {
    const hit = pool.find((o) => re.test(o.text));
    if (hit) return hit;
  }
  return pool[0] ?? valid[0];
}

// ---- 想定外の項目へのAI回答（全文AI生成モード用）----
// フォームには会社名・氏名・メール等の「よくある項目」以外の質問が混ざることがある
// （例:「弊社を何で知りましたか」「ご予算」）。分類できなかった必須項目のラベルをAIに読ませ、
// 文脈に合う回答を作って入力する。AIが自信を持てない項目は埋めずに返し、呼び出し側が
// 「要確認」として手動送信リストへ振り分ける。CAPTCHA等のボット対策を回避する機能ではない。

/** 触ってはいけない ignore（fax・パスワード・認証系など）と、単に分類できなかった想定外項目を区別する */
const NEVER_AI_RE = /(fax|ファックス|ファクス|password|パスワード|search|検索|captcha|認証コード|画像の文字|クーポン|coupon)/i;

const ownLabelOf = (f: FieldInfo) => {
  const raw = ((f.sig.split(" || ")[0] || "").split(" | ")[0] || f.name).trim();
  return Array.from(new Set(raw.split(/\s+/))).join(" ").slice(0, 40); // 「ご予算 ご予算」のような重複を除く
};
const ctxLabelOf = (f: FieldInfo) => (f.sig.split(" || ")[1] || "").trim().slice(0, 60);

/** 画面（要確認UI）にも出す「未回答の質問」の形 */
export type PendingQuestion = { label: string; kind: "text" | "choice"; multiple?: boolean; options?: string[] };

export type UnknownQuestions = {
  texts: FieldInfo[]; // 必須なのに種類を判定できなかったテキスト欄
  groups: { label: string; multiple: boolean; members: FieldInfo[]; options: string[] }[]; // 未チェックのラジオ・チェック群
};

/** AI/手動回答の対象: 判定できなかった必須テキスト欄 ＋ どれもチェックされていない選択肢グループ */
export function collectUnknownQuestions(fields: FieldInfo[]): UnknownQuestions {
  const texts = fields.filter(
    (f) =>
      f.required &&
      classify(f) === "ignore" &&
      !NEVER_AI_RE.test(f.sig) &&
      (f.tag === "textarea" || (f.tag === "input" && !["checkbox", "radio", "file"].includes(f.type))),
  );
  const map = new Map<string, { label: string; multiple: boolean; members: FieldInfo[]; options: string[] }>();
  for (const f of fields) {
    if (f.type !== "radio" && f.type !== "checkbox") continue;
    if (classify(f) !== "type") continue;
    const heading = (f.glabel || ctxLabelOf(f)).trim();
    // 除外語（検索・fax等）は設問見出しで判定する。選択肢名（「検索」等）で弾かない
    if (!heading || NEVER_AI_RE.test(heading)) continue;
    const key = f.name || heading;
    const g = map.get(key) ?? { label: heading.slice(0, 60), multiple: f.type === "checkbox", members: [], options: [] };
    g.members.push(f);
    const own = ownLabelOf(f);
    if (own && !g.options.includes(own)) g.options.push(own);
    map.set(key, g);
  }
  // 2択以上あり、まだ1つもチェックされていないグループだけ（既定ロジックが選べたものは触らない）
  const groups = [...map.values()].filter((g) => g.members.length >= 2 && g.options.length >= 2 && !g.members.some((m) => m.checked));
  return { texts, groups };
}

export function toPendingQuestions(q: UnknownQuestions): PendingQuestion[] {
  return [
    ...q.texts.map((f) => ({ label: ownLabelOf(f) || ctxLabelOf(f) || `項目${f.idx}`, kind: "text" as const })),
    ...q.groups.map((g) => ({ label: g.label, kind: "choice" as const, multiple: g.multiple, options: g.options.slice(0, 15) })),
  ];
}

export type UnknownFieldOutcome = { answered: string[]; unsure: PendingQuestion[]; log: string[] };

/** 想定外の質問に回答して入力する。優先順位は 手動回答（利用者が画面で選んだもの）→ AI。
    どちらでも決められなかった質問は unsure として返し、呼び出し側が「要確認」に振り分ける。 */
export async function aiAnswerUnknownFields(
  target: Page | Frame,
  q: UnknownQuestions,
  ctx: { company: string; sender: SenderProfile; message: string },
  llmFn: ((system: string, user: string, maxTokens?: number) => Promise<string>) | null,
  manual: { label: string; answer: string }[] = [],
): Promise<UnknownFieldOutcome> {
  const out: UnknownFieldOutcome = { answered: [], unsure: [], log: [] };
  type Item = { qid: number; kind: "text" | "choice"; label: string; f?: FieldInfo; g?: UnknownQuestions["groups"][0] };
  const items: Item[] = [
    ...q.texts.map((f, i) => ({ qid: i, kind: "text" as const, label: ownLabelOf(f) || ctxLabelOf(f) || `項目${f.idx}`, f })),
    ...q.groups.map((g, i) => ({ qid: q.texts.length + i, kind: "choice" as const, label: g.label, g })),
  ];
  if (!items.length) return out;

  const norm = (s: string) => s.replace(/\s+/g, "");
  const answers = new Map<number, string>();
  // 1) 手動回答（ラベルの部分一致で対応づけ）
  for (const it of items) {
    const hit = manual.find((m) => m.answer && (norm(m.label) === norm(it.label) || norm(it.label).includes(norm(m.label)) || norm(m.label).includes(norm(it.label))));
    if (hit) answers.set(it.qid, hit.answer);
  }
  // 2) 残りをAIに（AIが使えるときだけ）
  const rest = items.filter((it) => !answers.has(it.qid));
  if (rest.length && llmFn) {
    const list = rest
      .map((it) => `- qid=${it.qid} 質問:「${it.label}」${it.kind === "choice" ? ` 選択肢: ${it.g!.options.join(" / ")}${it.g!.multiple ? "（複数選択可・1つでよい）" : ""}` : "（自由記入）"}`)
      .join("\n");
    const s = ctx.sender;
    const system = `あなたは日本のBtoB営業担当のアシスタントです。企業の問い合わせフォームの入力項目に、送信者情報と文脈に沿った短い回答を作ります。
守ること:
- 事実として渡された情報だけを使う。虚偽・推測の数値や実績は書かない
- 選択肢がある質問は、選択肢の中から営業の問い合わせとして最も自然なものを「そのままの文字」で1つ選ぶ（「その他」があり判断に迷うならそれを選ぶ）
- 回答を決められない質問・答えるべきでない質問（口座番号・会員番号・紹介コード・予算の具体額など）は "不明" とする
- 出力はJSON配列のみ。説明文は書かない`;
    const user = `次のフォームの質問に入れる値を作ってください。

【送信者（こちら側）の情報】
会社名: ${s.company} / 担当: ${s.person} / メール: ${s.email}${s.tel ? ` / 電話: ${s.tel}` : ""}${s.url ? ` / URL: ${s.url}` : ""}${s.address ? ` / 住所: ${s.address}` : ""}

【送ろうとしている内容（冒頭）】
${ctx.message.slice(0, 300)}

【宛先の会社】${ctx.company}

【質問】
${list}

出力形式（JSONのみ）: [{"qid": 数値, "answer": "値または不明"}]`;
    try {
      const raw = await llmFn(system, user, 500);
      const m = raw.match(/\[[\s\S]*\]/);
      if (!m) throw new Error("JSONが見つからない");
      for (const a of JSON.parse(m[0]) as { qid: number; answer: string }[]) {
        if (typeof a?.qid === "number" && typeof a?.answer === "string" && !answers.has(a.qid)) answers.set(a.qid, a.answer.trim());
      }
    } catch (e) {
      out.log.push(`AI回答の生成に失敗: ${String((e as Error).message ?? e).slice(0, 100)}`);
    }
  }
  // 3) 回答を実際に入力する
  for (const it of items) {
    const ans = answers.get(it.qid);
    const giveUp = () => out.unsure.push(it.kind === "text" ? { label: it.label, kind: "text" } : { label: it.label, kind: "choice", multiple: it.g!.multiple, options: it.g!.options.slice(0, 15) });
    if (!ans || /^["「]?不明["」]?$/.test(ans)) { giveUp(); continue; }
    if (it.kind === "text") {
      try {
        await target.locator(`[data-fo-idx="${it.f!.idx}"]`).fill(ans.slice(0, 200), { timeout: 3000 });
        out.answered.push(`${it.label}=${ans.slice(0, 30)}`);
      } catch { giveUp(); }
    } else {
      // 回答文字列に含まれる選択肢を全部チェック（複数回答は「／」区切り）。単一選択は最初の1つだけ
      const hits = it.g!.members.filter((m) => { const own = norm(ownLabelOf(m)); return own && (norm(ans).includes(own) || own.includes(norm(ans))); });
      const targets = it.g!.multiple ? hits : hits.slice(0, 1);
      let okAny = false;
      for (const m of targets) { if (await ensureChecked(target, m)) okAny = true; }
      if (okAny) out.answered.push(`${it.label}=${ans.slice(0, 30)}`);
      else giveUp();
    }
  }
  return out;
}

// ---- ボタン ----
const SUBMIT_RE = /(送信|送る|申し?込|送付|submit|send|soushin|sousin|完了する|確定|この内容で)/i;
const CONFIRM_RE = /(確認|次へ|進む|すすむ|confirm|kakunin|next|preview|入力内容)/i;
const BACK_RE = /(戻る|もどる|修正|back|modoru|return|edit|訂正|キャンセル|cancel|リセット|reset|clear|クリア|やり直)/i;
// 送信・確認の言葉を含んでいても、押してはいけないボタン。
// 「入力内容保存／読込」（formzu）を確認ボタンとして押し続けた例、検索ボタン（class名 sb-search-submit）を送信ボタンとして押した例があった
const NOT_SUBMIT_RE = /(保存|読込|読み込|印刷|print|検索|search|ログイン|login|住所(を)?(自動)?(入力|取得)|郵便番号から|添付|ファイル(を)?選択|upload|アップロード|メルマガ|newsletter|subscribe|翻訳|translate)/i;
// 「送信内容を確認する」「確認画面へ」のように文末が確認で終わるボタンは、「送信」を含んでも確認ボタン
// （b-coach.jp の実例: 送信ボタン扱いで押し、確認画面を「フォームが消えた＝送信済み」と誤判定していた）。
// 「内容を確認して送信」のように文末が送信のものは送信ボタンのまま
const CONFIRM_END_RE = /(確認(する|します|画面へ|画面に進む|へ進む|へ)?|confirm)[\s>＞»→▶]*$/i;
// 押したあとに出る確認画面の文言（ボタン名で見分けられなかったときの保険）
const CONFIRM_PAGE_RE = /(下記の?内容で送信|以下の内容で送信|下記の内容でよろしければ|以下の内容でよろしければ|入力内容(を|の)?(ご)?確認|内容を(ご)?確認(の(上|うえ)|下さい|ください)|[「『]送信(する)?[」』]\s*(ボタン)?を(押|クリック))/;
// ページ内ポップアップの確認文言（入力欄は後ろに残ったままなので「フォームが消えた」判定とは別に見る）
const CONFIRM_MODAL_RE = /(送信|この内容で|以下の内容で|下記の内容で|お問い?合わ?せ).{0,25}(よろしいですか|よろしいでしょうか)/;

const BUTTONS_SCRIPT = `
(() => {
  // Array.from / Set は使わない（サイトの古いライブラリが書き換えていることがある）
  const old = document.querySelectorAll('[data-fo-btn]');
  for (let k = 0; k < old.length; k++) old[k].removeAttribute('data-fo-btn');
  const list = document.querySelectorAll('button, input[type=submit], input[type=button], input[type=image], a, [role=button], [onclick], [class*="submit"], [id*="submit"], [class*="btn"]');
  // 入力した本文欄と同じフォーム（form 要素が無ければ、入力欄を3つ以上含むいちばん近い箱）。この中のボタンを優先する。
  // ページ全体のDOM順で選ぶと、ヘッダーの「お申し込み」やスライダーの「Next」を先に押していた
  const ta = document.querySelector('textarea[data-fo-idx]');
  let scope = ta ? ta.closest('form') : null;
  if (ta && !scope) {
    let a = ta.parentElement;
    while (a && a !== document.body && a.querySelectorAll('[data-fo-idx]').length < 3) a = a.parentElement;
    scope = a && a !== document.body ? a : null;
  }
  const out = [];
  let i = 0;
  for (let k = 0; k < list.length; k++) {
    const el = list[k];
    if (typeof el.getBoundingClientRect !== 'function') continue;
    const r = el.getBoundingClientRect(); const st = getComputedStyle(el);
    if (r.width === 0 || r.height === 0 || st.display === 'none' || st.visibility === 'hidden') continue;
    const tag = el.tagName;
    // div等をボタン扱いするのは、テキストが短い（=ボタンらしい）ものだけ。大きなコンテナを誤クリックしない
    if (!/^(BUTTON|INPUT|A)$/.test(tag) && ((el.innerText || '').trim().length > 40 || el.querySelector('input,textarea,select'))) continue;
    // 中の画像の alt（画像だけのボタン。<a><img alt="送信する"></a> など）
    let alt = '';
    const imgs = el.querySelectorAll ? el.querySelectorAll('img[alt]') : [];
    for (let m = 0; m < imgs.length && !alt; m++) alt = (imgs[m].getAttribute('alt') || '').trim();
    // 画像ボタンで alt が無いときは、画像のファイル名や name を手がかりにする（btn_send.gif / kakunin.png / back.gif）
    let hint = '';
    if (tag === 'INPUT' && (el.getAttribute('type') || '').toLowerCase() === 'image') hint = ((el.getAttribute('src') || '').split('/').pop() || '') + ' ' + (el.getAttribute('name') || '') + ' ' + (el.id || '');
    const cls = typeof el.className === 'string' ? el.className : ''; // SVG は className が文字列でない（.trim で落ちていた: tokyu-bs.co.jp の実例）
    const text = String(el.innerText || el.value || el.getAttribute('alt') || alt || el.getAttribute('aria-label') || el.getAttribute('title') || hint || cls || '').trim().replace(/\\s+/g,' ').slice(0, 60);
    // ただのリンク（class も onclick も無い <a>）は、短い文言で、ページを移らないもの（# / javascript: / フォームの中）だけをボタン候補にする
    if (tag === 'A' && !el.getAttribute('role') && !el.getAttribute('onclick') && !/btn|button|submit/i.test(cls + ' ' + (el.id || ''))) {
      const href = (el.getAttribute('href') || '').trim();
      const stays = href === '' || href.charAt(0) === '#' || /^javascript:/i.test(href) || !!el.closest('form');
      if (!stays || !text || text.length > 20) continue;
    }
    let leaves = false;
    if (tag === 'A') {
      // 別タブで開くリンク（プライバシーポリシー等）は送信ボタンではない
      if ((el.getAttribute('target') || '').toLowerCase() === '_blank') continue;
      // ヘッダー・ナビ・フッターにある、別のページへ移るリンク（「お申し込み」等の案内ボタン）は押さない。
      // 押すと別ページへ移り「フォームが消えた＝送信済み」と誤判定していた
      const href2 = (el.getAttribute('href') || '').trim();
      if (href2 && href2.charAt(0) !== '#' && !/^javascript:/i.test(href2) && !el.getAttribute('onclick') && !el.closest('form')) {
        let other = true;
        try { const u = new URL(el.href, location.href); other = u.pathname !== location.pathname || u.origin !== location.origin; } catch (e) {}
        if (other && el.closest('header, nav, footer, [class*="header"], [id*="header"], [class*="footer"], [id*="footer"]')) continue;
        // それ以外の場所（追従する案内ボタン等）は、ほかに押せるボタンが無いときだけ使う（確認画面の送信が send.php へのリンク、という古いサイトがある）
        if (other) leaves = true;
      }
    }
    // 検索フォームのボタンか（サイト内検索を「送信ボタン」として押さない）
    const form = el.closest('form');
    // スライダー・カルーセルの「Next」「Prev」（フォームの外にあるもの）は確認ボタンではない
    if (!form && /(slick|swiper|carousel|slider|splide|owl-|glide|flickity)/i.test(cls + ' ' + ((el.parentElement && typeof el.parentElement.className === 'string') ? el.parentElement.className : ''))) continue;
    let search = /search|検索/i.test(cls + ' ' + (el.id || '') + ' ' + (el.getAttribute('name') || ''));
    if (form && !search) {
      search = form.getAttribute('role') === 'search' || /search/i.test((form.getAttribute('action') || '') + ' ' + (typeof form.className === 'string' ? form.className : '') + ' ' + (form.id || ''))
        || !!form.querySelector('input[type=search], input[name="s"], input[name="q"]');
    }
    if (!search && el.closest('[role=search]')) search = true;
    el.setAttribute('data-fo-btn', String(i));
    // ページ内ポップアップ（確認ダイアログ等）の中のボタンか。明示的なダイアログ要素か、画面に固定表示された重なり（position:fixed で z-index が高い）の中
    let inDialog = !!el.closest('dialog[open],[role=dialog],[role=alertdialog],[aria-modal=true],[class*="modal"],[class*="Modal"],[class*="dialog"],[class*="Dialog"],[class*="popup"],[class*="lightbox"]');
    // 固定表示のヘッダー・追従する案内ボタン（「お申し込み」等の <a>）はポップアップではない
    const fixedOk = !el.closest('header, nav, [class*="header"], [id*="header"]') && !(tag === 'A' && !form);
    for (let a = el.parentElement; fixedOk && !inDialog && a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.position === 'fixed' && Number(cs.zIndex) >= 10) inDialog = true;
    }
    out.push({ idx: i, text, type: (el.getAttribute('type') || tag).toLowerCase(), inForm: !!form, disabled: !!el.disabled, inDialog, search, near: !!scope && scope.contains(el), leaves });
    i++;
  }
  return out;
})()`;

type Btn = { idx: number; text: string; type: string; inForm: boolean; disabled: boolean; inDialog: boolean; search: boolean; near: boolean; leaves: boolean };

/** 送信系ボタンはあるのに全部 disabled か（React系フォームが入力を認識していないサイン） */
export async function allSubmitButtonsDisabled(target: Page | Frame): Promise<boolean> {
  return target.evaluate(
    ([submitSrc, backSrc]) => {
      const submitRe = new RegExp(submitSrc, "i");
      const backRe = new RegExp(backSrc, "i");
      const cands = Array.from(document.querySelectorAll("button, input[type=submit]")).filter((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        const text = ((el as HTMLElement).innerText || (el as HTMLInputElement).value || "").trim();
        if (backRe.test(text)) return false;
        return (el.getAttribute("type") || "").toLowerCase() === "submit" || submitRe.test(text);
      });
      return cands.length > 0 && cands.every((el) => (el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true");
    },
    [SUBMIT_RE.source, BACK_RE.source] as [string, string],
  ).catch(() => false);
}

/** 確認または送信のボタンを押す。
 *  preferSubmit: すでに確認画面へ進んだあと。確認と送信の両方があれば送信を選ぶ（確認ボタンを押し続けて抜けられなくなるのを防ぐ） */
export async function clickNextButton(target: Page | Frame, page: Page, log: string[], opts: { preferSubmit?: boolean } = {}): Promise<"confirm" | "submit" | "none"> {
  // 押した直後でページが切り替わっている途中だと evaluate が落ちる（Execution context was destroyed）。読み込みを待って1回だけやり直す
  const btns = (await target.evaluate(BUTTONS_SCRIPT).catch(async () => {
    await page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(800);
    return target.evaluate(BUTTONS_SCRIPT);
  })) as Btn[];
  let usable = btns.filter((b) => !BACK_RE.test(b.text) && !b.disabled && !b.search && !NOT_SUBMIT_RE.test(b.text));
  // 確認ポップアップが開いていれば、その中の送信・確認ボタンを優先する（di-v.co.jp の実例:
  // 「送信する」→ ページ内に「この内容で送信します。よろしいですか？」が出て、その中の「送信」を押す必要があった。
  // 後ろに残っている元のボタンを押しても先に進まない）
  const inDialog = usable.filter((b) => b.inDialog && (SUBMIT_RE.test(b.text) || CONFIRM_RE.test(b.text)));
  // 入力した本文欄と同じフォームの中に送信・確認のボタンがあれば、それだけを候補にする（無いときだけページ全体から選ぶ）
  const near = usable.filter((b) => b.near && (SUBMIT_RE.test(b.text) || CONFIRM_RE.test(b.text) || ((b.type === "submit" || b.type === "image") && b.inForm)));
  if (inDialog.length) usable = inDialog;
  else if (near.length) usable = near;
  // 別のページへ移るだけのリンク（追従する「お申し込み」ボタン等）は、ほかに送信・確認のボタンがあれば使わない
  const stay = usable.filter((b) => !b.leaves && (SUBMIT_RE.test(b.text) || CONFIRM_RE.test(b.text) || ((b.type === "submit" || b.type === "image") && b.inForm)));
  if (stay.length) usable = usable.filter((b) => !b.leaves);
  const confirm = usable.find((b) => CONFIRM_RE.test(b.text) && (!SUBMIT_RE.test(b.text) || CONFIRM_END_RE.test(b.text.trim())));
  // 画像ボタン（input type=image）も、フォームの中にあれば送信ボタンの候補にする（alt が無い画像ボタンを見つけられなかった）
  const submitNamed = usable.find((b) => SUBMIT_RE.test(b.text) && !(CONFIRM_RE.test(b.text) && CONFIRM_END_RE.test(b.text.trim())))
    ?? usable.find((b) => SUBMIT_RE.test(b.text) && b !== confirm);
  // 名前では分からないが、フォームの中にある送信用のボタン。画像ボタン（input type=image）も候補にする
  // （alt の無い画像ボタンを見つけられなかった）。[戻る][送信] の並びが多いので、最後のものを選ぶ
  const submitAny = usable.filter((b) => (b.type === "submit" || b.type === "image") && b.inForm && b !== confirm).pop();
  // 確認画面へ進んだあとは、名前で送信と分かるボタンを先に選ぶ。名前で分からないボタンは最後の手段
  // （確認ボタンを「送信」として押すと、確認画面を「フォームが消えた＝送信済み」と誤判定するため）
  const target_ = opts.preferSubmit ? (submitNamed ?? confirm ?? submitAny) : (confirm ?? submitNamed ?? submitAny);
  if (!target_) {
    // ボタンが見つからないとき: 入力済みフォームを JS で直接 submit する（SPA やアイコンだけのボタンへの最後の手段）。
    // 確認画面には入力欄が無い（値は hidden で持っている）ので、そのときは hidden をいちばん多く持つフォームを送る
    const ok = await target.evaluate((afterConfirm) => {
      // 本文欄のフォームを送る（先頭の [data-fo-idx] はヘッダーの検索欄のことがある）
      let f = (document.querySelector("textarea[data-fo-idx]") ?? document.querySelector("[data-fo-idx]"))?.closest("form") ?? null;
      if (f && (f.getAttribute("role") === "search" || f.querySelector('input[type=search], input[name="s"], input[name="q"]'))) f = null;
      if (!f && afterConfirm) {
        let best = 0;
        const forms = document.querySelectorAll("form");
        for (let k = 0; k < forms.length; k++) {
          const g = forms[k];
          if (g.getAttribute("role") === "search" || g.querySelector('input[type=search], input[name="s"], input[name="q"]')) continue;
          const n = g.querySelectorAll("input[type=hidden]").length;
          if (n >= 2 && n > best) { best = n; f = g; }
        }
      }
      if (!f) return false;
      if (f.requestSubmit) f.requestSubmit(); else f.submit();
      return true;
    }, !!opts.preferSubmit).catch(() => false);
    if (ok) {
      log.push("送信ボタン不検出 → form.requestSubmit() で送信");
      await page.waitForTimeout(2500);
      await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
      return "submit";
    }
    return "none";
  }
  const kind = target_ === confirm ? "confirm" : "submit";
  log.push(`click[${kind}] "${target_.text}"`);
  const before = page.url();
  try {
    await Promise.all([
      page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {}),
      target.locator(`[data-fo-btn="${target_.idx}"]`).first().click({ timeout: 5000 }),
    ]);
  } catch (e) {
    log.push(`click失敗: ${String(e).slice(0, 100)}`);
    // JS で submit を試す
    try { await target.locator(`[data-fo-btn="${target_.idx}"]`).first().evaluate((el: Element) => { const b = el as HTMLButtonElement; if (b.form) { if (b.form.requestSubmit) b.form.requestSubmit(); else b.form.submit(); } else b.click(); }); } catch {}
  }
  await page.waitForTimeout(2500);
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  if (page.url() !== before) log.push(`url→ ${page.url()}`);
  return kind;
}

// ---- 結果判定 ----
// 「お問い合わせいただきありがとうございます。担当者より、追ってご連絡いたします。」（aidas.co.jp の実例）のように
// 「〜いただき／頂きありがとう」「担当者より追ってご連絡」の形を知らず判定不能→失敗扱いになっていたため追加
const SUCCESS_RE = /((お問い?合わ?せ|ご連絡|ご送信|送信|ご応募|ご依頼|ご相談|ご登録|お申し?込み)(を)?(いただき|頂き)(まして)?[、,]?(誠に|大変|本当に)?(ありがとう|有難う|有り難う)|(担当(者)?|スタッフ|係)(より|から)[、,]?(追って|改めて|折り返し|後ほど|のちほど)?[、,]?(ご?連絡|ご?返信|ご?回答)(いた|致|させていただ|を差し上げ)|追って(ご?連絡|ご?返信)(いた|致|させていただ)|送信(が|は)?(完了|されました|いたしました|しました|致しました)|送信ありがとう|(ご|お)?回答(を)?(いただき|頂き)?(まして)?[、,]?(誠に|大変)?(ありがとう|有難う|有り難う)|お問い?合わ?せ(を)?(ありがとう|受け付け|承り|受付)|ありがとうございま(す|した)。?(お問い?合わ?せ|送信|受付)|受け付けました|受付(が)?完了|承りました|thank you for (contacting|your (message|inquiry|submission))|(message|inquiry|form)( has been| was)? (sent|submitted|received)|submitted successfully|successfully sent|自動返信(の)?メール(を)?(お送り|送付|送信|送らせて)|確認(の)?メール(を)?(お送り|送付|送信)|正常に(送信|受け付け|受付|完了)|(送信|受付|受け付け|お申し?込み|申込)(が|を)?(完了|終了)(いたし|致)?(ました)?|ご入力(いただき)?(誠に)?ありがとう|受付番号|お問い?合わ?せ番号)/i;
// 完了ページのURL。「customer-success」「representative」（sent）「presentation」（sent）のように、単語の一部に当たって
// 確認ボタンを押しただけで送信済みにしていたので、他の語に埋もれにくい語（thanks 等）以外は区切り文字（/ _ - .）で囲まれたときだけ採用する
const SUCCESS_URL_RE = /(thanks|thank-?you|kanryo|kanryou|touroku_kanryo|(^|[/_.-])(complete|completed|done|sent|success|finish|finished)([/_.-]|$))/i;
// 完了文言のうち、確認画面や入力画面の予告文にも出る弱いもの（「送信後、確認メールをお送りします」「ご入力ありがとうございます。内容をご確認ください」）
const WEAK_SUCCESS_RE = /^(自動返信|確認(の)?メール|ご入力(いただき)?(誠に)?ありがとう|受付番号|お問い?合わ?せ番号)/;
// 「下さい」表記、「未入力です」「入力されていません」「は必須です」「カタカナ以外の文字が…」なども拾う。
// これらを知らず、エラーが出ているのに「判定不能」「確認画面を抜けられない」になっていた（hightouch-haken.com / fs224.formasp.jp / tac21 の実例）
const ERROR_RE = /((入力|記入|選択|指定|チェック)して(ください|下さい)|ご(入力|記入|選択)(ください|下さい)|必須項目|未入力|未記入|未選択|(入力|選択|記入)されていません|(入力|選択)が必須|は必須です|必須入力|正しく(入力|ありません)|形式が|不正|以外の文字|エラーが|エラーです|入力に(エラー|誤り|不備)|入力漏れ|error(s)? (occurred|found)|is required|invalid|入力内容に誤り|確認して(ください|下さい))/i;
// サイトの側で受け付けを断られたときの文言。入力を直しても通らないので、入力エラーとは分けて扱う。
//   ・Contact Form 7 の「メッセージの送信に失敗しました」（スパム判定・メールサーバーの不調）
//   ・「スパム送信の可能性があります」、403 Forbidden、PHP の Fatal error、前の画面の内容が引き継がれない（Please fill out the form on the previous page）
const REJECT_RE = /(メッセージの送信に失敗しました|送信に失敗しました|送信できませんでした|スパム(送信|メール|と判定|の可能性)|spam|403\s*Forbidden|Access\s*Denied|アクセスが拒否|不正な(アクセス|送信|リクエスト|操作)|Fatal error|Internal Server Error|Please fill out the form on the previous page|セッション(が|の)?(切れ|タイムアウト|有効期限|無効)|時間をおいて(から)?(再度|もう一度)|しばらく(たって|経って)から)/i;
/** 文字列の中に、ある言葉が何回出てくるか（送信の前後で増えたかを見るのに使う） */
const countOf = (hay: string, needle: string) => (needle ? hay.split(needle).length - 1 : 0);

export type Outcome = { status: "sent" | "failed" | "unsure"; detail: string };

/** 送信ボタン（「送信」「この内容で」等の名前の button / input）がまだ画面に見えているか。確認画面かどうかの手がかり */
async function submitButtonRemains(target: Page | Frame): Promise<boolean> {
  return target.evaluate(([submitSrc, backSrc, notSrc]) => {
    const submitRe = new RegExp(submitSrc, "i"), backRe = new RegExp(backSrc, "i"), notRe = new RegExp(notSrc, "i");
    return Array.from(document.querySelectorAll("button, input[type=submit], input[type=image], input[type=button]")).some((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      const t = ((el as HTMLElement).innerText || (el as HTMLInputElement).value || el.getAttribute("alt") || "").trim();
      return !!t && submitRe.test(t) && !backRe.test(t) && !notRe.test(t);
    });
  }, [SUBMIT_RE.source, BACK_RE.source, NOT_SUBMIT_RE.source] as [string, string, string]).catch(() => false);
}

/** フレームの中でスクリプトを実行する。一定時間で返らなければ undefined。
 *  about:blank の隠しフレーム等では evaluate が返ってこないことがあり（実測）、送信処理ごと止まっていたため。 */
export async function evalFrame<T>(fr: Frame, fn: () => T, ms = 3000): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fr.evaluate(fn) as Promise<T>,
      new Promise<undefined>((res) => { timer = setTimeout(() => res(undefined), ms); }),
    ]);
  } catch {
    return undefined; // cross-origin 等
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function pageText(page: Page): Promise<string> {
  const texts: string[] = [];
  for (const fr of page.frames()) {
    const t = await evalFrame(fr, () => document.body?.innerText ?? "");
    if (t) texts.push(t);
  }
  return texts.join("\n");
}

/** target: フォームがあるフレーム（iframe の埋め込みフォームなら、そのフレーム）。入力欄の数とエラー表示はここで見る。
 *  親ページだけを見ると、iframe の送信が止まっていても「入力欄が無い＝フォームが消えた」で送信済みにしていた */
export async function judgeOutcome(page: Page, hadFieldsBefore: number, afterSubmit = true, beforeText = "", beforeUrl = "", target?: Page | Frame): Promise<Outcome> {
  const where: Page | Frame = target ?? page;
  // 本体＋埋め込みフレームの文章をまとめて見る（完了文言が iframe の中に出ることがある）
  const text = await pageText(page);
  const compact = text.replace(/\s+/g, "");
  const url = page.url();
  const beforeCompact = beforeText.replace(/\s+/g, "");
  // 送信前より増えた完了文言だけを見る。以前は「送信前のページに完了っぽい文言が1つでもあれば、完了ページの文言も一切見ない」としていて、
  // 入力ページに「送信後、確認メールをお送りします」があると完了ページを見落とし、完了ページの「届かない場合は再度ご入力ください」を
  // 入力エラーと読んで戻って送り直していた（二重送信）
  const successRe = new RegExp(SUCCESS_RE.source, "gi");
  const hits = new Set<string>();
  for (const src of [compact, text.replace(/\s+/g, " ")]) for (const m of src.matchAll(successRe)) hits.add(m[0].replace(/\s+/g, ""));
  const freshHits = [...hits].filter((h) => !beforeCompact || countOf(compact, h) > countOf(beforeCompact, h));
  if (freshHits.length) {
    // 確認画面らしさ: 送信前に無かった確認画面の文言、または送信ボタンが残っている
    const confirmFresh = (() => { const m = CONFIRM_PAGE_RE.exec(compact); return !!m && countOf(compact, m[0]) > countOf(beforeCompact, m[0]); })();
    const strong = freshHits.filter((h) => !WEAK_SUCCESS_RE.test(h));
    // 強い文言（「送信が完了しました」等）でも、確認画面の文言と送信ボタンが両方あるなら「送信完了後に…」の予告文
    // 弱い文言（「確認メールをお送りします」等）は、確認画面の文言か送信ボタンのどちらかがあれば採用しない
    const btnLeft = await submitButtonRemains(where);
    if (strong.length && !(confirmFresh && btnLeft)) return { status: "sent", detail: "完了文言を検知" };
    if (!strong.length && !confirmFresh && !btnLeft) return { status: "sent", detail: "完了文言を検知" };
  }
  // 完了URL: 送信前のURLがすでに当てはまる（/customer-success/contact/ 等）なら使わない。パスが変わったときだけ採用する
  const pathOf = (u: string) => { try { return new URL(u).pathname; } catch { return ""; } };
  if (SUCCESS_URL_RE.test(pathOf(url)) && (!beforeUrl || (pathOf(url) !== pathOf(beforeUrl) && !SUCCESS_URL_RE.test(pathOf(beforeUrl))))) return { status: "sent", detail: `完了URLへ遷移 (${url})` };
  // 送信前には無かった文言かどうか。以前は「送信前の本文に同じ言葉が含まれていれば無視」としていたが、
  // 「入力してください」のような短い言葉は注意書きとして最初から載っていることが多く、新しく出たエラーまで捨てていた
  // （jhn.co.jp の実例: 電話番号の下に赤字で「入力してください。」が出ているのに判定不能）。回数が増えたかで見る
  const isFresh = (phrase: string) => { const k = phrase.replace(/\s+/g, ""); return !beforeCompact || countOf(compact, k) > countOf(beforeCompact, k); };
  // サイトの側で受け付けを断られた（入力を直しても通らない）
  const rj = REJECT_RE.exec(text.slice(0, 6000));
  if (rj && isFresh(rj[0])) {
    const line = (text.split("\n").find((l) => l.includes(rj[0])) ?? rj[0]).replace(/\s+/g, " ").trim().slice(0, 70);
    return { status: "failed", detail: `サイト側で受け付けられませんでした: ${line}` };
  }
  // 実際にフォーム上に赤字で出ているバリデーションメッセージだけを拾う。
  // ページ本文の無関係なテキスト（「License is GPL」など）を拾わないよう、
  //   ・エラー用のマークアップ（error/invalid クラス、role=alert、aria-invalid、wpcf7 のタグ）
  //   ・または赤系の文字色で表示されている短いテキスト
  // に限定し、さらに「入力してください」等のバリデーション文言に一致するものだけを採用する。
  const visibleErrors: string[] = await where.evaluate((rxSrc) => {
    const rx = new RegExp(rxSrc, "i");
    const seen = new Set<string>();
    const out: string[] = [];
    const isRed = (el: Element) => {
      const c = getComputedStyle(el as HTMLElement).color.match(/\d+/g);
      if (!c) return false;
      const [r, g, b] = c.map(Number);
      return r > 120 && g < 110 && b < 110; // 赤〜オレンジ系
    };
    const cand = new Set<Element>();
    document.querySelectorAll("[class*='error'],[class*='invalid'],[class*='err'],[id*='error'],[role='alert'],[aria-live],.wpcf7-not-valid-tip,.wpcf7-response-output,.form-error,.field-error,.help-block,.text-danger,.attention,.caution").forEach((e) => cand.add(e));
    document.querySelectorAll("[aria-invalid='true']").forEach((f) => { const id = f.getAttribute("aria-describedby"); if (id) id.split(/\s+/).forEach((x) => { const e = document.getElementById(x); if (e) cand.add(e); }); });
    // 赤字で表示されている短いテキスト要素も候補にする
    document.querySelectorAll("span,p,div,dd,dt,li,strong,em,label,font,b,small,td,th").forEach((e) => { const t = (e as HTMLElement).innerText?.trim() || ""; if (t && t.length <= 60 && rx.test(t) && isRed(e)) cand.add(e); });
    for (const el of cand) {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      const t = ((el as HTMLElement).innerText || "").trim().replace(/\s+/g, " ");
      if (!t || t.length > 80 || !rx.test(t)) continue;
      if (seen.has(t)) continue;
      seen.add(t); out.push(t);
    }
    return out.slice(0, 6);
  }, ERROR_RE.source).catch(() => [] as string[]);
  // 送信前から出ていた文言（フォームの注意書き）は除く
  const freshErrors = visibleErrors.filter(isFresh);
  if (freshErrors.length) {
    return { status: "failed", detail: `入力エラー: ${freshErrors.join(" / ")}` };
  }
  // 赤字要素として拾えなかった場合の保険: 「◯◯を入力してください」等の強いバリデーション文言だけを、
  // 送信前に無かったものに限って本文から拾う（ページ説明文や無関係な文章は拾わない）
  // 色も class も付かない、サーバーが返す素のエラーページ（「【電話番号】は必須項目です。」「【電話番号】が入力されていません。」）も拾う
  const STRONG = /([^。\n]{0,20}(を|が)?(入力|記入|選択|指定)(して)?(ください|下さい)|[^。\n]{0,16}は必須(項目)?です|[^。\n]{0,16}(が|は)?未入力|[^。\n]{0,16}(が|は)(入力|選択|記入)されていません|[^。\n]{0,16}を正しく|[^。\n]{0,16}の形式が正しくありません|[^。\n]{0,20}以外の文字が入力されています)/g;
  for (let sm = STRONG.exec(text); sm; sm = STRONG.exec(text)) {
    const phrase = sm[0].replace(/\s+/g, " ").trim().slice(0, 60);
    if (isFresh(phrase)) return { status: "failed", detail: `入力エラー: ${phrase}` };
  }
  // どの欄かは書かれていないが、エラーだとは言っている
  const generic = /入力(内容)?に(エラー|誤り|不備)があります/.exec(text);
  if (generic && isFresh(generic[0])) return { status: "failed", detail: `入力エラー: ${generic[0]}` };
  if (afterSubmit && CONFIRM_MODAL_RE.test(compact) && !CONFIRM_MODAL_RE.test(beforeCompact)) {
    return { status: "unsure", detail: "確認画面（ポップアップ）で止まっている" };
  }
  // フォームのあるフレームで数える。iframe ごと外された（親ページが移った等）ときは0。
  // それ以外で数えられない（ページが移り続けている等）ときは「入力欄が無い＝送信済み」とはみなさず、呼び出し側に例外を返す
  const fieldsNow = (await collectFields(where).catch((e) => { if (where !== page && (where as Frame).isDetached()) return [] as FieldInfo[]; throw e; })).length;
  // 入力欄が無くなっても、確認画面（「下記の内容で送信します」等）なら送信済みではない。呼び出し側でもう一度送信ボタンを押す
  if (afterSubmit && hadFieldsBefore > 0 && fieldsNow === 0 && CONFIRM_PAGE_RE.test(compact) && !CONFIRM_PAGE_RE.test(beforeCompact)) {
    return { status: "unsure", detail: "確認画面で止まっている" };
  }
  if (afterSubmit && hadFieldsBefore > 0 && fieldsNow === 0) return { status: "sent", detail: "フォームが消えた（完了文言なし・要確認）" };
  // 送信ボタンを押したあと別のページに移り、入力欄がほとんど無くなっていれば送信できたとみなす（#7）。
  // 完了文言が画像だったり、独自の言い回し（「受け付けいたしました」以外）だったりするサイトで、
  // これまでは「送信後の判定不能」になり、人が手で送り直して二重送信になっていた
  if (afterSubmit && beforeUrl && hadFieldsBefore > 0 && fieldsNow > 0 && fieldsNow <= Math.max(1, Math.floor(hadFieldsBefore / 3))) {
    const changed = (() => { try { const a = new URL(beforeUrl), b = new URL(url); return a.pathname !== b.pathname || a.search !== b.search; } catch { return beforeUrl !== url; } })();
    if (changed && !CONFIRM_PAGE_RE.test(compact)) return { status: "sent", detail: `別のページに切り替わり入力欄が無くなった（完了文言なし・要確認）: ${url}` };
  }
  // 同じページのまま入力内容が全部消えて「ありがとうございました。」だけが出るフォーム（ページ遷移も完了文言の定型もない）。
  // 以前は「判定不能→失敗」になり、利用者が手動で送り直して二重送信になっていた。
  // 送信前より「ありがとうございま」が増えた（ヘッダーの「ご興味をお持ちいただき、ありがとうございます」等は送信前から在るので数に入らない）
  // かつ、入力していた文字欄・本文欄が全て空になった場合だけ送信済みとみなす
  if (afterSubmit && hadFieldsBefore > 0) {
    const thanks = (s: string) => (s.match(/ありがとうございま|有難うございま|有り難うございま/g) || []).length;
    if (thanks(compact) > thanks(beforeCompact)) {
      let filled = 0;
      for (const fr of page.frames()) {
        const n = await evalFrame(fr, () => Array.from(document.querySelectorAll("textarea, input[type=text], input[type=email], input[type=tel], input:not([type])"))
          .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && ((e as HTMLInputElement).value || "").trim() !== ""; }).length);
        filled += n ?? 0;
      }
      if (filled === 0) return { status: "sent", detail: "入力内容が消えてお礼の文言が出た（同じページで完了表示）" };
    }
  }
  return { status: "unsure", detail: "完了もエラーも検知できず" };
}
