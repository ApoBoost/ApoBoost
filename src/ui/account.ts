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
body{margin:0;font-family:-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif;background:#FAF8F3;color:#1C1710;display:flex;align-items:center;justify-content:center;min-height:100vh;font-size:14px}
.box{background:#fff;border:1px solid #E6DFCF;border-radius:14px;padding:32px 30px;width:340px;box-shadow:0 2px 16px rgba(28,23,16,.06)}
h1{font-size:19px;margin:14px 0 4px;text-align:center}
.sub{text-align:center;color:#6E6558;font-size:12px;margin:0 0 22px}
label{display:block;font-size:12px;color:#6E6558;margin:12px 0 4px}
input{width:100%;padding:10px 12px;border:1px solid #D9D4CC;border-radius:8px;font-size:14px}
button{width:100%;margin-top:20px;padding:11px;background:#FFC62E;color:#1C1710;border:0;border-radius:8px;font-weight:700;font-size:14px;cursor:pointer}
.err{background:#FDECEA;color:#C62828;border-radius:8px;padding:9px 12px;font-size:13px;margin-bottom:6px}
.mark{display:block;margin:0 auto}
</style></head><body>
<form class="box" method="post" action="/login">
<svg class="mark" viewBox="0 0 48 48" width="52" height="52" role="img" aria-label="ApoBoost"><path d="M20 14C18.5 9 16 7.5 13.5 7" stroke="#1C1710" stroke-width="2.2" fill="none" stroke-linecap="round"/><path d="M28 14C29.5 9 32 7.5 34.5 7" stroke="#1C1710" stroke-width="2.2" fill="none" stroke-linecap="round"/><circle cx="12.8" cy="6.4" r="2.4" fill="#1C1710"/><circle cx="35.2" cy="6.4" r="2.4" fill="#1C1710"/><ellipse cx="9.5" cy="20" rx="8" ry="5.6" fill="#fff" stroke="#1C1710" stroke-width="1.6" transform="rotate(-24 9.5 20)"/><ellipse cx="38.5" cy="20" rx="8" ry="5.6" fill="#fff" stroke="#1C1710" stroke-width="1.6" transform="rotate(24 38.5 20)"/><rect x="13" y="13" width="22" height="29" rx="11" fill="#FFC62E" stroke="#1C1710" stroke-width="2"/><rect x="13" y="27.5" width="22" height="4.6" fill="#1C1710"/><rect x="13" y="36" width="22" height="4.6" fill="#1C1710"/><circle cx="19.6" cy="21.5" r="2.3" fill="#1C1710"/><circle cx="28.4" cy="21.5" r="2.3" fill="#1C1710"/><circle cx="20.4" cy="20.7" r=".8" fill="#fff"/><circle cx="29.2" cy="20.7" r=".8" fill="#fff"/></svg>
<h1>ApoBoost</h1><p class="sub">フォーム＆メール営業</p>
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
