// 画面の見た目（#144 デザイントークン／#111 色の意味／#112 主ボタン／#136 配色）。
// 色・余白・文字サイズはここだけで決める。各画面のHTMLには、できるだけ色を直接書かない。
//
// 色の意味（どの画面でも同じ）:
//   緑＝送れた・問題なし ／ 赤＝人の手が要る ／ 黄＝待ち ／ 青＝いま進行中 ／ 灰＝対象外
// 見た目は Apple の Human Interface Guidelines に寄せている（2026-10）:
//   ・内容を主役にする。枠線・影・色は控えめにし、白い面と淡い灰色の地だけで区切る
//   ・上の帯は半透明（すりガラス）。本文が下を流れても、帯は軽いまま
//   ・ボタンは「塗りの青（その画面でいちばん押してほしい1つ）」と「灰色の塗り（それ以外）」の2種類
//   ・タブは区切り型（セグメント）。選んだ方が白く浮く
//   ・文字はシステムの書体（SF / ヒラギノ）。見出しは少し詰め、数字は桁を揃える
// ブランド色（青）は主ボタンと、選んでいる場所の印だけに使う。「待ち」の黄色（--c-wait*）とは別の色。

export const CSS = `
:root{
  /* ---- 色 ---- */
  --c-bg:#F5F5F7; --c-surface:#FFFFFF; --c-surface-2:#FAFAFC;
  --c-ink:#1D1D1F; --c-ink-2:#424245; --c-ink-3:#6E6E73;
  --c-line:#E3E3E8; --c-line-strong:#D2D2D7;
  --c-brand:#0071E3; --c-brand-hover:#0077ED; --c-brand-ink:#FFFFFF; --c-brand-bg:#EAF3FE; --c-nav:#1D1D1F;
  --c-fill:rgba(118,118,128,.12); --c-fill-hover:rgba(118,118,128,.2);
  --c-ok:#1B7F37;   --c-ok-bg:#E4F6E9;
  --c-ng:#D70015;   --c-ng-bg:#FFEBEC;
  --c-wait:#8F5A00; --c-wait-bg:#FFF4D6; --c-wait-dot:#FFB800;
  --c-info:#0058C4; --c-info-bg:#E8F2FF;
  --c-off:#6E6E73;  --c-off-bg:#EFEFF2;
  --c-warn:#B54708; --c-warn-bg:#FFF2E2;
  --c-link:#0066CC;
  /* ---- 文字 ---- */
  --fs-base:14px; --fs-sm:12px; --fs-xs:12px; --fs-h1:20px; --fs-h2:16px; --lh:1.6;
  /* ---- 余白・角 ---- */
  --sp-1:4px; --sp-2:8px; --sp-3:12px; --sp-4:16px; --sp-5:24px; --radius:14px; --radius-sm:9px;
  /* ---- 以前の名前（各画面のHTMLが使っている）。意味を保ったまま新しい色に対応させる ---- */
  --honey:var(--c-brand); --honey-50:var(--c-surface-2); --honey-100:var(--c-wait-bg);
  --hive:var(--c-ink); --hive-600:var(--c-ink-2); --hive-200:var(--c-line);
  --bg:var(--c-bg); --ok:var(--c-ok); --ng:var(--c-ng); --warn:var(--c-warn);
}
*{box-sizing:border-box}
/* hidden 属性は必ず効かせる（style="display:flex" などを付けた要素でも隠れるように。拡大表示の黒い幕が出っぱなしになる不具合があった） */
[hidden]{display:none!important}
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP","Yu Gothic UI",sans-serif;background:var(--c-bg);color:var(--c-ink);font-size:var(--fs-base);line-height:var(--lh);-webkit-font-smoothing:antialiased;font-variant-numeric:tabular-nums}
a{color:var(--c-link);text-decoration:none}
a:hover{text-decoration:underline}
/* 線画のアイコン。文字と同じ色・同じ高さで並べる */
.ic{display:inline-block;vertical-align:-3px;flex:none}
.ic.ic-ok{color:var(--c-ok)}
:focus-visible{outline:3px solid rgba(0,113,227,.45);outline-offset:2px;border-radius:6px}

/* ---- 上の帯（ナビ）: 半透明のすりガラス。画面の上に付いてくる ---- */
header.top{position:sticky;top:0;z-index:60;background:rgba(255,255,255,.76);-webkit-backdrop-filter:saturate(180%) blur(20px);backdrop-filter:saturate(180%) blur(20px);border-bottom:1px solid rgba(0,0,0,.08);color:var(--c-ink);padding:8px 20px;display:flex;align-items:center;gap:6px 6px;flex-wrap:wrap}
header.top a{color:var(--c-ink);text-decoration:none;white-space:nowrap}
header.top .logo{display:inline-flex;align-items:center;margin-right:14px}
header.top .logo img{display:block;flex:none;height:24px;width:auto}
header.top nav{display:flex;gap:2px;flex-wrap:wrap;align-items:center}
header.top nav a{padding:6px 12px;border-radius:8px;font-weight:500;color:var(--c-ink-2);display:inline-flex;align-items:center;transition:background .15s,color .15s}
header.top nav a:hover{background:var(--c-fill);color:var(--c-ink)}
header.top nav a.on{background:var(--c-fill);color:var(--c-ink);font-weight:600}
header.top nav a .badge{display:inline-block;background:var(--c-ng);color:#fff;font-size:11px;font-weight:700;border-radius:999px;padding:0 6px;margin-left:6px;line-height:1.6;min-width:18px;text-align:center}
header.top .right{margin-left:auto;display:flex;gap:14px;align-items:center;font-size:var(--fs-sm);color:var(--c-ink-3)}
header.top .right a{color:var(--c-ink-3)}
header.top .right a:hover{color:var(--c-ink)}
header.top a.upd{background:var(--c-brand);color:var(--c-brand-ink);font-weight:600;padding:4px 12px;border-radius:999px}
@media (max-width:760px){header.top{position:static}}

/* ---- 設定の中のタブ: 区切り型（選んだ方が白く浮く）---- */
.subnav{display:inline-flex;gap:2px;flex-wrap:wrap;background:var(--c-fill);border-radius:10px;padding:2px;margin:0 0 20px;max-width:100%}
.subnav a{padding:6px 14px;text-decoration:none;color:var(--c-ink);font-weight:500;font-size:13px;border-radius:8px;white-space:nowrap}
.subnav a:hover{text-decoration:none;background:rgba(255,255,255,.5)}
.subnav a.on{background:#fff;font-weight:600;box-shadow:0 1px 3px rgba(0,0,0,.12),0 0 0 .5px rgba(0,0,0,.04)}

/* ---- 本文 ---- */
main{max-width:1120px;margin:0 auto;padding:24px 20px 80px}
h1{font-size:26px;font-weight:700;letter-spacing:-.01em;margin:4px 0 16px;line-height:1.3}
h2{font-size:17px;font-weight:600;letter-spacing:-.005em;margin:24px 0 8px;line-height:1.45}
/* 面: 枠線ではなく、淡い灰色の地の上に白い面を置いて区切る */
.card{background:var(--c-surface);border:1px solid rgba(0,0,0,.04);border-radius:var(--radius);padding:18px 20px;margin-bottom:16px;box-shadow:0 1px 2px rgba(0,0,0,.03)}
.card.note{background:var(--c-warn-bg);border-color:transparent}
.card.testcard{background:var(--c-surface-2)}
label{display:block;font-weight:600;font-size:13px;margin:14px 0 5px}
input[type=text],input[type=number],input[type=url],input[type=email],input[type=password],textarea,select{width:100%;padding:8px 11px;border:1px solid var(--c-line-strong);border-radius:var(--radius-sm);font:inherit;background:#fff;color:var(--c-ink);transition:border-color .15s,box-shadow .15s}
input:focus,textarea:focus,select:focus{outline:0;border-color:var(--c-brand);box-shadow:0 0 0 4px rgba(0,113,227,.18)}
input[type=checkbox],input[type=radio]{accent-color:var(--c-brand);width:16px;height:16px;vertical-align:-3px}
textarea{min-height:140px}
.row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:14px}
.row3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}

/* ---- ボタン: 塗りの青は「その画面でいちばん押してほしい1つ」だけ（#112）。それ以外は灰色の塗り ---- */
.btn{display:inline-block;background:var(--c-fill);color:var(--c-ink);border:0;padding:7px 14px;border-radius:var(--radius-sm);cursor:pointer;text-decoration:none;font:inherit;font-weight:500;line-height:1.4;transition:background .15s,transform .1s}
.btn:hover{background:var(--c-fill-hover);text-decoration:none}
.btn:active{transform:scale(.98)}
.btn.primary{background:var(--c-brand);color:var(--c-brand-ink);font-weight:600}
.btn.primary:hover{background:var(--c-brand-hover)}
.btn.sub{font-weight:500}
.btn.danger{background:var(--c-ng-bg);color:var(--c-ng)}
.btn.danger:hover{background:#FFDADC}
.btn.small{padding:4px 11px;font-size:var(--fs-sm);border-radius:7px}
.btn[disabled]{opacity:.45;cursor:not-allowed}

/* ---- 表 ---- */
table{width:100%;border-collapse:collapse;background:var(--c-surface)}
th,td{border-bottom:1px solid var(--c-line);padding:9px 10px;text-align:left;vertical-align:top}
th{background:transparent;font-size:var(--fs-xs);color:var(--c-ink-3);font-weight:600}
main>table,main>form>table{border-radius:var(--radius);overflow:hidden}
tbody tr:last-child td{border-bottom:0}
th a{color:inherit}
tr.hl td{background:var(--c-brand-bg)}tr.hl td:first-child{box-shadow:inset 3px 0 0 var(--c-brand)}
tr.histrow td{background:var(--c-surface-2);border-bottom:1px dashed var(--c-line)}

/* ---- 詰めた一覧: 1社＝1段（要対応・送信一覧）。以前は1社が3段で、32社で画面4つ分あった ---- */
table.dense{table-layout:fixed}
main>table.dense,main>form>table.dense{overflow:visible}
table.dense td{padding:7px 10px;vertical-align:middle}
table.dense td.cut{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
table.dense td.cut .muted{margin-left:6px}
table.dense td.acts{white-space:nowrap;text-align:right;overflow:visible}
table.dense tr:hover td{background:var(--c-surface-2)}
tr.sep td{background:var(--c-bg);font-size:var(--fs-xs);color:var(--c-ink-3);font-weight:600;padding:5px 10px}
/* ---- ホームのキャンペーン1件ぶん: 名前・進み具合・数字を1行ずつ（以前は数字のタイルが6つ並んでいた）---- */
.hrow{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1.4fr);gap:8px 28px;align-items:center;padding:14px 20px}
.hrow+.hrow{border-top:1px solid var(--c-line)}
.hrow h2{margin:0;font-size:16px}
.hrow .state{margin-top:2px}
.hrow .nums{display:flex;gap:6px 18px;flex-wrap:wrap;margin-top:8px;font-size:var(--fs-sm)}
.hrow .nums a{color:var(--c-ink-2);text-decoration:none;white-space:nowrap}
.hrow .nums a:hover{color:var(--c-ink)}
.hrow .nums b{font-size:15px;color:var(--c-ink);margin-left:3px}
.hrow .bar{max-width:none;margin:6px 0 4px}
@media (max-width:760px){.hrow{grid-template-columns:1fr}}
.pagehead{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin:4px 0 16px}
.pagehead h1{margin:0}
/* ---- 「…」メニュー: 主な操作だけをボタンで出し、残りはここに畳む ---- */
.menu{position:relative;display:inline-block;vertical-align:middle}
.menu>summary{list-style:none;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;min-width:30px;height:28px;padding:0 8px;border-radius:7px;background:var(--c-fill);color:var(--c-ink-2);font-weight:700;letter-spacing:.08em;line-height:1}
.menu>summary::-webkit-details-marker{display:none}
.menu>summary:hover,.menu[open]>summary{background:var(--c-fill-hover)}
.menu>.pop{position:absolute;right:0;top:calc(100% + 4px);z-index:40;min-width:190px;background:rgba(255,255,255,.96);-webkit-backdrop-filter:blur(20px);backdrop-filter:blur(20px);border:1px solid rgba(0,0,0,.08);border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.16);padding:5px;display:grid;gap:1px;text-align:left}
.menu>.pop form{display:block;margin:0}
.menu>.pop .btn,.menu>.pop a.btn{display:block;width:100%;text-align:left;background:transparent;font-weight:400;padding:7px 10px;border-radius:7px;color:var(--c-ink);font-size:var(--fs-base);text-decoration:none}
.menu>.pop .btn:hover{background:var(--c-fill)}
.menu>.pop .btn.danger{color:var(--c-ng);background:transparent}
.menu>.pop hr{border:0;border-top:1px solid var(--c-line);margin:4px 6px}
/* ---- まとめて操作の帯: 会社を選んだときだけ、画面の下に出す ---- */
.bulkbar{position:sticky;bottom:14px;z-index:30;display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:12px auto 0;padding:10px 14px;background:rgba(29,29,31,.92);color:#fff;border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.25);-webkit-backdrop-filter:blur(20px);backdrop-filter:blur(20px);width:fit-content;max-width:100%}
.bulkbar .btn{background:rgba(255,255,255,.16);color:#fff}
.bulkbar .btn:hover{background:rgba(255,255,255,.26)}
.bulkbar .btn.danger{background:rgba(255,69,58,.28);color:#fff}
.bulkbar label{color:#fff;font-weight:400;margin:0;font-size:var(--fs-sm);display:inline-flex;gap:6px;align-items:center}
.bulkbar select{width:auto}

/* ---- 状態の札（色の意味は全画面共通：#111）---- */
.tag{display:inline-block;padding:2px 9px;border-radius:6px;font-size:var(--fs-xs);font-weight:600;background:var(--c-off-bg);color:var(--c-off);white-space:nowrap}
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
.stat{background:var(--c-surface-2);border:0;border-radius:12px;padding:12px 16px;min-width:120px}
.stat b{display:block;font-size:22px;line-height:1.3;font-variant-numeric:tabular-nums}
.stat .unit{font-size:var(--fs-xs);font-weight:400;margin-left:2px}

/* ---- キャンペーンの概要（進み具合・返信・ペース）----
   以前は同じ大きさの枠が10個並び、どれが大事か分からなかった。大きい数字は3つだけにして、内訳は小さく出す */
.meta{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 12px;font-size:var(--fs-sm);color:var(--c-ink-2)}
.meta>span{background:var(--c-fill);border:0;border-radius:7px;padding:2px 10px;white-space:nowrap}
.meta>span.warn{background:var(--c-warn-bg);color:var(--c-warn);font-weight:600}
.ov{padding:14px 18px;margin-bottom:12px}
.ovhead{display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap;margin-bottom:10px}
.ovhead b{font-size:var(--fs-base)}
.ovhead a,.ovhead .muted{font-size:var(--fs-sm)}
.ovbar{display:flex;gap:2px;height:8px;border-radius:999px;overflow:hidden;background:var(--c-off-bg);margin-bottom:12px}
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
.chip{display:inline-block;background:var(--c-off-bg);color:var(--c-ink-2);border-radius:7px;padding:2px 10px;font-size:var(--fs-sm);text-decoration:none;white-space:nowrap}
.chip:hover{background:var(--c-line)}
.chip.ng{background:var(--c-ng-bg);color:var(--c-ng)}
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
.flash{background:var(--c-info-bg);border:0;color:#003E8A;padding:12px 16px;border-radius:12px;margin-bottom:16px}
.muted{color:var(--c-ink-3);font-size:var(--fs-sm)}
.small{font-size:var(--fs-sm)}
pre{white-space:pre-wrap;background:var(--c-surface-2);padding:12px;border-radius:var(--radius-sm);font-size:var(--fs-sm);border:1px solid var(--c-line)}
.inline{display:inline}
.spin{display:inline-block;width:12px;height:12px;border:2px solid #90CAF9;border-top-color:#1565C0;border-radius:50%;animation:sp .9s linear infinite;vertical-align:-1px;margin-right:6px}@keyframes sp{to{transform:rotate(360deg)}}
.bar{height:8px;background:var(--c-off-bg);border-radius:999px;overflow:hidden;margin:8px 0 4px;max-width:620px}
.bar i{display:block;height:100%;background:var(--c-ok);border-radius:999px;transition:width .6s ease}
.histbtn{background:var(--c-fill);border:0;border-radius:7px;padding:1px 9px;font-size:12px;color:var(--c-ink-2);cursor:pointer;margin-top:3px}

/* ---- 説明文の折りたたみ（#99）。長い説明は「？」を押したときだけ出す ---- */
.helpbtn{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;border:0;background:var(--c-fill);color:var(--c-ink-2);font-size:13px;font-weight:700;cursor:pointer;margin:2px 0 6px;vertical-align:middle;line-height:1;padding:0}
.helpbtn:hover{border-color:var(--c-ink-3)}
.helpbtn[aria-expanded="true"]{background:var(--c-ink);color:#fff;border-color:var(--c-ink)}
.helpbtn + .helplabel{font-size:var(--fs-xs);color:var(--c-ink-3);margin-left:6px;cursor:pointer}
.helpbody[hidden]{display:none}
.helpbody{border-left:3px solid var(--c-line);padding:2px 0 2px 12px;margin:4px 0 10px}

/* ---- タブ（キャンペーン画面：#98）: 区切り型 ---- */
.tabs{display:inline-flex;gap:2px;background:var(--c-fill);border-radius:10px;padding:2px;margin:16px 0 18px;flex-wrap:wrap;max-width:100%}
.tabs a{padding:7px 18px;text-decoration:none;color:var(--c-ink);font-weight:500;border-radius:8px;white-space:nowrap}
.tabs a:hover{text-decoration:none;background:rgba(255,255,255,.5)}
.tabs a.on{background:#fff;font-weight:600;box-shadow:0 1px 3px rgba(0,0,0,.12),0 0 0 .5px rgba(0,0,0,.04)}
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
