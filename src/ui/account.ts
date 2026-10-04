// ログインとパスワード変更
import { STATUS_LABEL, OUTCOME_LABEL, CHANNEL_LABEL, channelMode, jst, type Campaign, type Job, type SenderProfile, type JobStatus } from "../db.js";
import { AI_MODELS, type Lint } from "../message.js";
import { TEMPLATE_LIBRARY } from "../templates.js";
import { esc, layout, n, type NavUser } from "./layout.js";
import { post } from "./parts.js";
import { FX_LOGIN } from "./fx.js";

// ================= ログイン関連の画面 =================

/** ログイン画面（ヘッダー無しの独立レイアウト） */
export function loginPage(opts: { error?: string; next?: string } = {}): string {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ログイン | ApoBoost</title>
<style>
body{margin:0;font-family:-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif;background:#F5F5F7;color:#1D1D1F;-webkit-font-smoothing:antialiased;display:flex;align-items:center;justify-content:center;min-height:100vh;font-size:14px}
.box{background:#fff;border:1px solid rgba(0,0,0,.04);border-radius:18px;padding:36px 32px;width:348px;box-shadow:0 2px 16px rgba(0,0,0,.06)}
h1{margin:0 0 6px;text-align:center}
.sub{text-align:center;color:#6E6E73;font-size:13px;margin:0 0 22px}
label{display:block;font-size:12px;color:#6E6E73;margin:12px 0 4px}
input{width:100%;padding:10px 12px;border:1px solid #D2D2D7;border-radius:10px;font-size:15px}
button{width:100%;margin-top:20px;padding:11px;background:#0071E3;color:#fff;border:0;border-radius:10px;font-weight:600;font-size:15px;cursor:pointer}
.err{background:#FDECEA;color:#C62828;border-radius:8px;padding:9px 12px;font-size:13px;margin-bottom:6px}
.mark{display:block}
*{box-sizing:border-box}
/* ---- 動き：開いたときにロゴが左から飛んできて、光が1度だけ横切る ---- */
.box{animation:up .5s ease-out both}
.logo{position:relative;display:inline-block;vertical-align:top;animation:fly .7s cubic-bezier(.2,.9,.25,1) .1s both}
/* 光はロゴの形で切り抜く（四角い帯が見えないように）。logo.png は背景が透明 */
.logo::after{content:"";position:absolute;inset:0;background:linear-gradient(105deg,transparent 40%,rgba(255,255,255,.85) 50%,transparent 60%) no-repeat;background-size:250% 100%;background-position:150% 0;-webkit-mask:url(/assets/logo.png?v=2) center/100% 100% no-repeat;mask:url(/assets/logo.png?v=2) center/100% 100% no-repeat;animation:sheen 1.1s ease-in-out .8s 1 both;pointer-events:none}
.logo:hover::after{animation:sheen2 1.1s ease-in-out 1}
button{transition:transform .15s,box-shadow .15s,background .15s}
button:hover{background:#0077ED}
button:active{transform:scale(.99)}
input{transition:border-color .15s,box-shadow .15s}
input:focus{outline:0;border-color:#0071E3;box-shadow:0 0 0 4px rgba(0,113,227,.18)}
@keyframes bg{0%,100%{background-position:0% 50%}50%{background-position:100% 50%}}
@keyframes up{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
@keyframes fly{from{opacity:0;transform:translateX(-46px) skewX(-8deg)}to{opacity:1;transform:none}}
@keyframes sheen{from{background-position:150% 0}to{background-position:-50% 0}}
@keyframes sheen2{from{background-position:150% 0}to{background-position:-50% 0}}
@media (prefers-reduced-motion:reduce){body,.box,.logo,.logo::after{animation:none!important}button{transition:none}}
</style></head><body>
<form class="box" method="post" action="/login">
<h1><span class="logo"><img class="mark" src="/assets/logo.png?v=2" alt="ApoBoost" width="220" height="44"></span></h1><p class="sub">フォーム＆メール営業</p>
${opts.error ? `<div class="err">${esc(opts.error)}</div>` : ""}
<input type="hidden" name="next" value="${esc(opts.next ?? "/")}">
<label>ログインID</label><input name="username" autocomplete="username" autofocus required>
<label>パスワード</label><input name="password" type="password" autocomplete="current-password" required>
<button>ログイン</button>
</form>${FX_LOGIN}</body></html>`;
}

/** パスワード変更 */
export function passwordView(mustChange: boolean): string {
  return `<h1>パスワードの変更</h1>
${mustChange ? `<div class="flash">最初のログインです。ご自身のパスワードに変更してください。</div>` : ""}
<div class="card" style="max-width:460px">
<form method="post" action="/password">
${mustChange ? "" : `<label>いまのパスワード</label><input type="password" name="current" autocomplete="current-password" required>`}
<label>新しいパスワード（8文字以上）</label><input type="password" name="next1" autocomplete="new-password" required minlength="8">
<label>新しいパスワード（確認）</label><input type="password" name="next2" autocomplete="new-password" required minlength="8">
<p><button class="btn primary">変更する</button></p>
</form></div>`;
}
