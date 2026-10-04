// 全画面共通の枠（上の帯・ナビ・お知らせ・共通スクリプト）。
import { CSS } from "./styles.js";
import { FX_APP } from "./fx.js";
import { HELP_WIDGET } from "./help.js";

export const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** 数字を桁区切りにする（#128）。1384 と 1,384 が混ざっていたので、画面に出す数字は必ずここを通す */
export const n = (v: number | null | undefined) => Number(v ?? 0).toLocaleString("ja-JP");

// 線画のアイコン。絵文字（📝 ✉ ⚠ など）は端末によって見た目が変わり、色も付いて画面から浮くので使わない。
// 線の太さと角の丸みを揃えた小さなSVGを、文字と同じ色（currentColor）で出す
const IC = (d: string, cls = "") => `<svg class="ic${cls ? " " + cls : ""}" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const IC_MAIL = IC('<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3.5 7.5 12 13.5l8.5-6"/>');
export const IC_FORM = IC('<rect x="4.5" y="3.5" width="15" height="17" rx="2.5"/><path d="M8 8.5h8M8 12h8M8 15.5h5"/>');
export const IC_WARN = IC('<path d="M12 4 2.8 19.5h18.4L12 4Z"/><path d="M12 10v4.5"/><circle cx="12" cy="17" r=".6" fill="currentColor"/>', "ic-warn");
export const IC_CHECK = IC('<circle cx="12" cy="12" r="9"/><path d="m8 12.3 2.8 2.8L16.2 9.5"/>', "ic-ok");
const IC_GAME = IC('<rect x="2.5" y="7" width="19" height="10.5" rx="5.2"/><path d="M7 10.5v3.5M5.2 12.2h3.6"/><circle cx="15.5" cy="11" r=".7" fill="currentColor"/><circle cx="18" cy="13.4" r=".7" fill="currentColor"/>');

/** キャラクター（青いアライグマ）。いつも画面にいると邪魔なので、出すのは「区切りの場面」だけにする:
 *  ログイン画面・やることが無いとき・一覧が空のとき・エラーページ。作業中の画面（一覧・設定・入力）には出さない。
 *  画像は明るい地の上に置く前提（足もとの影が白っぽいので、濃い地には置かない） */
export const mascot = (size = 96) => `<img class="mascot" src="/assets/mascot.png?v=1" alt="" width="${Math.round(size * 0.95)}" height="${size}" loading="lazy" onerror="this.remove()">`;

export type NavUser = { username: string; display_name: string; role: string; gameOn?: boolean; todo?: number; appo?: number; effects?: boolean; path?: string } | null;

// ロゴは assets/ の画像を使う。画像を差し替えたら ?v= の数字を上げる（ブラウザが古い絵を1時間覚えているため）
// （ログイン前でも読めるよう、/assets は認証の手前で配信している）
const FAVICON = "/assets/icon.png?v=2";
const LOGO = `<img src="/assets/logo.png?v=2" alt="ApoBoost" width="120" height="24">`;

/** ナビは6つに絞る（#97）。以前は12リンクが2段に折り返していた。
 *  送信者・除外リスト・動作チェック・ユーザー管理・アップデートは「設定」の中のタブへ。
 *  ガイドは、導入動画を載せる場所なので上のメニューに残す */
const SETTINGS_PATHS = ["/settings", "/senders", "/suppressions", "/health", "/logs", "/users", "/update", "/law", "/setup", "/checklist", "/password"];
function navOf(user: NonNullable<NavUser>): string {
  const p = user.path ?? "/";
  const at = (test: (x: string) => boolean) => (test(p) ? ' class="on"' : "");
  const inSettings = SETTINGS_PATHS.some((s) => p === s || p.startsWith(s + "/"));
  return `<nav>
