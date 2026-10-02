// 見た目の演出（お試し）。Three.js と GSAP ScrollTrigger を使う。
//
// 消し方: このファイルを消し、layout.ts と account.ts の「fx.js」を読んでいる行（import と ${FX_...}）を外すだけ。
// すぐ止めたいだけなら、下の FX_ENABLED を false にする。
//
// 作るときに守ったこと:
//  - 道具としての使いやすさを優先する。最初から見えている部分は待たせない（CSSで一瞬ふわっと出すだけ）。
//    スクロールして出てくる部分だけを ScrollTrigger で動かす。
//  - ライブラリは CDN から読む（配布物を重くしない・npm install を増やさない）。
//    読めないとき（オフライン等）は何も起きず、これまでどおりの画面になる。中身を隠すのは読めた後だけ。
//  - 「動きを減らす」設定のPCでは動かさない。印刷のときは必ず全部見えるようにする。
const FX_ENABLED = true;

const THREE_URL = "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js";
const GSAP_URL = "https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js";
const ST_URL = "https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/ScrollTrigger.min.js";

/** ログイン後の全画面に入れるもの（</body> の直前） */
export const FX_APP = !FX_ENABLED ? "" : `<style>
/* 最初から見えている部分: 上から順に、短くふわっと出す（backwards なので、終わった後は他の指定を邪魔しない） */
@media (prefers-reduced-motion:no-preference){
  main>*{animation:fx-rise .42s cubic-bezier(.2,.8,.2,1) backwards}
  main>*:nth-child(2){animation-delay:.04s}main>*:nth-child(3){animation-delay:.08s}main>*:nth-child(4){animation-delay:.12s}
  main>*:nth-child(5){animation-delay:.16s}main>*:nth-child(n+6){animation-delay:.2s}
  main>.fx-sr{animation:none}
}
@keyframes fx-rise{from{opacity:0;transform:translateY(10px)}}
/* カード: 影をごく薄く付け、載せると少しだけ持ち上がる */
.card{box-shadow:0 1px 2px rgba(6,34,86,.04),0 8px 24px -16px rgba(6,34,86,.18);transition:box-shadow .25s,border-color .25s}
.card:hover{box-shadow:0 1px 2px rgba(6,34,86,.05),0 14px 32px -16px rgba(6,34,86,.28)}
/* 上の帯: 画面に付いてくる。スクロールすると影が出る（奥に粒を流す演出は「宇宙みたい」で合わなかったのでやめた） */
@media (min-width:761px){header.top{position:sticky;top:0;z-index:60;transition:box-shadow .25s}}
header.top{background:linear-gradient(100deg,#041A44,#062256 45%,#0A3A8C)}
header.top.fx-scrolled{box-shadow:0 8px 24px -10px rgba(4,26,68,.55)}
/* 読み進み具合の細い線 */
#fx-progress{position:fixed;left:0;top:0;height:2px;width:100%;z-index:70;transform:scaleX(0);transform-origin:0 50%;background:linear-gradient(90deg,#0A66E8,#12C8F0);pointer-events:none}
@media print{#fx-progress{display:none!important}main *{opacity:1!important;transform:none!important}}
</style>
<script>
// スクロールで出てくる部分だけを動かす（GSAP ScrollTrigger）。読めなければ何もしない。
(()=>{
  if(matchMedia("(prefers-reduced-motion:reduce)").matches)return;
  const load=(src)=>new Promise((ok,ng)=>{const s=document.createElement("script");s.src=src;s.onload=ok;s.onerror=ng;document.head.appendChild(s);});
  load("${GSAP_URL}").then(()=>load("${ST_URL}")).then(()=>{
    const gsap=window.gsap,ST=window.ScrollTrigger;if(!gsap||!ST)return;
    gsap.registerPlugin(ST);
    const head=document.querySelector("header.top");
    if(head)ST.create({start:8,end:"max",onToggle:(t)=>head.classList.toggle("fx-scrolled",t.isActive)});
    // 読み進み具合の線（スクロールできる長さのある画面だけ）
    if(document.documentElement.scrollHeight>innerHeight+200){
      const bar=document.createElement("div");bar.id="fx-progress";document.body.appendChild(bar);
      gsap.to(bar,{scaleX:1,ease:"none",scrollTrigger:{start:0,end:"max",scrub:.3}});
    }
    // いま画面の外（下）にあるものだけ、入ってきたときに下からふわっと出す。
    // カードの中の表やカードは、外側のカードと一緒に動くので対象にしない
    const all=Array.from(document.querySelectorAll("main .card, main table, main .stats, main .ovgrid, main h2"));
    const targets=all.filter((el)=>!el.parentElement.closest(".card, table")&&el.getBoundingClientRect().top>innerHeight*.96);
    if(!targets.length)return;
    targets.forEach((el)=>el.classList.add("fx-sr"));
    gsap.set(targets,{opacity:0,y:26});
    ST.batch(targets,{start:"top 94%",once:true,onEnter:(els)=>gsap.to(els,{opacity:1,y:0,duration:.6,ease:"power3.out",stagger:.07,overwrite:true,clearProps:"opacity,transform"})});
    // 印刷や、万一の取りこぼしで中身が隠れたままにならないようにする
    const showAll=()=>gsap.set(targets,{clearProps:"opacity,transform"});
    addEventListener("beforeprint",showAll);
    // ページ内リンク（#fix など）で飛んだ先が隠れていないように
    addEventListener("hashchange",()=>ST.refresh());
  }).catch(()=>{});
})();
</script>`;

