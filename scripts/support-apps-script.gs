// ApoBoost 質問箱の受け口（配布元用）
// 使い方:
//  1. 新しい Google スプレッドシートを作り、「拡張機能 → Apps Script」を開いて、このコードを貼り付けて保存
//  2. 右上の「デプロイ → 新しいデプロイ」→ 種類「ウェブアプリ」→ 実行するユーザー「自分」、アクセスできるユーザー「全員」→ デプロイ
//  3. 表示された「ウェブアプリのURL」（https://script.google.com/macros/s/…/exec）を、ApoBoost の update.json の support_url に書いてリリース
//  4. 質問が届くと「質問」シートに1行ずつ増えます。G列「返信」に答えを書くと、相手のApoBoostのチャットに数分で届きます
var SHEET = "質問";
// 列は末尾に足すだけにする（G列「返信」の位置を変えると、返信を読めなくなる）
var HEAD = ["受付日時", "番号", "会社・担当", "版", "画面", "質問", "返信", "返信を渡した日時", "状況（どの会社の、どの失敗か）", "元の質問の番号（追加の質問のとき）"];
function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET);
  if (!sh) { sh = ss.insertSheet(SHEET); sh.appendRow(HEAD); sh.setFrozenRows(1); sh.setColumnWidth(6, 420); sh.setColumnWidth(7, 420); sh.setColumnWidth(9, 320); }
  // 前の版で作ったシートには、足りない見出しを末尾に足す
  if (sh.getLastColumn() < HEAD.length) sh.getRange(1, 1, 1, HEAD.length).setValues([HEAD]);
  return sh;
}
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function doGet() { return json_({ ok: true, name: "ApoBoost support" }); }
function doPost(e) {
  try {
    var b = JSON.parse(e.postData.contents || "{}");
    var sh = sheet_();
    if (b.action === "ask") {
      var t = String(b.ticket || "");
      if (!/^[0-9a-f]{32}$/.test(t)) return json_({ ok: false, error: "bad ticket" });
      var q = String(b.question || "").slice(0, 2000);
      if (!q) return json_({ ok: false, error: "empty" });
      // 先頭が = + - @ の文字は、表計算の式として動かないように ' を付ける
      var safe = function (s) { s = String(s || ""); return /^[=+\-@]/.test(s) ? "'" + s : s; };
      sh.appendRow([new Date(), t, safe(String(b.who || "").slice(0, 120)), safe(String(b.version || "").slice(0, 20)), safe(String(b.page || "").slice(0, 200)), safe(q), "", "", safe(String(b.context || "").slice(0, 600)), /^[0-9a-f]{32}$/.test(String(b.parent || "")) ? String(b.parent) : ""]);
      try { MailApp.sendEmail(Session.getEffectiveUser().getEmail(), "ApoBoost 質問が届きました", String(b.who || "") + "\n\n" + q + "\n\n" + SpreadsheetApp.getActiveSpreadsheet().getUrl()); } catch (err) {}
      return json_({ ok: true });
    }
    if (b.action === "poll") {
      var want = {}; (b.tickets || []).slice(0, 50).forEach(function (x) { want[String(x)] = true; });
      var rows = sh.getDataRange().getValues(), out = [];
      for (var i = 1; i < rows.length; i++) {
        var tk = String(rows[i][1]);
        if (want[tk] && String(rows[i][6]).trim() !== "") { out.push({ ticket: tk, reply: String(rows[i][6]) }); if (!rows[i][7]) sh.getRange(i + 1, 8).setValue(new Date()); }
      }
      return json_({ ok: true, replies: out });
    }
    return json_({ ok: false, error: "unknown action" });
  } catch (err) { return json_({ ok: false, error: String(err) }); }
}