<a href="/"${at((x) => x === "/")}>ホーム</a>
<a href="/campaigns"${at((x) => x.startsWith("/campaigns") || x.startsWith("/jobs"))}>キャンペーン</a>
<a href="/appointments"${at((x) => x.startsWith("/appointments"))}>アポ${user.appo ? `<span class="badge" style="background:var(--c-ok)">${n(user.appo)}</span>` : ""}</a>
<a href="/todo"${at((x) => x.startsWith("/todo"))}>要対応${user.todo ? `<span class="badge">${n(user.todo)}</span>` : ""}</a>
<a href="/stats"${at((x) => x.startsWith("/stats") || x.startsWith("/report"))}>成果</a>
<a href="/guide"${at((x) => x.startsWith("/guide"))}>ガイド</a>
<a href="/settings"${inSettings ? ' class="on"' : ""}>設定</a>
${user.gameOn ? `<a href="/game" title="待ち時間の息抜きに" aria-label="ミニゲーム">${IC_GAME}</a>` : ""}
</nav>`;
}

/** 「設定」の中のタブ（#107）。設定が4画面に散っていたので、入口を1つにまとめる */
export function settingsTabs(active: string, isAdmin: boolean): string {
  const tabs: [string, string, boolean][] = [
    ["/settings", "基本設定", true],
    ["/senders", "送信者", false],
    ["/suppressions", "除外・チーム共有", false],
    ["/health", "動作チェック・バックアップ", false],
    ["/update", "アップデート", true],
    ["/users", "ユーザー", true],
  ];
  return `<div class="subnav">${tabs.filter(([, , adminOnly]) => isAdmin || !adminOnly).map(([href, label]) => `<a href="${href}"${active === href ? ' class="on"' : ""}>${label}</a>`).join("")}</div>`;
}

/** いまの画面が「設定」の仲間なら、上にタブを出す */
function settingsTabsFor(user: NonNullable<NavUser>): string {
  const p = user.path ?? "";
  const map: [string, string][] = [["/settings", "/settings"], ["/senders", "/senders"], ["/suppressions", "/suppressions"], ["/health", "/health"], ["/logs", "/health"], ["/update", "/update"], ["/users", "/users"]];
  const hit = map.find(([prefix]) => p === prefix || p.startsWith(prefix + "/"));
  return hit ? settingsTabs(hit[1], user.role === "admin") : "";
}

export function layout(title: string, body: string, flash = "", user: NavUser = null, updateReady = false): string {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} | ApoBoost</title>
<link rel="icon" href="${FAVICON}">
<style>${CSS}</style></head><body>
<header class="top"><a class="logo" href="/">${LOGO}</a>${user ? `${navOf(user)}<div class="right">${user.role === "admin" && updateReady ? `<a class="upd" href="/update">新しい版があります</a>` : ""}<span>${esc(user.display_name || user.username)}${user.role === "admin" && (user.display_name || user.username) !== "管理者" ? "（管理者）" : ""}</span><a href="/password">パスワード</a><a href="/logout">ログアウト</a></div>` : ""}</header>
<main>${flash ? `<div class="flash">${esc(flash)}</div>` : ""}${user ? settingsTabsFor(user) : ""}${body}</main>
<script>
// 送信系フォームの送信中スピナー＋二重送信防止（既存 .spin スタイルを流用）
document.addEventListener("submit", (e) => {
  const f = e.target;
  if (!(f instanceof HTMLFormElement) || !f.hasAttribute("data-busy")) return;
  const btn = f.querySelector('button[type=submit], button:not([type])');
  if (btn) {
    if (btn.dataset.clicked === "1") { e.preventDefault(); return; }
    btn.dataset.clicked = "1"; btn.disabled = true;
    btn.dataset.label = btn.innerHTML;
    btn.innerHTML = '<span class="spin"></span>' + (btn.dataset.busytext || "処理中…");
  }
}, true);
</script>
<script>
// 「…」メニュー: 外を押したら閉じる。1つ開いたら他は閉じる
document.addEventListener("click", (e) => {
  document.querySelectorAll("details.menu[open]").forEach((d) => { if (!d.contains(e.target) || (e.target.closest && e.target.closest(".pop a"))) d.removeAttribute("open"); });
});
addEventListener("keydown", (e) => { if (e.key === "Escape") document.querySelectorAll("details.menu[open]").forEach((d) => d.removeAttribute("open")); });
</script>
<script>
// 入力途中の自動保存（data-draft を付けたフォーム: 送信者・キャンペーン）。
// ご利用ガイドなど別の画面と行き来しても、書きかけの内容が消えないようにする。このブラウザの中だけに保存（パスワード・ファイルは保存しない）。
// 保存ボタンを押した時点で消す（保存後に戻る画面にも同じフォームがあり、保存済みの内容を「復元」と出すと二重登録につながるため）。
(()=>{const P="fo-draft:";
const fields=f=>Array.from(f.elements).filter(e=>e.name&&!/^(password|file|hidden|submit|button|reset)$/.test(e.type));
const snap=f=>{const o={};fields(f).forEach(e=>{if(e.type==="checkbox"||e.type==="radio"){(o[e.name]=o[e.name]||{})[e.value]=e.checked}else o[e.name]=e.value});return o};
const put=(f,o)=>fields(f).forEach(e=>{const v=o[e.name];if(v===undefined)return;if(e.type==="checkbox"||e.type==="radio"){if(v&&typeof v==="object"&&e.value in v)e.checked=v[e.value]}else if(typeof v==="string")e.value=v;e.dispatchEvent(new Event("change",{bubbles:true}))});
try{
for(let i=localStorage.length-1;i>=0;i--){const k=localStorage.key(i);if(!k||k.indexOf(P)!==0)continue;let d={};try{d=JSON.parse(localStorage.getItem(k)||"{}")}catch(e){}
if(Date.now()-(d.at||0)>30*864e5)localStorage.removeItem(k);}}catch(e){}
document.querySelectorAll("form[data-draft]").forEach(f=>{const key=P+f.dataset.draft;const orig=snap(f);let d=null;
try{d=JSON.parse(localStorage.getItem(key)||"null")}catch(e){}
let restoring=false;
if(d&&d.values&&JSON.stringify(d.values)!==JSON.stringify(orig)){restoring=true;put(f,d.values);restoring=false;
const bar=document.createElement("div");bar.className="flash";bar.style.margin="0 0 12px";
bar.innerHTML='前回の入力途中の内容を復元しました（'+new Date(d.at).toLocaleString("ja-JP",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"})+'）。まだ保存はされていません。 <button type="button" class="btn sub small">復元をやめて元に戻す</button>';
bar.querySelector("button").onclick=()=>{restoring=true;put(f,orig);restoring=false;try{localStorage.removeItem(key)}catch(e){}bar.remove()};f.prepend(bar);}
let t;const save=()=>{if(restoring)return;clearTimeout(t);t=setTimeout(()=>{try{const v=snap(f);if(JSON.stringify(v)===JSON.stringify(orig))localStorage.removeItem(key);else localStorage.setItem(key,JSON.stringify({at:Date.now(),values:v}))}catch(e){}},300)};
f.addEventListener("input",save);f.addEventListener("change",save);
f.addEventListener("submit",()=>{clearTimeout(t);try{localStorage.removeItem(key)}catch(e){}});
});})();
</script>
<script>
// 長い説明文を「？」に畳む（#99）。入力欄の間に説明が挟まって、肝心の欄が埋もれていたため。
// 対象: カードやフォームの中の、60文字を超える補足文。⚠や赤字の注意は畳まない（見落とすと困るので）。
(()=>{
  const KEY="fo-help-open";
  let openAll=false; try{openAll=localStorage.getItem(KEY)==="1"}catch(e){}
  let seq=0;
  document.querySelectorAll("main p.muted, main div.muted").forEach((el)=>{
    if(el.closest("[data-nohelp]")||el.closest(".helpbody")) return;
    const text=(el.textContent||"").trim();
    if(text.length<60) return;
    if(/[⚠✕]/.test(text)||el.querySelector(".ic-warn")) return;
    const st=el.getAttribute("style")||"";
    if(/color:\\s*var\\(--(ng|warn)\\)/.test(st)) return;
    const id="fo-help-"+(++seq);
    const btn=document.createElement("button");
    btn.type="button"; btn.className="helpbtn"; btn.textContent="？";
    btn.setAttribute("aria-controls",id); btn.setAttribute("aria-expanded",String(openAll)); btn.title="説明を表示";
    const lab=document.createElement("span"); lab.className="helplabel"; const first=text.split(/[。\\n]/)[0].trim(); lab.textContent=first.length<=30?first:"説明を見る";
    const wrap=document.createElement("div"); wrap.className="helpbody"; wrap.id=id; wrap.hidden=!openAll;
    el.parentNode.insertBefore(btn,el); el.parentNode.insertBefore(lab,el); el.parentNode.insertBefore(wrap,el); wrap.appendChild(el);
    lab.hidden=openAll;
    const toggle=()=>{const open=wrap.hidden; wrap.hidden=!open; lab.hidden=open; btn.setAttribute("aria-expanded",String(open));};
    btn.addEventListener("click",toggle); lab.addEventListener("click",toggle);
  });
})();
</script>
${user ? `<script>
// 開いているこのページから通知を出す。
// OSの通知は状況によって出ないことがあるので、ページ自身が数秒ごとに新しいお知らせを見に行き、
// ブラウザの通知（押すとこのタブが前に出る・絵はロゴ）と、ページ右上の帯の両方で知らせる。
(()=>{
  const K="fo-last-event";
  const get=()=>{try{return Number(localStorage.getItem(K)||0)}catch(e){return 0}};
  const set=(v)=>{try{localStorage.setItem(K,String(v))}catch(e){}};
  function toast(title,body){
    let box=document.getElementById("fo-toasts");
    if(!box){box=document.createElement("div");box.id="fo-toasts";box.style.cssText="position:fixed;top:14px;right:14px;z-index:200;display:flex;flex-direction:column;gap:8px;max-width:min(380px,calc(100vw - 28px))";document.body.appendChild(box);}
    const el=document.createElement("div");
    el.style.cssText="background:#fff;border:1px solid var(--c-line-strong);border-left:4px solid var(--c-brand);border-radius:10px;padding:10px 12px;box-shadow:0 6px 24px rgba(0,0,0,.18);display:flex;gap:10px;align-items:flex-start;cursor:pointer";
    const img=document.createElement("img");img.src="/assets/icon.png?v=2";img.width=32;img.height=32;img.alt="";img.onerror=()=>img.remove();
    const tx=document.createElement("div");const b=document.createElement("b");b.textContent=title;const p=document.createElement("div");p.className="small";p.textContent=body;tx.appendChild(b);tx.appendChild(p);
    el.appendChild(img);el.appendChild(tx);el.title="クリックで閉じる";el.onclick=()=>el.remove();
    box.appendChild(el);setTimeout(()=>el.remove(),20000);
  }
  function show(e){
    toast(e.title,e.body);
    try{
      if("Notification" in window&&Notification.permission==="granted"){
        const n=new Notification("ApoBoost: "+e.title,{body:e.body,icon:"/assets/icon.png?v=2",tag:"fo-"+e.id});
        n.onclick=()=>{window.focus();n.close();};
      }
    }catch(err){}
  }
  async function poll(){
    try{
      const since=get();
      const r=await fetch("/events?since="+since,{cache:"no-store"});
      if(!r.ok)return;
      const j=await r.json();
      for(const e of j.events){ if(e.id<=get())continue; set(e.id); show(e); }
      if(!since||(!j.events.length&&j.last>get()))set(j.last);
    }catch(err){}
  }
  // タブを複数開いていても、同じお知らせを二重に出さない（同時に確認するのは1つのタブだけ）
  const run=()=>{ if(navigator.locks&&navigator.locks.request) navigator.locks.request("fo-events",{ifAvailable:true},(lock)=>lock?poll():null); else poll(); };
  setInterval(run,5000); run();

  // 通知の許可をまだ聞いていなければ、上に小さく案内を出す（押したときだけブラウザが許可を聞く）
  try{
    const snooze=Number(localStorage.getItem("fo-notify-later")||0);
    if("Notification" in window&&Notification.permission==="default"&&Date.now()-snooze>7*864e5){
      const bar=document.createElement("div");bar.className="flash";bar.style.cssText="display:flex;gap:10px;align-items:center;flex-wrap:wrap";
      bar.innerHTML='<span>通知をオンにすると、送信が止まったとき・アポの返信が来たときに、このパソコンに知らせます。</span>';
      const yes=document.createElement("button");yes.className="btn small primary";yes.textContent="通知をオンにする";
      const no=document.createElement("button");no.className="btn small";no.textContent="あとで";
      yes.onclick=()=>{Notification.requestPermission().then((p)=>{bar.remove();if(p==="granted")show({id:0,title:"通知をオンにしました",body:"送信が止まったときやアポの返信が来たときに、このように知らせます"});});};
      no.onclick=()=>{try{localStorage.setItem("fo-notify-later",String(Date.now()))}catch(e){};bar.remove();};
      bar.appendChild(yes);bar.appendChild(no);
      const main=document.querySelector("main");if(main)main.prepend(bar);
    }
  }catch(err){}
})();
</script>` : ""}
${user?.effects ? `<div id="fo-chara" aria-hidden="true">
<div class="icon">
<svg class="bee on" viewBox="0 0 48 48"><path d="M20 14C18.5 9 16 7.5 13.5 7" stroke="#1C1710" stroke-width="2.2" fill="none" stroke-linecap="round"/><path d="M28 14C29.5 9 32 7.5 34.5 7" stroke="#1C1710" stroke-width="2.2" fill="none" stroke-linecap="round"/><circle cx="12.8" cy="6.4" r="2.4" fill="#1C1710"/><circle cx="35.2" cy="6.4" r="2.4" fill="#1C1710"/><ellipse cx="9.5" cy="20" rx="8" ry="5.6" fill="#fff" stroke="#1C1710" stroke-width="1.6" transform="rotate(-24 9.5 20)"/><ellipse cx="38.5" cy="20" rx="8" ry="5.6" fill="#fff" stroke="#1C1710" stroke-width="1.6" transform="rotate(24 38.5 20)"/><rect x="13" y="13" width="22" height="29" rx="11" fill="#FFC62E" stroke="#1C1710" stroke-width="2"/><rect x="13" y="27.5" width="22" height="4.6" fill="#1C1710"/><rect x="13" y="36" width="22" height="4.6" fill="#1C1710"/><circle cx="19.6" cy="21.5" r="2.3" fill="#1C1710"/><circle cx="28.4" cy="21.5" r="2.3" fill="#1C1710"/><circle cx="20.4" cy="20.7" r=".8" fill="#fff"/><circle cx="29.2" cy="20.7" r=".8" fill="#fff"/><circle cx="16.8" cy="24.6" r="1.5" fill="#F4A7A3"/><circle cx="31.2" cy="24.6" r="1.5" fill="#F4A7A3"/><path d="M21.5 25.8Q24 27.6 26.5 25.8" stroke="#1C1710" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>
<svg class="hopper" viewBox="0 0 48 48"><path d="M20 12C18 7.5 15.5 6 13 5.5" stroke="#1C1710" stroke-width="2.2" fill="none" stroke-linecap="round"/><path d="M28 12C30 7.5 32.5 6 35 5.5" stroke="#1C1710" stroke-width="2.2" fill="none" stroke-linecap="round"/><circle cx="12.4" cy="5" r="2.2" fill="#1C1710"/><circle cx="35.6" cy="5" r="2.2" fill="#1C1710"/><path d="M12 22L6 15" stroke="#1C1710" stroke-width="3" stroke-linecap="round"/><path d="M36 22L42 15" stroke="#1C1710" stroke-width="3" stroke-linecap="round"/><path d="M10 20 14 26" stroke="#7CB342" stroke-width="4" stroke-linecap="round"/><path d="M38 20 34 26" stroke="#7CB342" stroke-width="4" stroke-linecap="round"/><path d="M12 32L7 40M36 32L41 40" stroke="#1C1710" stroke-width="3" stroke-linecap="round"/><rect x="13" y="12" width="22" height="30" rx="11" fill="#9CCC65" stroke="#1C1710" stroke-width="2"/><rect x="13" y="28" width="22" height="4" fill="#7CB342"/><rect x="13" y="35" width="22" height="4" fill="#7CB342"/><circle cx="19.6" cy="20.5" r="2.3" fill="#1C1710"/><circle cx="28.4" cy="20.5" r="2.3" fill="#1C1710"/><circle cx="20.4" cy="19.7" r=".8" fill="#fff"/><circle cx="29.2" cy="19.7" r=".8" fill="#fff"/><circle cx="16.8" cy="23.6" r="1.5" fill="#F4A7A3"/><circle cx="31.2" cy="23.6" r="1.5" fill="#F4A7A3"/><path d="M21.5 24.8Q24 26.6 26.5 24.8" stroke="#1C1710" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>
</div>
<span class="name">アポバッタくん</span>
</div>
<script>
// 蜂とバッタを10秒ごとに交互に変身させる（送信の進捗とは無関係の演出）。
// バッタのときだけ緑の背景と「アポバッタくん」の名前を表示する。
(()=>{const box=document.getElementById("fo-chara");if(!box)return;
const bee=box.querySelector(".bee"),hop=box.querySelector(".hopper");
const t=setInterval(()=>{box.classList.remove("morph");void box.offsetWidth;box.classList.add("morph");
setTimeout(()=>{const toHopper=!hop.classList.contains("on");bee.classList.toggle("on");hop.classList.toggle("on");box.classList.toggle("hopper-mode",toHopper);},240);},10000);
addEventListener("pagehide",()=>clearInterval(t),{once:true});})();
</script>` : ""}
${user ? FX_APP : ""}
${user ? HELP_WIDGET : ""}
</body></html>`;
}

