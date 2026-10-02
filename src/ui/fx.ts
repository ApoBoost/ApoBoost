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
// 陸と海を塗り分けた世界地図（海＝白・陸＝黒）。ログイン画面の地球儀で、点を置く場所を決めるのに使う
const EARTH_URL = "https://cdn.jsdelivr.net/npm/three-globe/example/img/earth-water.png";
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

/** ログイン画面に入れるもの（</body> の直前）。
 *  左に紺の面を出し、点々で描いた地球儀の上を、メール（光る点と線の尾）が東京から世界へ弧を描いて飛ぶ。
 *  陸地の形は、CDN の地図画像（海＝白・陸＝黒）を読んで点を置く場所を決める。読めないときは球全体に点を置く */
export const FX_LOGIN = !FX_ENABLED ? "" : `<style>
#fx-globe{position:fixed;left:0;top:0;bottom:0;width:56vw;background:radial-gradient(120% 90% at 30% 20%,#0A3A8C 0%,#062256 45%,#041A44 100%);overflow:hidden;z-index:0}
#fx-globe canvas{position:absolute;inset:0;width:100%;height:100%;opacity:0;transition:opacity 1.4s}
#fx-globe canvas.on{opacity:1}
.box{position:relative;z-index:1;box-shadow:0 1px 2px rgba(6,34,86,.05),0 24px 60px -24px rgba(6,34,86,.35)}
@media (min-width:900px){body{padding-left:56vw}}
/* 狭い画面では地球儀を全面の背景にして、その上にログインの箱を置く */
@media (max-width:899px){#fx-globe{width:100%}}
</style>
<div id="fx-globe" aria-hidden="true"><canvas></canvas></div>
<script type="module">
import * as THREE from "${THREE_URL}";
(()=>{
  const wrap=document.getElementById("fx-globe"),canvas=wrap.querySelector("canvas");
  const still=matchMedia("(prefers-reduced-motion:reduce)").matches;
  let renderer;
  try{renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true});}catch(e){return;}
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));
  const scene=new THREE.Scene();
  const cam=new THREE.PerspectiveCamera(38,1,.1,50);cam.position.set(0,0,3.6);
  const globe=new THREE.Group();scene.add(globe);
  const RAD=Math.PI/180;
  // 緯度・経度 → 球の上の位置（経度0が手前）
  const at=(lat,lon,r)=>new THREE.Vector3(Math.cos(lat*RAD)*Math.sin(lon*RAD)*r,Math.sin(lat*RAD)*r,Math.cos(lat*RAD)*Math.cos(lon*RAD)*r);
  // 最初は日本が手前に来る向き。少しうつむかせて北半球を見せる
  globe.rotation.y=-138*RAD;
  const tilt=new THREE.Group();tilt.rotation.x=22*RAD;tilt.rotation.z=-8*RAD;scene.remove(globe);tilt.add(globe);scene.add(tilt);

  // 裏側の点や弧が透けないよう、中に紺の球を入れる
  globe.add(new THREE.Mesh(new THREE.SphereGeometry(.985,48,48),new THREE.MeshBasicMaterial({color:0x06235A})));
  // 輪郭をうっすら光らせる
  const halo=new THREE.Mesh(new THREE.SphereGeometry(1.06,48,48),new THREE.MeshBasicMaterial({color:0x2F86FF,transparent:true,opacity:.07,side:THREE.BackSide}));
  tilt.add(halo);

  // 点々の地図
  const dotMat=new THREE.PointsMaterial({color:0x8CC4FF,size:.016,transparent:true,opacity:.95,depthWrite:false});
  let dots=null;
  const buildDots=(isLand)=>{
    const N=isLand?26000:5000,arr=[];
    for(let i=0;i<N;i++){ // 球の上にほぼ等間隔に点を置く
      const y=1-(i+.5)/N*2,r=Math.sqrt(1-y*y),th=i*2.399963229728653;
      const lat=Math.asin(y)/RAD,lon=((th/RAD)%360+540)%360-180;
      if(isLand&&!isLand(lat,lon))continue;
      const v=at(lat,lon,1);arr.push(v.x,v.y,v.z);
    }
    if(dots)globe.remove(dots);
    const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.BufferAttribute(new Float32Array(arr),3));
    dots=new THREE.Points(g,dotMat);globe.add(dots);
  };
  buildDots(null);dotMat.opacity=.35;
  const img=new Image();img.crossOrigin="anonymous";
  img.onload=()=>{try{
    const c=document.createElement("canvas");c.width=720;c.height=360;const x=c.getContext("2d",{willReadFrequently:true});x.drawImage(img,0,0,720,360);
    const d=x.getImageData(0,0,720,360).data;
    const land=(lat,lon)=>{const u=Math.min(719,Math.floor((lon+180)/360*720)),v=Math.min(359,Math.floor((90-lat)/180*360));return d[(v*720+u)*4]<90;};
    buildDots(land);dotMat.opacity=.95;if(still)renderer.render(scene,cam);
  }catch(e){}};
  img.src="${EARTH_URL}";

  // 東京から世界のあちこちへ飛ぶメール。封筒の絵は目立ちすぎたので、先頭の光る点と、後ろに続く線の尾で表す
  const HOME=[35.7,139.7];
  const CITIES=[[37.6,127],[31.2,121.5],[39.9,116.4],[22.3,114.2],[1.35,103.8],[13.7,100.5],[28.6,77.2],[19.1,72.9],[25.2,55.3],[55.7,37.6],[52.5,13.4],[48.9,2.3],[51.5,-.1],[40.4,-3.7],[41.9,12.5],[30,31.2],[-1.3,36.8],[-33.9,18.4],[40.7,-74],[37.8,-122.4],[34,-118.2],[41.9,-87.6],[19.4,-99.1],[-23.5,-46.6],[-34.6,-58.4],[-33.9,151.2],[-36.8,174.8],[21.3,-157.9],[49.3,-123.1],[-6.2,106.8],[14.6,121],[61.2,-149.9],[64.1,-21.9]];
  const dot=document.createElement("canvas");dot.width=dot.height=64;
  {const x=dot.getContext("2d"),g=x.createRadialGradient(32,32,0,32,32,32);g.addColorStop(0,"rgba(255,255,255,1)");g.addColorStop(.25,"rgba(190,235,255,.95)");g.addColorStop(1,"rgba(120,200,255,0)");x.fillStyle=g;x.fillRect(0,0,64,64);}
  const dotTex=new THREE.CanvasTexture(dot);
  // 出発地（東京）の印。小さな点と、広がって消える輪
  const home=at(HOME[0],HOME[1],1.006);
  const homeDot=new THREE.Sprite(new THREE.SpriteMaterial({map:dotTex,transparent:true,depthWrite:false}));homeDot.scale.set(.06,.06,1);homeDot.position.copy(home);
  const pulse=new THREE.Sprite(new THREE.SpriteMaterial({map:dotTex,transparent:true,depthWrite:false,opacity:.5}));pulse.position.copy(home);
  globe.add(homeDot,pulse);
  const SEG=90,mails=[];
  const trailMat=new THREE.LineBasicMaterial({color:0x9BE8FF,transparent:true,opacity:.75,depthWrite:false});
  let lastTo=-1;
  const launch=(m)=>{
    let k=lastTo;while(k===lastTo)k=Math.floor(Math.random()*CITIES.length);lastTo=k; // 続けて同じ行き先にしない
    const b=CITIES[k],p=at(HOME[0],HOME[1],1),q=at(b[0],b[1],1),ang=p.angleTo(q),h=.08+ang*.16;
    for(let i=0;i<=SEG;i++){const t=i/SEG,v=p.clone().multiplyScalar(Math.sin((1-t)*ang)/Math.sin(ang)).add(q.clone().multiplyScalar(Math.sin(t*ang)/Math.sin(ang)));
      v.multiplyScalar(1.005+Math.sin(Math.PI*t)*h);m.pts[i]=v;m.pos.set([v.x,v.y,v.z],i*3);}
    m.line.geometry.attributes.position.needsUpdate=true;
    m.t=0;m.speed=(.55+Math.random()*.5)/(1+ang*1.2);m.wait=0;
  };
  for(let i=0;i<14;i++){
    const pos=new Float32Array((SEG+1)*3),g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.BufferAttribute(pos,3));
    const line=new THREE.Line(g,trailMat);line.frustumCulled=false;
    const head=new THREE.Sprite(new THREE.SpriteMaterial({map:dotTex,transparent:true,depthWrite:false}));head.scale.set(.05,.05,1);
    const m={line,head,pos,pts:[],t:0,speed:1,wait:Math.random()*3};
    globe.add(line,head);line.visible=head.visible=false;mails.push(m);
  }
  const stepMail=(m,dt)=>{
    if(m.wait>0){m.wait-=dt;if(m.wait<=0){launch(m);m.line.visible=m.head.visible=true;}return;}
    m.t+=m.speed*dt;
    const tail=.32,hi=Math.min(1,m.t),lo=Math.max(0,m.t-tail); // 尾は先頭の少し後ろまで。着いたあとは尾だけが縮んで消える
    const i0=Math.floor(lo*SEG),i1=Math.floor(hi*SEG);
    m.line.geometry.setDrawRange(i0,Math.max(0,i1-i0+1));
    const f=hi*SEG,k=Math.min(SEG-1,Math.floor(f));m.head.position.lerpVectors(m.pts[k],m.pts[k+1],f-k);
    m.head.visible=m.t<1;m.head.material.opacity=Math.min(1,m.t*8,(1-m.t)*8+.2);
    if(m.t>1+tail){m.line.visible=false;m.wait=.2+Math.random()*1.6;}
  };

  const fit=()=>{const w=wrap.clientWidth,h=wrap.clientHeight;renderer.setSize(w,h,false);cam.aspect=w/h;cam.position.z=w/h<1?4.4:3.6;cam.updateProjectionMatrix();};
  fit();new ResizeObserver(fit).observe(wrap);
  let mx=0,my=0;addEventListener("pointermove",(e)=>{mx=e.clientX/innerWidth-.5;my=e.clientY/innerHeight-.5;},{passive:true});
  let last=performance.now();
  const draw=(now)=>{
    const dt=Math.min((now-last)/1000,.1);last=now;
    // ぐるぐる回さず、日本を中心に左右へゆっくり振る（メールが飛ぶ様子がいつも手前に見えるように）
    globe.rotation.y=(-138+Math.sin(now/1000*.07)*28)*RAD;
    tilt.rotation.x+=((22+my*10)*RAD-tilt.rotation.x)*.04;tilt.rotation.y+=(mx*.25-tilt.rotation.y)*.04;
    for(const m of mails)stepMail(m,dt);
    const pp=(now/1000*.6)%1;pulse.scale.setScalar(.05+pp*.2);pulse.material.opacity=.55*(1-pp);
    renderer.render(scene,cam);
    if(!still)requestAnimationFrame(draw);
  };
  draw(performance.now());canvas.classList.add("on");
})();
</script>`;
