// 画面の見た目（#144 デザイントークン／#111 色の意味／#112 主ボタン／#136 配色）。
// 色・余白・文字サイズはここだけで決める。各画面のHTMLには、できるだけ色を直接書かない。
//
// 色の意味（どの画面でも同じ）:
//   緑＝送れた・問題なし ／ 赤＝人の手が要る ／ 黄＝待ち ／ 青＝いま進行中 ／ 灰＝対象外
// ブランド色（ロゴの青）は「その画面でいちばん押してほしいボタン」と、いま選んでいるタブの印だけに使う。
// 以前はブランド色が黄色で、「待ち」の黄色と同じだった。ロゴを青に変えたので、待ちの黄色（--c-wait*）とは別の色にしてある。
// 上の帯はロゴの紺（--c-nav）。背景・文字・線も、ロゴに合わせて暖色から寒色へ寄せた。

export const CSS = `
:root{
  /* ---- 色 ---- */
  --c-bg:#F3F6FB; --c-surface:#FFFFFF; --c-surface-2:#F7F9FC;
  --c-ink:#0B1B3F; --c-ink-2:#3A4763; --c-ink-3:#66728A;
  --c-line:#DCE3EE; --c-line-strong:#C2CCDB;
  --c-brand:#0A66E8; --c-brand-ink:#FFFFFF; --c-brand-bg:#EAF2FF; --c-nav:#062256;
  --c-ok:#1E7B34;   --c-ok-bg:#E6F4EA;
  --c-ng:#C62828;   --c-ng-bg:#FDECEC;
  --c-wait:#7A5600; --c-wait-bg:#FFF2CC; --c-wait-dot:#F2B526;
  --c-info:#1B5FA8; --c-info-bg:#E7F0FA;
  --c-off:#566074;  --c-off-bg:#E9EDF3;
  --c-warn:#B45309; --c-warn-bg:#FFF1E0;
  --c-link:#1A4FB4;
  /* ---- 文字 ---- */
  --fs-base:14px; --fs-sm:12px; --fs-xs:12px; --fs-h1:20px; --fs-h2:16px; --lh:1.6;
  /* ---- 余白・角 ---- */
  --sp-1:4px; --sp-2:8px; --sp-3:12px; --sp-4:16px; --sp-5:24px; --radius:10px; --radius-sm:8px;
  /* ---- 以前の名前（各画面のHTMLが使っている）。意味を保ったまま新しい色に対応させる ---- */
  --honey:var(--c-brand); --honey-50:var(--c-surface-2); --honey-100:var(--c-wait-bg);
  --hive:var(--c-ink); --hive-600:var(--c-ink-2); --hive-200:var(--c-line);
  --bg:var(--c-bg); --ok:var(--c-ok); --ng:var(--c-ng); --warn:var(--c-warn);
}
*{box-sizing:border-box}
/* hidden 属性は必ず効かせる（style="display:flex" などを付けた要素でも隠れるように。拡大表示の黒い幕が出っぱなしになる不具合があった） */
[hidden]{display:none!important}
body{margin:0;font-family:-apple-system,"Hiragino Sans","Noto Sans JP","Yu Gothic UI",sans-serif;background:var(--c-bg);color:var(--c-ink);font-size:var(--fs-base);line-height:var(--lh)}
a{color:var(--c-link)}

/* ---- 上の帯（ナビ）---- */
header.top{background:var(--c-nav);color:#fff;padding:10px 20px;display:flex;align-items:center;gap:6px 6px;flex-wrap:wrap}
header.top a{color:#fff;text-decoration:none;white-space:nowrap}
header.top .logo{background:#fff;padding:5px 10px;border-radius:var(--radius-sm);display:inline-flex;align-items:center;margin-right:10px}
header.top .logo img{display:block;flex:none;height:24px;width:auto}
/* ロゴにカーソルを載せると、ロゴの形に沿って光が1度横切る（光はロゴの画像で切り抜く） */
header.top .logo{position:relative;transition:transform .15s}
header.top .logo:hover{transform:translateY(-1px)}
header.top .logo::after{content:"";position:absolute;inset:5px 10px;background:linear-gradient(105deg,transparent 40%,rgba(255,255,255,.85) 50%,transparent 60%) no-repeat;background-size:250% 100%;background-position:150% 0;-webkit-mask:url(/assets/logo.png?v=2) center/100% 100% no-repeat;mask:url(/assets/logo.png?v=2) center/100% 100% no-repeat;pointer-events:none}
header.top .logo:hover::after{animation:logo-sheen .9s ease-in-out 1}
@keyframes logo-sheen{from{background-position:150% 0}to{background-position:-50% 0}}
header.top nav{display:flex;gap:2px;flex-wrap:wrap;align-items:center}
header.top nav a{padding:7px 14px;border-radius:999px;font-weight:600}
header.top nav a:hover{background:rgba(255,255,255,.12)}
header.top nav a.on{background:#fff;color:var(--c-ink)}
header.top nav a .badge{display:inline-block;background:var(--c-ng);color:#fff;font-size:12px;font-weight:700;border-radius:999px;padding:0 7px;margin-left:6px;line-height:1.6}
header.top .right{margin-left:auto;display:flex;gap:12px;align-items:center;font-size:var(--fs-sm);color:#C5D0E6}
header.top .right a{color:#C5D0E6}
header.top a.upd{background:var(--c-brand);color:var(--c-brand-ink);font-weight:700;padding:4px 12px;border-radius:999px}

/* ---- 設定の中のタブ ---- */
.subnav{display:flex;gap:4px;flex-wrap:wrap;border-bottom:2px solid var(--c-line);margin:0 0 20px}
.subnav a{padding:8px 14px;text-decoration:none;color:var(--c-ink-2);font-weight:600;border-bottom:3px solid transparent;margin-bottom:-2px;border-radius:6px 6px 0 0}
.subnav a:hover{background:var(--c-surface)}
.subnav a.on{color:var(--c-ink);border-bottom-color:var(--c-brand);background:var(--c-surface)}

/* ---- 本文 ---- */
main{max-width:1120px;margin:0 auto;padding:24px 20px 80px}
h1{font-size:var(--fs-h1);margin:0 0 14px;line-height:1.4}
h2{font-size:var(--fs-h2);margin:22px 0 8px;line-height:1.5}
.card{background:var(--c-surface);border:1px solid var(--c-line);border-radius:var(--radius);padding:16px;margin-bottom:16px}
.card.note{background:var(--c-warn-bg);border-color:#F1D3A8}
.card.testcard{background:var(--c-surface-2)}
label{display:block;font-weight:600;margin:12px 0 4px}
input[type=text],input[type=number],input[type=url],input[type=email],input[type=password],textarea,select{width:100%;padding:8px;border:1px solid var(--c-line-strong);border-radius:var(--radius-sm);font:inherit;background:#fff;color:var(--c-ink)}
input:focus,textarea:focus,select:focus{outline:2px solid var(--c-brand);outline-offset:1px}
textarea{min-height:140px}
.row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:14px}
.row3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}

/* ---- ボタン：ブランド色（青）は「その画面でいちばん押してほしい1つ」だけ（#112）---- */
.btn{display:inline-block;background:#fff;color:var(--c-ink);border:1px solid var(--c-line-strong);padding:8px 14px;border-radius:var(--radius-sm);font-weight:700;cursor:pointer;text-decoration:none;font:inherit;font-weight:700;line-height:1.4}
.btn:hover{border-color:var(--c-ink-3)}
.btn.primary{background:var(--c-brand);border-color:var(--c-brand);color:var(--c-brand-ink)}
/* 主ボタンは、載せると少し浮く（押せることが分かるように） */
.btn{transition:transform .15s,box-shadow .15s,border-color .15s,background .15s}
.btn.primary:hover:not([disabled]){background:#0858CC;border-color:#0858CC;transform:translateY(-1px);box-shadow:0 5px 14px rgba(10,102,232,.3)}
.btn.primary:active{transform:none;box-shadow:none}
@media (prefers-reduced-motion:reduce){.btn,header.top .logo{transition:none}header.top .logo:hover::after{animation:none}}
.btn.sub{font-weight:600}
.btn.danger{border-color:var(--c-ng);color:var(--c-ng)}
.btn.small{padding:5px 10px;font-size:var(--fs-sm)}
.btn[disabled]{opacity:.5;cursor:not-allowed}

/* ---- 表 ---- */
table{width:100%;border-collapse:collapse;background:var(--c-surface)}
th,td{border-bottom:1px solid var(--c-line);padding:7px 8px;text-align:left;vertical-align:top}
th{background:var(--c-surface-2);font-size:var(--fs-xs);color:var(--c-ink-2);font-weight:700}
th a{color:inherit}
tr.hl td{background:var(--c-brand-bg)}tr.hl td:first-child{box-shadow:inset 3px 0 0 var(--c-brand)}
tr.histrow td{background:var(--c-surface-2);border-bottom:1px dashed var(--c-line)}

/* ---- 状態の札（色の意味は全画面共通：#111）---- */
.tag{display:inline-block;padding:2px 10px;border-radius:999px;font-size:var(--fs-xs);font-weight:700;background:var(--c-off-bg);color:var(--c-off);white-space:nowrap}
.tag.sent{background:var(--c-ok-bg);color:var(--c-ok)}
.tag.failed{background:var(--c-ng-bg);color:var(--c-ng)}
.tag.queued{background:var(--c-wait-bg);color:var(--c-wait)}
.tag.sending{background:var(--c-info-bg);color:var(--c-info)}
.tag.skip{background:var(--c-off-bg);color:var(--c-off)}
.legend{display:flex;gap:6px 14px;flex-wrap:wrap;font-size:var(--fs-xs);color:var(--c-ink-2);margin:6px 0 10px}
.legend i{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:5px;vertical-align:0}
.errkind{display:inline-block;padding:1px 8px;border-radius:999px;font-size:12px;font-weight:700;background:var(--c-warn-bg);color:var(--c-warn);margin-right:4px;white-space:nowrap}

/* ---- 数字のタイル ---- */
.stats{display:flex;gap:10px;flex-wrap:wrap}
.stat{background:var(--c-surface);border:1px solid var(--c-line);border-radius:var(--radius);padding:12px 16px;min-width:120px}
.stat b{display:block;font-size:22px;line-height:1.3;font-variant-numeric:tabular-nums}
.stat .unit{font-size:var(--fs-xs);font-weight:400;margin-left:2px}

/* ---- キャンペーンの概要（進み具合・返信・ペース）----
   以前は同じ大きさの枠が10個並び、どれが大事か分からなかった。大きい数字は3つだけにして、内訳は小さく出す */
.meta{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 12px;font-size:var(--fs-sm);color:var(--c-ink-2)}
.meta>span{background:var(--c-surface);border:1px solid var(--c-line);border-radius:999px;padding:2px 10px;white-space:nowrap}
.meta>span.warn{background:var(--c-warn-bg);border-color:#F1D3A8;color:var(--c-warn);font-weight:700}
.ov{padding:14px 18px;margin-bottom:12px}
.ovhead{display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap;margin-bottom:10px}
.ovhead b{font-size:var(--fs-base)}
.ovhead a,.ovhead .muted{font-size:var(--fs-sm)}
.ovbar{display:flex;gap:2px;height:14px;border-radius:999px;overflow:hidden;background:var(--c-off-bg);margin-bottom:12px}
.ovbar i{display:block;min-width:3px}
.ovbar .ok{background:var(--c-ok)}.ovbar .wait{background:var(--c-wait-dot)}.ovbar .off{background:var(--c-line-strong)}
.ovnums{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.ovnum{display:block;text-decoration:none;color:inherit;border-radius:var(--radius-sm);padding:4px 8px;margin:-4px -8px}
.ovnum:hover{background:var(--c-surface-2)}
.ovnum .lbl{display:flex;align-items:center;gap:6px;font-size:var(--fs-sm);color:var(--c-ink-2)}
.ovnum .lbl i{width:10px;height:10px;border-radius:50%;flex:none}
.ovnum.ok .lbl i{background:var(--c-ok)}.ovnum.wait .lbl i{background:var(--c-wait-dot)}.ovnum.off .lbl i{background:var(--c-line-strong)}
.ovnum b{display:block;font-size:26px;line-height:1.3;font-variant-numeric:tabular-nums}
.ovnum.ok b{color:var(--c-ok)}
.ovnum .unit,.ovmini .unit{font-size:var(--fs-xs);font-weight:400;margin-left:2px}
.ovnum .pct{font-size:var(--fs-sm);color:var(--c-ink-3)}
.ovwhy{display:flex;gap:6px;flex-wrap:wrap;align-items:center;border-top:1px solid var(--c-line);margin-top:12px;padding-top:10px}
.ovwhy .muted{margin-right:4px}
.chip{display:inline-block;background:var(--c-off-bg);color:var(--c-ink-2);border-radius:999px;padding:2px 10px;font-size:var(--fs-sm);text-decoration:none;white-space:nowrap}
.chip:hover{background:var(--c-line)}
.chip.ng{background:var(--c-ng-bg);color:var(--c-ng)}
/* 要対応の行: ボタンが4つ同じ重さで並んでいたので、最初の1つ（いちばん効く操作）だけ濃く、残りは控えめにする */
.todoacts>form:not(:first-child) .btn,.todoacts>a.btn:not(:first-child){border-color:transparent;background:transparent;color:var(--c-ink-2);font-weight:400;padding-left:6px;padding-right:6px;text-decoration:underline}
.todoacts>form:first-child .btn,.todoacts>a.btn:first-child{border-color:var(--c-ink-2);font-weight:700}
.actrow{display:flex;gap:8px;flex-wrap:wrap;align-items:flex-start;margin-top:12px}
.more[open]{flex:1 1 100%}
.more>summary{display:inline-block;list-style:none;cursor:pointer}
.more>summary::-webkit-details-marker{display:none}
.more>summary::after{content:" ▾"}
.more[open]>summary::after{content:" ▴"}
.morebody{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;padding:10px;border:1px solid var(--c-line);border-radius:var(--radius-sm);background:var(--c-surface-2)}
.ovgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}
.ovminis{display:flex;gap:8px 28px;flex-wrap:wrap}
.ovmini>span{display:block;font-size:var(--fs-sm);color:var(--c-ink-2)}
.ovmini b{display:block;font-size:22px;line-height:1.3;font-variant-numeric:tabular-nums}
.ovmini small{display:block;font-size:var(--fs-sm);color:var(--c-ink-3)}

/* ---- お知らせ・補足 ---- */
.flash{background:var(--c-info-bg);border:1px solid #C6DAF2;color:#0F3E73;padding:12px 16px;border-radius:var(--radius-sm);margin-bottom:16px}
.muted{color:var(--c-ink-3);font-size:var(--fs-sm)}
.small{font-size:var(--fs-sm)}
pre{white-space:pre-wrap;background:var(--c-surface-2);padding:12px;border-radius:var(--radius-sm);font-size:var(--fs-sm);border:1px solid var(--c-line)}
.inline{display:inline}
.spin{display:inline-block;width:12px;height:12px;border:2px solid #90CAF9;border-top-color:#1565C0;border-radius:50%;animation:sp .9s linear infinite;vertical-align:-1px;margin-right:6px}@keyframes sp{to{transform:rotate(360deg)}}
.bar{height:16px;background:var(--c-off-bg);border-radius:999px;overflow:hidden;margin:8px 0 4px;max-width:620px}
.bar i{display:block;height:100%;background:var(--c-ok);border-radius:999px;transition:width .6s ease}
.histbtn{background:none;border:1px solid var(--c-line);border-radius:999px;padding:1px 9px;font-size:12px;color:var(--c-ink-2);cursor:pointer;margin-top:3px}

/* ---- 説明文の折りたたみ（#99）。長い説明は「？」を押したときだけ出す ---- */
.helpbtn{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;border:1px solid var(--c-line-strong);background:#fff;color:var(--c-ink-2);font-size:13px;font-weight:700;cursor:pointer;margin:2px 0 6px;vertical-align:middle;line-height:1;padding:0}
.helpbtn:hover{border-color:var(--c-ink-3)}
.helpbtn[aria-expanded="true"]{background:var(--c-ink);color:#fff;border-color:var(--c-ink)}
.helpbtn + .helplabel{font-size:var(--fs-xs);color:var(--c-ink-3);margin-left:6px;cursor:pointer}
.helpbody[hidden]{display:none}
.helpbody{border-left:3px solid var(--c-line);padding:2px 0 2px 12px;margin:4px 0 10px}

/* ---- タブ（キャンペーン画面：#98）---- */
.tabs{display:flex;gap:4px;border-bottom:2px solid var(--c-line);margin:16px 0 18px;flex-wrap:wrap}
.tabs a{padding:10px 18px;text-decoration:none;color:var(--c-ink-2);font-weight:700;border-bottom:3px solid transparent;margin-bottom:-2px;border-radius:6px 6px 0 0}
.tabs a.on{color:var(--c-ink);border-bottom-color:var(--c-brand);background:var(--c-surface)}
.tabs a .cnt{font-weight:400;color:var(--c-ink-3);font-size:var(--fs-xs);margin-left:4px}

/* ---- ページ送り（#103）---- */
.pager{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:12px 0;font-size:var(--fs-sm)}

/* ---- スマホ：表をやめて1社＝1枚のカードにする（#104）---- */
.cards{display:none}
@media (max-width:760px){
  main{padding:16px 14px 80px}
  .row,.row3{grid-template-columns:1fr}
  header.top{padding:8px 12px}
  header.top nav a{padding:6px 10px;font-size:var(--fs-sm)}
  header.top .right{width:100%;margin-left:0;justify-content:flex-end}
  table.resp{display:none}
  .cards{display:grid;gap:10px}
  .cards .c{background:var(--c-surface);border:1px solid var(--c-line);border-radius:var(--radius);padding:12px 14px}
  .cards .c h3{margin:0 0 4px;font-size:var(--fs-base)}
  .cards .c .acts{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}
  .stat{min-width:calc(50% - 5px);flex:1}
}
@media print{header.top,.btn,.subnav,.tabs,#fo-chara{display:none!important}main{padding:0;max-width:none}.card{break-inside:avoid}}
#fo-chara{position:fixed;right:18px;bottom:16px;display:flex;align-items:center;gap:8px;padding:6px 10px 6px 6px;border-radius:999px;background:transparent;transition:background .35s;pointer-events:none;z-index:50}
#fo-chara.hopper-mode{background:#8BC34A;box-shadow:0 3px 10px rgba(0,0,0,.18)}
#fo-chara .icon{position:relative;width:52px;height:52px;flex:none}
#fo-chara svg{position:absolute;inset:0;width:100%;height:100%;opacity:0;transition:opacity .25s}
#fo-chara .on{opacity:1}
#fo-chara .bee.on{animation:fo-buzz 1.1s ease-in-out infinite}
#fo-chara .hopper.on{animation:fo-hop 1.6s ease-in-out infinite}
#fo-chara .name{font-weight:700;color:#1C1710;font-size:13px;white-space:nowrap;max-width:0;overflow:hidden;opacity:0;transition:max-width .35s,opacity .35s}
#fo-chara.hopper-mode .name{max-width:120px;opacity:1}
#fo-chara.morph .icon{animation:fo-morph .6s ease}
@keyframes fo-buzz{0%,100%{transform:translateY(0) rotate(-3deg)}25%{transform:translateY(-5px) rotate(2deg)}50%{transform:translateY(-2px) rotate(-2deg)}75%{transform:translateY(-6px) rotate(3deg)}}
@keyframes fo-hop{0%,55%,100%{transform:translateY(0) scaleY(1)}60%{transform:translateY(1px) scaleY(.88)}70%{transform:translateY(-16px) scaleY(1.04)}80%{transform:translateY(-20px)}90%{transform:translateY(1px) scaleY(.9)}95%{transform:translateY(0) scaleY(1)}}
@keyframes fo-morph{0%{transform:scale(1);filter:brightness(1)}40%{transform:scale(1.35) rotate(10deg);filter:brightness(1.9) drop-shadow(0 0 10px var(--honey))}100%{transform:scale(1);filter:brightness(1)}}
`;
