// ログインとパスワード変更
import { STATUS_LABEL, OUTCOME_LABEL, CHANNEL_LABEL, channelMode, jst, type Campaign, type Job, type SenderProfile, type JobStatus } from "../db.js";
import { AI_MODELS, type Lint } from "../message.js";
import { TEMPLATE_LIBRARY } from "../templates.js";
import { esc, layout, n, type NavUser } from "./layout.js";
import { post } from "./parts.js";

// ================= ログイン関連の画面 =================

/** ログイン画面（ヘッダー無しの独立レイアウト） */
export function loginPage(opts: { error?: string; next?: string } = {}): string {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ログイン | ApoBoost</title>
<style>
body{margin:0;font-family:-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif;background:#F3F6FB;color:#0B1B3F;display:flex;align-items:center;justify-content:center;min-height:100vh;font-size:14px}
.box{background:#fff;border:1px solid #DCE3EE;border-radius:14px;padding:32px 30px;width:340px;box-shadow:0 2px 16px rgba(6,34,86,.08)}
h1{margin:0 0 6px;text-align:center}
.sub{text-align:center;color:#66728A;font-size:12px;margin:0 0 22px}
label{display:block;font-size:12px;color:#66728A;margin:12px 0 4px}
input{width:100%;padding:10px 12px;border:1px solid #C2CCDB;border-radius:8px;font-size:14px}
button{width:100%;margin-top:20px;padding:11px;background:#0A66E8;color:#fff;border:0;border-radius:8px;font-weight:700;font-size:14px;cursor:pointer}
.err{background:#FDECEA;color:#C62828;border-radius:8px;padding:9px 12px;font-size:13px;margin-bottom:6px}
.mark{display:block;margin:0 auto}
</style></head><body>
<form class="box" method="post" action="/login">
<h1><img class="mark" src="/assets/logo.png" alt="ApoBoost" width="220" height="52"></h1><p class="sub">フォーム＆メール営業</p>
${opts.error ? `<div class="err">${esc(opts.error)}</div>` : ""}
<input type="hidden" name="next" value="${esc(opts.next ?? "/")}">
<label>ログインID</label><input name="username" autocomplete="username" autofocus required>
<label>パスワード</label><input name="password" type="password" autocomplete="current-password" required>
<button>ログイン</button>
</form></body></html>`;
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