/** 行き止まりにしないエラーページ（#105）。以前は白紙に「not found」だけだった */
export function errorPage(status: number, user: NavUser = null): string {
  const M: Record<number, [string, string]> = {
    404: ["ページが見つかりません", "URLが間違っているか、削除された会社・キャンペーンの可能性があります。"],
    403: ["この画面を見る権限がありません", "管理者だけが開ける画面です。必要な場合は、管理者にご相談ください。"],
    500: ["うまく表示できませんでした", "アプリの中でエラーが起きました。時間を置いてもう一度お試しください。解決しない場合は、動作チェックの「診断ファイル」を配布元に送ってください。"],
  };
  const [title, msg] = M[status] ?? M[500];
  return layout(title, `<div class="card" style="text-align:center;padding:48px 20px">
<div style="display:flex;justify-content:center">${mascot(110)}</div>
<div style="font-size:36px;font-weight:800;color:var(--c-ink-3);line-height:1;margin-top:8px">${status}</div>
<h1 style="margin:14px 0 8px">${esc(title)}</h1>
<p class="muted" data-nohelp style="max-width:520px;margin:0 auto 22px">${esc(msg)}</p>
<p><a class="btn primary" href="/">ホームに戻る</a> <a class="btn" href="/health">動作チェック</a> <a class="btn" href="javascript:history.back()">前の画面に戻る</a></p>
</div>`, "", user);
}