/** ログイン画面に入れるもの（</body> の直前）。背景で紙飛行機と粒の波がゆっくり動く */
export const FX_LOGIN = !FX_ENABLED ? "" : `<style>
canvas#fx-bg{position:fixed;inset:0;width:100%;height:100%;z-index:0;pointer-events:none;opacity:0;transition:opacity 1.2s}
canvas#fx-bg.on{opacity:1}
.box{position:relative;z-index:1;background:rgba(255,255,255,.86);-webkit-backdrop-filter:blur(14px) saturate(1.2);backdrop-filter:blur(14px) saturate(1.2);border-color:rgba(255,255,255,.9);box-shadow:0 1px 2px rgba(6,34,86,.05),0 24px 60px -24px rgba(6,34,86,.35)}
</style>
<canvas id="fx-bg" aria-hidden="true"></canvas>
<script type="module">
import * as THREE from "${THREE_URL}";
(()=>{
  const canvas=document.getElementById("fx-bg");
  const still=matchMedia("(prefers-reduced-motion:reduce)").matches;
  let renderer;
  try{renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true});}catch(e){canvas.remove();return;}
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));
  const scene=new THREE.Scene();
  const cam=new THREE.PerspectiveCamera(50,1,.1,100);cam.position.set(0,1.6,9);cam.lookAt(0,0,0);

  // 粒の波（奥へ広がる床）
  const W=110,D=46,pos=new Float32Array(W*D*3);
  for(let z=0;z<D;z++)for(let x=0;x<W;x++){const i=(z*W+x)*3;pos[i]=(x-W/2)*.34;pos[i+1]=0;pos[i+2]=(z-D/2)*.34-3;}
  const wave=new THREE.BufferGeometry();wave.setAttribute("position",new THREE.BufferAttribute(pos,3));
  const dots=new THREE.Points(wave,new THREE.PointsMaterial({color:0x0A66E8,size:.045,transparent:true,opacity:.5,depthWrite:false}));
  dots.position.y=-2.2;scene.add(dots);

  // 紙飛行機（左右の翼と、下の折り目）
  const tri=(a,b,c)=>[].concat(a,b,c);
  const nose=[0,0,1.1],lt=[-.62,.06,-1],rt=[.62,.06,-1],mid=[0,0,-1],keel=[0,-.3,-1];
  const verts=new Float32Array([].concat(tri(nose,lt,mid),tri(nose,mid,rt),tri(nose,mid,keel)));
  const col=(hex,n)=>{const c=new THREE.Color(hex);const o=[];for(let i=0;i<n;i++)o.push(c.r,c.g,c.b);return o;};
  const cols=new Float32Array([].concat(col(0x0A66E8,3),col(0x3F93FF,3),col(0x062256,3)));
  const pg=new THREE.BufferGeometry();pg.setAttribute("position",new THREE.BufferAttribute(verts,3));pg.setAttribute("color",new THREE.BufferAttribute(cols,3));
  const pm=new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.DoubleSide,transparent:true,opacity:.9});
  const planes=[];
  for(let i=0;i<7;i++){
    const m=new THREE.Mesh(pg,pm);const s=.22+Math.random()*.3;m.scale.setScalar(s);
    m.userData={t:Math.random(),speed:.018+Math.random()*.022,y:-1.5+Math.random()*4.5,z:-6+Math.random()*7,ph:Math.random()*6.28};
    scene.add(m);planes.push(m);
  }
  const place=(m,time)=>{
    const u=m.userData,x=-9+u.t*18;
    m.position.set(x,u.y+u.t*1.6+Math.sin(time*.6+u.ph)*.18,u.z);
    m.rotation.set(-.28+Math.sin(time*.5+u.ph)*.06,Math.PI/2,Math.sin(time*.8+u.ph)*.22,"YXZ");
  };

  const fit=()=>{renderer.setSize(innerWidth,innerHeight,false);cam.aspect=innerWidth/innerHeight;cam.updateProjectionMatrix();};
  fit();addEventListener("resize",fit);
  let mx=0,my=0;addEventListener("pointermove",(e)=>{mx=e.clientX/innerWidth-.5;my=e.clientY/innerHeight-.5;},{passive:true});
  let last=performance.now();
  const draw=(now)=>{
    const time=now/1000,dt=Math.min((now-last)/1000,.1);last=now;
    for(let z=0;z<D;z++)for(let x=0;x<W;x++){const i=(z*W+x)*3;pos[i+1]=Math.sin(x*.22+time*.7)*.22+Math.cos(z*.3+time*.5)*.22;}
    wave.attributes.position.needsUpdate=true;
    for(const m of planes){m.userData.t+=m.userData.speed*dt;if(m.userData.t>1){m.userData.t=0;m.userData.y=-1.5+Math.random()*4.5;}place(m,time);}
    // カーソルに合わせて視点がわずかに動く
    cam.position.x+=(mx*1.2-cam.position.x)*.04;cam.position.y+=(1.6-my*.8-cam.position.y)*.04;cam.lookAt(0,0,0);
    renderer.render(scene,cam);
    if(!still)requestAnimationFrame(draw);
  };
  draw(performance.now());canvas.classList.add("on");
})();
</script>`;
