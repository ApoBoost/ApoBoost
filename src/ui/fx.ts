// 見た目の演出。ログイン画面の地球（Spline の3Dの場面）と、開いたときの短い動きだけ。
//
// 消し方: このファイルを消し、layout.ts・account.ts の「fx.js」を読んでいる行（import と ${FX_...}）を外すだけ。
// すぐ止めたいだけなら、下の FX_ENABLED を false にする。
//
// 守っていること:
//  - 道具としての使いやすさを優先する。内容は最初から全部見えている（スクロールで現れる演出は、一覧が空白に見えたのでやめた）
//  - ライブラリは CDN から読む。読めないとき（オフライン等）は何も起きず、これまでどおりの画面になる
//  - 「動きを減らす」設定のPCでは動かさない
const FX_ENABLED = true;


/** ログイン後の全画面に入れるもの。
 *  以前はここで、スクロールで現れる動き（GSAP ScrollTrigger）・進み具合の線・紺の帯を足していたが、やめた。
 *  長い一覧（要対応・送信一覧）の下側が、開いた瞬間は透明で空白に見え、道具としては逆効果だったため。
 *  いまは、開いたときに上から短くふわっと出す動きだけ（内容は最初から全部見えている） */
export const FX_APP = !FX_ENABLED ? "" : `<style>
@media (prefers-reduced-motion:no-preference){
  main>*{animation:fx-rise .32s cubic-bezier(.2,.8,.2,1) backwards}
  main>*:nth-child(2){animation-delay:.03s}main>*:nth-child(3){animation-delay:.06s}main>*:nth-child(n+4){animation-delay:.09s}
}
@keyframes fx-rise{from{opacity:0;transform:translateY(6px)}}
</style>`;

/** ログイン画面に入れるもの（</body> の直前）。
 *  左の紺の面に、Spline で作った3Dの場面（地球）を出す。Spline の表示用の部品（spline-viewer）と場面のファイルは、どちらもネットから読む。
 *  読めないとき（オフライン等）は紺の面だけが残り、ログインはこれまでどおりできる。
 *  以前は Three.js で点々の地球儀を自前で描いていた（2026-10-12 に Spline の場面に差し替え） */
const SPLINE_VIEWER_URL = "https://unpkg.com/@splinetool/viewer@2.0.75/build/spline-viewer.js";
const SPLINE_SCENE_URL = "https://prod.spline.design/FGPTzKNAk1crABKc/scene.splinecode";
export const FX_LOGIN = !FX_ENABLED ? "" : `<style>
#fx-globe{position:fixed;left:0;top:0;bottom:0;width:56vw;background:radial-gradient(120% 90% at 30% 20%,#0A3A8C 0%,#062256 45%,#041A44 100%);overflow:hidden;z-index:0}
#fx-globe spline-viewer{position:absolute;inset:0;width:100%;height:100%;opacity:0;transition:opacity 1.2s}
#fx-globe spline-viewer.on{opacity:1}
.box{position:relative;z-index:1;box-shadow:0 1px 2px rgba(6,34,86,.05),0 24px 60px -24px rgba(6,34,86,.35)}
@media (min-width:900px){body{padding-left:56vw}}
/* 狭い画面では地球を全面の背景にして、その上にログインの箱を置く */
@media (max-width:899px){#fx-globe{width:100%}}
</style>
<div id="fx-globe" aria-hidden="true"><spline-viewer url="${SPLINE_SCENE_URL}" loading-anim-type="none"></spline-viewer></div>
<script type="module" src="${SPLINE_VIEWER_URL}"></script>
<script>
// 場面を読み終わってから表示する（読み込み途中の白い四角を見せない）。読み終わりの合図が来ないときも、数秒後には出す
(function () {
  var v = document.querySelector("#fx-globe spline-viewer");
  if (!v) return;
  // 読み込み直後は描く大きさが決まっておらず、何も映らないことがある（実際に起きた）。画面の大きさが変わったと知らせて、描き直させる
  var refit = function () { window.dispatchEvent(new Event("resize")); };
  var show = function () { refit(); requestAnimationFrame(refit); setTimeout(refit, 300); v.classList.add("on"); };
  v.addEventListener("load-complete", show);
  setTimeout(show, 6000);
})();
</script>`;
