// 文字列を Shift_JIS（Windows の日本語の文字コード）のバイト列にする。配布する .bat の変換に使う。
// npm の部品を足さないため、Node に入っている Shift_JIS の読み取り（TextDecoder）から逆引きの表を作る。
const decoder = new TextDecoder("shift_jis", { fatal: true });
let table = null;

function buildTable() {
  const map = new Map();
  const put = (bytes) => {
    let ch;
    try { ch = decoder.decode(Uint8Array.from(bytes)); } catch { return; }
    if ([...ch].length === 1 && !map.has(ch)) map.set(ch, bytes);
  };
  for (let b = 0xa1; b <= 0xdf; b++) put([b]); // 半角カナ
  for (let lead = 0x81; lead <= 0xfc; lead++) {
    if (lead > 0x9f && lead < 0xe0) continue;
    for (let trail = 0x40; trail <= 0xfc; trail++) if (trail !== 0x7f) put([lead, trail]);
  }
  // 0x8160 は、読み方によって波ダッシュ（〜）とも全角チルダ（～）とも読まれる。どちらで書いても同じ「波線」になるようにする
  if (map.has("〜") && !map.has("～")) map.set("～", map.get("〜"));
  if (map.has("～") && !map.has("〜")) map.set("〜", map.get("～"));
  return map;
}

/** Shift_JIS に無い文字があれば、行と文字を示して例外にする（化けたまま配らないため） */
export function encodeSjis(text) {
  table ??= buildTable();
  const out = [];
  let line = 1;
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (ch === "\n") line++;
    if (code < 0x80) { out.push(code); continue; }
    const bytes = table.get(ch);
    if (!bytes) throw new Error(`Shift_JIS にできない文字があります: ${line}行目「${ch}」(U+${code.toString(16).toUpperCase()})`);
    out.push(...bytes);
  }
  return Buffer.from(out);
}

export function decodeSjis(buf) {
  return decoder.decode(buf);
}
