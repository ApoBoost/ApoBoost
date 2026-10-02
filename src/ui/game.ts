// おまけのゲーム
import { STATUS_LABEL, OUTCOME_LABEL, CHANNEL_LABEL, channelMode, jst, type Campaign, type Job, type SenderProfile, type JobStatus } from "../db.js";
import { AI_MODELS, type Lint } from "../message.js";
import { TEMPLATE_LIBRARY } from "../templates.js";
import { esc, layout, n, type NavUser } from "./layout.js";

export function gameView(sentCount: number): string {
  return `<h1>🎰 アポスロット <span class="tag">おまけ</span></h1>
<p class="muted">フォーム送信が進むほどクレジットが貯まります（1送信=1枚・3枚で1回転）。仮想コインだけで、課金や実送信は一切ありません。ネオアイムジャグラーEX の配列・制御を再現した非公式ミニゲームです。</p>
<div id="cab">
  <img class="bg" src="/assets/game/cabinet.jpg" alt="" draggable="false">
  <div class="win">
    <div class="reel" id="r0"><div class="strip"></div></div>
    <div class="reel" id="r1"><div class="strip"></div></div>
    <div class="reel" id="r2"><div class="strip"></div></div>
    <div class="payline pl0"></div><div class="payline pl1"></div><div class="payline pl2"></div>
  </div>
  <div class="lamp" id="lamp"><img src="/assets/game/gogo.jpg" alt="GOGO!" draggable="false"></div>
  <div class="seg" id="credit" style="left:calc(322px*var(--s));width:calc(90px*var(--s))">0</div>
  <div class="seg" id="count" style="left:calc(432px*var(--s));width:calc(100px*var(--s))">0</div>
  <div class="seg" id="win" style="left:calc(552px*var(--s));width:calc(90px*var(--s))">0</div>
  <div class="betlamp" id="bl3" style="top:calc(476px*var(--s))"></div>
  <div class="betlamp" id="bl2" style="top:calc(542px*var(--s))"></div>
  <div class="betlamp" id="bl1" style="top:calc(607px*var(--s))"></div>
  <div class="replamp" id="replamp"></div>
  <button class="lever" id="lever" disabled title="レバー"></button>
  <button class="stopbtn" data-i="0" style="left:calc(339px*var(--s))" disabled></button>
  <button class="stopbtn" data-i="1" style="left:calc(444px*var(--s))" disabled></button>
  <button class="stopbtn" data-i="2" style="left:calc(546px*var(--s))" disabled></button>
</div>
<div class="gmsg" id="msg">…</div>
<div class="gctl"><button class="btn small" id="sync">送信数を反映</button> <span class="muted small">送信 <b id="sent">${sentCount}</b>件</span></div>
<div class="rules muted small" style="max-width:640px;margin:8px auto 0">
・BET 3枚／回・5ライン（上・中・下・斜め2本）・レバー＝左の黒いノブ、停止＝緑の3ボタン<br>
・<b>BIG</b> 7・7・7（純増+252）／<b>REG</b> 7・7・BAR または BAR・BAR・BAR（純増+96）<br>
・ブドウ×3=+8　・ベル×3=+10（要目押し）　・ピエロ×3=+10（要目押し）　・左リール🍒=角+2/中+1　・リプレイ×3=次回転BET不要<br>
・図柄は押した位置から<b>最大4コマ</b>まで滑って引き込む。成立していない役は揃わない。<br>
・<b>GOGO!ランプが光ったら（ぺかったら）7を目押し</b>で狙う。枠内に<b>BARと7が並んだらリーチ目</b>（ボーナス濃厚）。
</div>
<style>
#cab{position:relative;width:min(700px,100%);margin:0 auto;aspect-ratio:967/1627;user-select:none;--s:0.724}
#cab .bg{position:absolute;inset:0;width:100%;height:100%;display:block;border-radius:10px}
#cab .win{position:absolute;left:calc(183px*var(--s));top:calc(479px*var(--s));width:calc(607px*var(--s));height:calc(212px*var(--s));display:flex;gap:calc(10px*var(--s));background:#111;border-radius:calc(6px*var(--s));overflow:hidden}
#cab .reel{position:relative;flex:1;height:100%;overflow:hidden;background:#ffffff}
#cab .reel .strip{will-change:transform}
#cab .reel .cell{height:calc(70.67px*var(--s));display:flex;align-items:center;justify-content:center;font-size:calc(54px*var(--s));font-weight:900;line-height:1;color:#222}
#cab .reel .cell img{height:calc(62px*var(--s));width:auto;max-width:calc(180px*var(--s));object-fit:contain}
#cab .reel .cell img.s7{height:calc(70px*var(--s));width:auto;max-width:calc(140px*var(--s));object-fit:contain}
#cab .reel .cell img.sq{height:calc(70px*var(--s));width:auto;max-width:calc(74px*var(--s));object-fit:contain}
#cab .reel .cell img.bar{height:calc(58px*var(--s));width:auto;max-width:calc(165px*var(--s));object-fit:contain}
#cab .reel .cell img.bell{height:calc(50px*var(--s));width:auto;max-width:calc(96px*var(--s));object-fit:contain}
#cab .reel .cell .sbar{font-size:calc(22px*var(--s));letter-spacing:1px;background:#1c1c1c;color:#ff4a4a;padding:calc(6px*var(--s)) calc(12px*var(--s));border-radius:5px;font-weight:900}
#cab .reel.spinning .strip{filter:blur(1px)}
#cab .win .payline{position:absolute;left:0;right:0;height:calc(2px*var(--s));background:rgba(255,80,80,.0);pointer-events:none}
#cab .win .payline.pl0{top:calc(35px*var(--s))}#cab .win .payline.pl1{top:calc(106px*var(--s))}#cab .win .payline.pl2{top:calc(177px*var(--s))}
#cab .win.flash .payline{background:rgba(255,80,80,.85);box-shadow:0 0 calc(8px*var(--s)) #ff5050}
#cab .lamp{position:absolute;left:calc(84px*var(--s));top:calc(700px*var(--s));width:calc(156px*var(--s));height:calc(102px*var(--s));border-radius:calc(10px*var(--s));overflow:hidden;background:#000;border:calc(2px*var(--s)) solid #2a2a2a;transition:box-shadow .2s}
#cab .lamp img{width:100%;height:100%;object-fit:contain;filter:brightness(.16) saturate(.5) grayscale(.6);transition:filter .15s}
#cab .lamp.on{border-color:#ff5ce0;box-shadow:0 0 calc(22px*var(--s)) #ff5ce0,0 0 calc(50px*var(--s)) #6a5cff}
#cab .lamp.on img{filter:brightness(1.15) saturate(1.3);animation:lampflk .22s steps(2) infinite}
@keyframes lampflk{50%{filter:brightness(.65) saturate(1.2)}}
#cab .seg{position:absolute;top:calc(716px*var(--s));height:calc(46px*var(--s));background:#0b0b0d;border:calc(2px*var(--s)) solid #2b2b2b;border-radius:calc(6px*var(--s));display:flex;align-items:center;justify-content:center;font-family:"Menlo","Courier New",monospace;font-size:calc(30px*var(--s));color:#ff3b3b;text-shadow:0 0 calc(8px*var(--s)) #ff3b3b;font-variant-numeric:tabular-nums}
#cab .betlamp{position:absolute;left:calc(103px*var(--s));width:calc(46px*var(--s));height:calc(46px*var(--s));border-radius:50%;pointer-events:none;box-shadow:none;transition:box-shadow .15s}
#cab .betlamp.on{box-shadow:0 0 calc(18px*var(--s)) calc(6px*var(--s)) rgba(255,230,80,.85)}
#cab .replamp{position:absolute;left:calc(818px*var(--s));top:calc(536px*var(--s));width:calc(92px*var(--s));height:calc(36px*var(--s));border-radius:8px;pointer-events:none}
#cab .replamp.on{box-shadow:0 0 calc(16px*var(--s)) calc(4px*var(--s)) rgba(80,200,255,.9)}
#cab .lever{position:absolute;left:calc(201px*var(--s));top:calc(870px*var(--s));width:calc(70px*var(--s));height:calc(70px*var(--s));border-radius:50%;border:0;background:transparent;cursor:pointer;transition:transform .08s,box-shadow .15s}
#cab .lever:not(:disabled){box-shadow:0 0 calc(14px*var(--s)) calc(4px*var(--s)) rgba(255,255,140,.75);animation:leverpulse 1.2s ease-in-out infinite}
@keyframes leverpulse{50%{box-shadow:0 0 calc(6px*var(--s)) calc(2px*var(--s)) rgba(255,255,140,.4)}}
#cab .lever:active{transform:scale(.92)}
#cab .lever:disabled{cursor:default;background:rgba(0,0,0,.35);animation:none}
#cab .stopbtn{position:absolute;top:calc(864px*var(--s));width:calc(62px*var(--s));height:calc(62px*var(--s));border-radius:50%;border:0;background:transparent;cursor:pointer;transition:transform .08s,box-shadow .15s}
#cab .stopbtn:not(:disabled){box-shadow:0 0 calc(16px*var(--s)) calc(5px*var(--s)) rgba(90,255,120,.85)}
#cab .stopbtn:active{transform:scale(.9)}
#cab .stopbtn:disabled{cursor:default;background:rgba(0,0,0,.45)}
.gmsg{margin:10px 0 6px;text-align:center;font-weight:800;font-size:16px;min-height:22px;color:#1C1710}
.gmsg.eye{color:#c81e6e}.gmsg.big{color:#e11d48}
.gctl{text-align:center}
.rules .ico{width:18px;height:18px;vertical-align:-3px}
</style>
<script>
(() => {
  const cab = document.getElementById("cab");
  const setScale = () => cab.style.setProperty("--s", (cab.clientWidth / 967).toFixed(4));
  setScale(); addEventListener("resize", setScale);
  const N = 21, CELL = 70.67;

  // ===== リール配列（各21コマ, index0=コマ1）: 7/A(BAR)/G(ブドウ)/C(チェリー)/L(ベル)/P(ピエロ)/R(リプレイ) =====
  const REELS = [
    ["G","R","G","A","C","G","R","G","P","7","G","R","G","C","A","G","R","G","R","7","L"],
    ["P","C","G","A","R","C","G","L","R","C","G","A","R","C","G","L","R","C","G","7","R"],
    ["R","L","P","G","R","L","P","G","R","L","P","G","R","L","P","G","R","L","A","7","G"]
  ];
  const symAt = (reel, koma) => REELS[reel][((koma - 1) % N + N) % N];
  const winAt = (reel, pos) => [symAt(reel, pos), symAt(reel, pos - 1), symAt(reel, pos - 2)]; // [上,中,下]

  // ===== 役・ライン・配当 =====
  const LINES = { "上段":[0,0,0], "中段":[1,1,1], "下段":[2,2,2], "右下がり":[0,1,2], "右上がり":[2,1,0] };
  const PAY = { GR:8, BE:10, PI:10, CH:1, MC:1, RE:0, BIG:0, REG:0 };
  const PRIORITY = ["RE","GR","MC","BIG","REG","CH","BE","PI"];
  function evalWindow(a, b, c) {
    const wa = winAt(0,a), wb = winAt(1,b), wc = winAt(2,c), out = [];
    for (const name in LINES) {
      const ln = LINES[name], L = wa[ln[0]], M = wb[ln[1]], R = wc[ln[2]];
      if (L === "C") out.push([name === "中段" ? "MC" : "CH", name]);
      else if (L === "7" && M === "7" && R === "7") out.push(["BIG", name]);
      else if (L === "7" && M === "7" && R === "A") out.push(["REG", name]); // REGは7・7・BARのみ（BAR3つはボーナスにしない）
      else if (L === M && M === R && L === "G") out.push(["GR", name]);
      else if (L === M && M === R && L === "L") out.push(["BE", name]);
      else if (L === M && M === R && L === "P") out.push(["PI", name]);
      else if (L === M && M === R && L === "R") out.push(["RE", name]);
    }
    return out;
  }

  // ===== 逐次リール制御（最大4コマ・蹴飛ばし・先読み） =====
  const MAX_SLIP = 4;
  function makeSpin(allowed) {
    const set = {}; allowed.forEach((r) => set[r] = true);
    const goals = PRIORITY.filter((r) => set[r]);
    const stopped = [null, null, null], slip = [null, null, null];
    const legalFull = (a, b, c) => evalWindow(a, b, c).every((e) => set[e[0]]);
    function exists(fixed, pred) {
      const rem = [0,1,2].filter((i) => fixed[i] == null), pos = fixed.slice();
      const rec = (k) => {
        if (k === rem.length) return legalFull(pos[0], pos[1], pos[2]) && pred(pos);
        for (let q = 1; q <= N; q++) { pos[rem[k]] = q; if (rec(k + 1)) return true; }
        pos[rem[k]] = null; return false;
      };
      return rec(0);
    }
    function stop(reel, press) {
      let best = null;
      for (let s = 0; s <= MAX_SLIP; s++) {
        const q = ((press - 1 + s) % N) + 1, fixed = stopped.slice(); fixed[reel] = q;
        const feas = exists(fixed, () => true) ? 1 : 0;
        const rc = goals.map((g) => exists(fixed, (f) => evalWindow(f[0], f[1], f[2]).some((e) => e[0] === g)) ? 1 : 0);
        const score = [feas].concat(rc).concat([-s]);
        if (best === null || cmpArr(score, best.score) > 0) best = { score: score, q: q, s: s };
      }
      stopped[reel] = best.q; slip[reel] = best.s; return best.q;
    }
    return { stop: stop, stopped: stopped, slip: slip, result: () => ({ final: stopped.slice(), formed: evalWindow(stopped[0], stopped[1], stopped[2]) }) };
  }
  function cmpArr(x, y) { for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1; return 0; }

  // ===== 設定6 内部抽選（65536分母） =====
  const LOT = [["BIG",171],["CH_BIG",84],["MID_BIG",2],["REG",180],["CH_REG",77],["GRAPE",11338],["CHERRY",1840],["PIERROT",60],["BELL",60],["REPLAY",8980]];
  const FLAG = { BIG:["BIG"], CH_BIG:["CH","BIG"], MID_BIG:["MC","BIG"], REG:["REG"], CH_REG:["CH","REG"], GRAPE:["GR"], CHERRY:["CH"], PIERROT:["PI"], BELL:["BE"], REPLAY:["RE"], HAZURE:[] };
  function drawFlag() {
    let r = Math.floor(Math.random() * 65536), acc = 0;
    for (const [k, n] of LOT) { acc += n; if (r < acc) return k; }
    return "HAZURE";
  }

  // ===== 図柄描画（画像・無ければ絵文字） =====
  function draw(code) {
    if (code === "7") return '<img class="s7" src="/assets/game/seven.png" alt="7" data-fb="7" onerror="sfb(this)" draggable="false">';
    if (code === "A") return '<img class="bar" src="/assets/game/bar.png" alt="BAR" data-fb="BAR" onerror="sfb(this)" draggable="false">';
    if (code === "L") return '<img class="bell" src="/assets/game/bell.png" alt="ベル" data-fb="🔔" onerror="sfb(this)" draggable="false">';
    if (code === "P") return '<img src="/assets/game/pierrot.png" alt="ピエロ" data-fb="🤡" onerror="sfb(this)" draggable="false">';
    if (code === "G") return '<img class="sq" src="/assets/game/batta.png" alt="ブドウ" draggable="false">'; // ブドウ図柄は従来どおり batta.png（四角図柄は大きめ表示）
    if (code === "C") return "🍒"; return '<img class="sq" src="/assets/game/hatch.png" alt="リプレイ" draggable="false">'; // R=リプレイ（従来の蜂図柄）
  }
  window.sfb = function (img) { const fb = img.getAttribute("data-fb"); const sp = document.createElement("span"); sp.className = fb === "BAR" ? "sbar" : "fb"; sp.textContent = fb; img.replaceWith(sp); };

  // ===== クレジット =====
  const KEY = "aposlot-nij1";
  const sent = ${Number(sentCount) || 0};
  let st = {}; try { st = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch {}
  let credit = Number(st.credit) || 0, synced = Number(st.synced) || 0, games = Number(st.games) || 0, freeSpin = false;
  const FREE_PLAY = true; // テスト中: クレジット無限（本番に戻すときは false）
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ credit: credit, synced: synced, games: games })); } catch {} };
  const syncSends = () => { if (sent > synced) { const d = sent - synced; credit += d; synced = sent; save(); return d; } return 0; };

  const $ = (id) => document.getElementById(id);
  const reels = [0,1,2].map((i) => $("r" + i));
  const strips = reels.map((r) => r.querySelector(".strip"));
  const stopBtns = [].slice.call(document.querySelectorAll(".stopbtn"));

  // ===== 音（Web Audio・先頭無音カット） =====
  const AC = window.AudioContext || window.webkitAudioContext;
  const actx = AC ? new AC() : null, bufs = {};
  async function loadSnd(name, url) {
    if (!actx) return;
    try { const buf = await actx.decodeAudioData(await (await fetch(url)).arrayBuffer());
      const ch = buf.getChannelData(0); let i = 0; while (i < ch.length && Math.abs(ch[i]) < 0.02) i++;
      bufs[name] = { buf: buf, off: Math.max(0, i / buf.sampleRate - 0.005) };
    } catch (e) {}
  }
  function play(name) { const b = bufs[name]; if (!actx || !b) return; if (actx.state === "suspended") actx.resume();
    const src = actx.createBufferSource(); src.buffer = b.buf; src.connect(actx.destination); src.start(0, b.off); }
  ["spin","stop","bonus","bgm","grape","replay","tenpai","cherry"].forEach((n) => loadSnd(n, "/assets/game/" + n + ".mp3"));
  let loopSrc = null;
  function stopLoop() { if (loopSrc) { try { loopSrc.stop(); } catch (e) {} loopSrc = null; } }
  document.addEventListener("pointerdown", () => { if (actx && actx.state === "suspended") actx.resume(); }, { once: true });

  // ===== リール描画（下ほどコマ番号が小さい＝上→下に流れる） =====
  const s = () => parseFloat(getComputedStyle(cab).getPropertyValue("--s")) || 0.724;
  const topK = [21, 14, 7];        // 各リールの現在の上段コマ番号（float）
  const spinning = [false,false,false], targetK = [null,null,null];
  function buildStrip(i) { let h = ""; for (let j = 0; j < N * 2; j++) { const koma = N - (j % N); h += '<div class="cell">' + draw(symAt(i, koma)) + "</div>"; } strips[i].innerHTML = h; }
  function render(i) { const f = ((topK[i] % N) + N) % N; const off = ((N - f) % N) * CELL * s(); strips[i].style.transform = "translateY(" + (-off) + "px)"; }
  [0,1,2].forEach((i) => { buildStrip(i); render(i); });
  let last = 0;
  function loop(t) {
    const dt = Math.min(40, t - last) / 1000; last = t;
    for (let i = 0; i < 3; i++) {
      if (!spinning[i]) continue;
      if (targetK[i] === null) { topK[i] += (24 + i * 2) * dt; }         // 自由回転（上→下, 目押しと滑りの見え方のバランス）
      else {
        const goal = targetK[i]; let cur = topK[i];
        const dist = ((goal - cur) % N + N) % N;                        // 下方向に進んで目標へ
        const step = Math.max(16, dist * 24) * dt;                      // キビキビ止める（引き込みを素早く）
        if (dist <= step || dist < 0.02) { topK[i] = goal; spinning[i] = false; reels[i].classList.remove("spinning"); render(i); onStopped(); continue; }
        topK[i] = cur + step;
      }
      topK[i] = ((topK[i] % N) + N) % N; if (topK[i] === 0) topK[i] = N;
      render(i);
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // ===== 進行 =====
  let spin = null, pending = null, lampOn = false, lastWin = 0;
  const say = (m, cls) => { const el = $("msg"); el.textContent = m; el.className = "gmsg" + (cls ? " " + cls : ""); };
  const betLamps = (on) => ["bl1","bl2","bl3"].forEach((id) => $(id).classList.toggle("on", on));
  function paint() {
    $("credit").textContent = FREE_PLAY ? "∞" : credit; $("count").textContent = games; $("win").textContent = lastWin; $("sent").textContent = sent;
    $("lever").disabled = spinning.some(Boolean) || (!FREE_PLAY && !freeSpin && credit < 3);
    $("replamp").classList.toggle("on", freeSpin);
    $("lamp").classList.toggle("on", lampOn);
  }
  $("sync").onclick = () => { const d = syncSends(); paint(); say(d > 0 ? "送信 " + d + " 件ぶんのクレジットを追加しました" : "新しい送信はありません（送信すると1件=1枚貯まります）"); };
  const first = syncSends(); paint();
  say(FREE_PLAY ? "テストモード: 無限に回せます。レバー（左の黒いノブ）で回そう！" : "レバー（左の黒いノブ）で回そう！");

  $("lever").onclick = () => {
    if (spinning.some(Boolean)) return;
    if (!FREE_PLAY && !freeSpin) { if (credit < 3) { say("クレジット不足。フォーム送信3件で1回転です"); return; } credit -= 3; }
    stopLoop(); freeSpin = false; lastWin = 0; games++; save(); betLamps(true);
    $("cab").querySelector(".win").classList.remove("flash");

    // 内部抽選（持ち越し中はボーナス抽選しない）
    let flag = drawFlag(); let roles = FLAG[flag].slice();
    let cherryPeka = false;
    if (pending) { roles = roles.filter((r) => r !== "BIG" && r !== "REG"); if (roles.length === 1 && roles[0] === "MC") roles = ["CH"]; }
    // チェリー重複・中段チェリーはボーナス確定＝ペカリ確定（先ペカ）。単独ボーナスは25%で先告知
    else if (flag === "BIG" || flag === "CH_BIG" || flag === "MID_BIG") { pending = "BIG"; cherryPeka = (flag === "CH_BIG" || flag === "MID_BIG"); lampOn = cherryPeka || Math.random() < 0.25; }
    else if (flag === "REG" || flag === "CH_REG") { pending = "REG"; cherryPeka = (flag === "CH_REG"); lampOn = cherryPeka || Math.random() < 0.25; }
    const allowed = roles.concat(pending ? [pending] : []);
    spin = makeSpin(allowed);

    paint();
    if (lampOn && cherryPeka) say("🍒✨ チェリー重複！ ペカリ確定！ 7を目押しで狙え", "big");
    else if (lampOn) say("✨ GOGO!ランプ点灯！ 7を目押しで狙え（左は7を上段、中・右は7を中段あたり）", "big");
    else if (pending) say("… なにか引いたかも？ 緑ボタンで止めよう");
    else say("緑のボタンで止めよう");
    play("spin");
    for (let i = 0; i < 3; i++) { targetK[i] = null; spinning[i] = true; reels[i].classList.add("spinning"); }
    stopBtns.forEach((b) => (b.disabled = false));
    $("lever").disabled = true;
  };

  stopBtns.forEach((btn) => btn.onclick = () => {
    const i = Number(btn.dataset.i);
    if (!spinning[i] || targetK[i] !== null) return;
    btn.disabled = true; play("stop");
    const press = ((Math.round(topK[i]) - 1) % N + N) % N + 1; // 押した瞬間の上段コマ
    targetK[i] = spin.stop(i, press);
  });

  function onStopped() {
    const done = [0,1,2].every((i) => !spinning[i] && targetK[i] !== null);
    // 7テンパイ音: 止まった2リールが「同じ有効ライン上で」ともに7のときだけ（残り1リールで777が狙える形）
    const stoppedIdx = [0,1,2].filter((i) => !spinning[i] && targetK[i] !== null);
    if (!done && stoppedIdx.length === 2) {
      const i = stoppedIdx[0], j = stoppedIdx[1]; let sevenTenpai = false;
      for (const name in LINES) { const ln = LINES[name];
        if (winAt(i, targetK[i])[ln[i]] === "7" && winAt(j, targetK[j])[ln[j]] === "7") { sevenTenpai = true; break; } }
      if (sevenTenpai) play("tenpai");
    }
    if (done) judge();
  }

  function judge() {
    const res = spin.result(), formed = res.formed;
    let payout = 0, rep = false, notes = [];
    const label = { GR:"ブドウ", BE:"ベル", PI:"ピエロ", CH:"🍒チェリー", MC:"🍒中段チェリー" };
    for (const [role, line] of formed) {
      if (role === "RE") { rep = true; }
      else if (role === "BIG" || role === "REG") { /* ボーナス揃いは下で処理 */ }
      else { payout += PAY[role]; if (label[role] && notes.indexOf(label[role]) < 0) notes.push(label[role]); }
    }
    // リーチ目: 同じ有効ライン上に7とBARが「並んだ」とき（枠内にバラバラにあるだけでは出さない）
    let hasEye = false;
    for (const name in LINES) { const ln = LINES[name];
      const line = [winAt(0, targetK[0])[ln[0]], winAt(1, targetK[1])[ln[1]], winAt(2, targetK[2])[ln[2]]];
      if (line.indexOf("7") >= 0 && line.indexOf("A") >= 0) { hasEye = true; break; } }

    const bonusHit = pending && formed.some((e) => e[0] === pending);
    if (bonusHit) {
      const net = pending === "BIG" ? 252 : 96;
      payout += net; lastWin = payout; credit += payout;
      $("cab").querySelector(".win").classList.add("flash"); play("bonus");
      say((pending === "BIG" ? "🎉 BIG BONUS！ 純増+252" : "🎉 REG BONUS！ 純増+96") + (notes.length ? "（" + notes.join("・") + "）" : ""), "big");
      pending = null; lampOn = false;
    } else {
      lastWin = payout; credit += payout; if (rep) freeSpin = true;
      if (pending) {
        // 内部中でボーナスは未揃い
        if (!lampOn) lampOn = true; // 後告知: 全停止後に点灯
        if (hasEye) { say("👀 リーチ目！ BARと7が並んだ…ボーナス濃厚！ 次回転から7を目押し", "eye"); }
        else if (notes.length) say(notes.join("・") + " ＋" + payout + "　（GOGO!点灯中：7を狙え）", "big");
        else say("リーチ目っぽい…（GOGO!点灯中：7を目押しで狙え）", "eye");
      } else {
        say(notes.length ? "🎉 " + notes.join(" / ") + "　＋" + payout + (rep ? "" : "枚") : "ハズレ… 次いこう");
      }
    }
    save(); paint(); betLamps(false);
    // 効果音
    if (bonusHit) play("bgm");
    else if (notes.some((n) => n.indexOf("ブドウ") >= 0)) play("grape");
    else if (rep) play("replay");
    else if (notes.some((n) => n.indexOf("チェリー") >= 0)) play("cherry");
  }
})();
</script>`;
}
