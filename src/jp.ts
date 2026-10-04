// 英語のまま画面に出ていたエラーを、原因と直し方がわかる日本語にする。
// 見慣れない英語が出ると、そこで手が止まってしまう（他社に配るとそのまま問い合わせになる）。
// 元の英文は末尾に残す（原因調査に必要なため）。

type Rule = { re: RegExp; jp: string };

const RULES: Rule[] = [
  // メール送信（SMTP / nodemailer）。下の汎用の規則（ETIMEDOUT・ECONNRESET 等）より先に見る。
  // 送信の画面では email.ts の explainSmtpError がもっと詳しく説明するが、エラーログ等ではこちらが使われる
  { re: /Daily (user )?(sending|SMTP relay) (limit|quota)|\b550[- ]5\.4\.5\b/i, jp: "メールの1日の送信上限に達しました（翌日まで待つか、1日の上限を下げてください）" },
  { re: /Application-specific password required|\b534[- ]5\.7\.9\b/i, jp: "このメールアカウントは2段階認証とアプリパスワードが必要です" },
  { re: /Invalid login|\b535[- ]\d\.\d\.\d+|Username and Password not accepted|BadCredentials/i, jp: "メールのログインを拒否されました（送信用メールアドレスとアプリパスワードを確認してください）" },
  { re: /Greeting never received|wrong version number|ssl3_get_record/i, jp: "メールサーバーのポート番号と暗号化の方式が合っていません（465か587を確認してください）" },
  { re: /\b550[- ]5\.1\.1\b/i, jp: "宛先のメールアドレスが存在しません" },
  { re: /\b552[- ]5\.2\.2\b/i, jp: "相手の受信箱がいっぱいで受け取ってもらえませんでした" },
  { re: /\b553[- ]5\.7\.1\b.*(sender|from)|not owned by user/i, jp: "差出人のアドレスを、この送信用アカウントでは使えないと断られました" },
  { re: /Unexpected socket close|Connection closed unexpectedly/i, jp: "メールサーバーとの通信が途中で切れました" },
  // ブラウザ（Playwright / Chromium）
  { re: /net::ERR_NAME_NOT_RESOLVED|getaddrinfo ENOTFOUND|ERR_NAME_RESOLUTION/i, jp: "このURLのサイトが見つかりません（ドメインが廃止・入力間違いの可能性）" },
  { re: /net::ERR_CONNECTION_REFUSED|ECONNREFUSED/i, jp: "サイトに接続を拒否されました（サーバーが止まっている可能性）" },
  { re: /net::ERR_CONNECTION_TIMED_OUT|net::ERR_TIMED_OUT|ETIMEDOUT/i, jp: "サイトの応答がありませんでした（時間切れ）" },
  { re: /net::ERR_CONNECTION_RESET|net::ERR_CONNECTION_CLOSED|ECONNRESET/i, jp: "通信が途中で切れました" },
  { re: /net::ERR_CERT|ERR_SSL|SSL_ERROR|certificate has expired/i, jp: "サイトの証明書に問題があり開けませんでした" },
  { re: /net::ERR_ABORTED/i, jp: "ページの読み込みが中断されました" },
  { re: /net::ERR_TOO_MANY_REDIRECTS/i, jp: "転送が繰り返されて開けませんでした" },
  { re: /net::ERR_ADDRESS_UNREACHABLE|EHOSTUNREACH|ENETUNREACH/i, jp: "サイトのサーバーに届きませんでした（ネットワークの問題の可能性）" },
  { re: /net::ERR_INTERNET_DISCONNECTED/i, jp: "インターネットにつながっていません。Wi-Fi・有線の接続を確認してください" },
  { re: /net::ERR_EMPTY_RESPONSE/i, jp: "サイトから何も返ってきませんでした" },
  { re: /net::ERR_BLOCKED_BY|ERR_ACCESS_DENIED/i, jp: "サイト側に自動アクセスを遮断されました" },
  // 「Protocol error」の規則より前に置く（URLの書き間違いを「ブラウザが閉じた」と案内していた）
  { re: /Cannot navigate to invalid URL|net::ERR_INVALID_URL|ERR_INVALID_URL|Invalid URL/i, jp: "URLの形が正しくありません（https:// から始まるURLか、空白や全角文字が混ざっていないか確認してください）" },
  { re: /Timeout .*exceeded|page\.goto: Timeout|waiting for selector|Navigation timeout/i, jp: "ページの表示に時間がかかりすぎて中断しました（時間切れ）" },
  { re: /Target (page|closed|crashed)|Protocol error|Browser has been closed|browserContext\.close/i, jp: "ブラウザが途中で閉じました（PCの負荷・メモリ不足の可能性）" },
  { re: /Executable doesn.?t exist|browserType\.launch.*Executable|Looks like Playwright/i, jp: "フォーム操作用のブラウザが入っていません。ターミナルで「npx playwright install chromium」を実行するか、Google Chrome を入れてください" },
  { re: /browserType\.launch|Failed to launch (the )?browser/i, jp: "フォーム操作用のブラウザを起動できませんでした。PCを再起動してから試し、直らなければターミナルで「npx playwright install chromium」を実行してください" },
  { re: /does not support .*on (mac|ubuntu|win)/i, jp: "このOSでは Playwright のブラウザを入れられません。Google Chrome が入っていればそちらを自動で使います" },
  { re: /Element is not (visible|enabled)|is not an? <?(input|select|textarea)/i, jp: "入力欄を操作できませんでした（画面の作りが特殊な可能性）" },
  { re: /frame was detached|Frame has been detached/i, jp: "ページが切り替わって操作できませんでした" },
  // 画面から送った内容の読み取り（multer）。大きな貼り付け・ファイルで出る
  { re: /Field value too long|LIMIT_FIELD_VALUE/i, jp: "貼り付けた内容が大きすぎます。ファイルで取り込むか、分けて貼り付けてください" },
  { re: /File too large|LIMIT_FILE_SIZE/i, jp: "ファイルが大きすぎます。ファイルを分けてから取り込んでください" },
  { re: /Unexpected end of form|Multipart: Boundary not found/i, jp: "送信が途中で切れました。もう一度お試しください" },
  // CSV（csv-parse）。取り込みが英語のエラーで止まると、どこを直せばよいか分からない
  { re: /Invalid Opening Quote|Invalid Closing Quote|Quote Not Closed|CSV_QUOTE_NOT_CLOSED|CSV_INVALID_CLOSING_QUOTE|INVALID_OPENING_QUOTE/i, jp: "CSVの中に「\"」（ダブルクォーテーション）の数が合わない行があり、表として読めませんでした。そのセルの「\"」を消すか全角の「”」に直してから取り込んでください" },
  { re: /Invalid Record Length|CSV_RECORD_INCONSISTENT|CSV_INVALID_ARGUMENT|Invalid option delimiter/i, jp: "CSVの列の数や区切りがそろっていない行があり、表として読めませんでした。Excelやスプレッドシートで開いて「CSV（UTF-8）」で保存し直してください" },
  // 壊れた・形式の違うExcel（.xlsx）。取り込みが英語のエラーで止まらないようにする
  { re: /ADM-ZIP|Invalid or unsupported zip format|End of central directory/i, jp: "Excelファイル（.xlsx）として読めませんでした。ファイルが壊れているか、形式が違います。Excelで開いて「.xlsx」または「CSV（UTF-8）」で保存し直してから取り込んでください" },
  // ファイル・ポート・プロセス
  { re: /EADDRINUSE/i, jp: "そのポートは別のアプリが使っています（ApoBoostを二重に起動していませんか）" },
  { re: /EACCES|permission denied/i, jp: "ファイルやフォルダに書き込む権限がありません" },
  { re: /ENOSPC/i, jp: "パソコンの空き容量が足りません" },
  { re: /ENOENT/i, jp: "ファイルが見つかりません（フォルダを移動・削除していませんか）" },
  { re: /EMFILE/i, jp: "同時に開いているファイルが多すぎます。アプリを再起動してください" },
  { re: /SQLITE_BUSY|database is locked/i, jp: "データが同時に使われています（ApoBoostを二重に起動していませんか）" },
  { re: /SQLITE_CORRUPT|file is not a database|malformed/i, jp: "データファイルが壊れている可能性があります。設定画面からバックアップを復元してください" },
  // ネットワーク（fetch / API）
  { re: /fetch failed|ERR_NETWORK|Failed to fetch/i, jp: "インターネットへの通信に失敗しました" },
  { re: /AbortError|The operation was aborted|signal is aborted/i, jp: "時間切れで中断しました" },
  { re: /\b401\b|Unauthorized|invalid x-api-key|authentication_error/i, jp: "APIキーが違うか失効しています（設定画面で登録し直してください）" },
  { re: /\b429\b|rate.?limit|too many requests/i, jp: "短時間に使いすぎたため、相手のサービスに制限されました（少し待ってから再実行してください）" },
  { re: /\b5\d\d\b.*(error|server)|internal server error/i, jp: "相手のサービス側でエラーが起きています（時間を置いて再実行してください）" },
  { re: /insufficient[_ ]quota|credit balance|billing/i, jp: "AIの利用枠・残高が足りません（請求設定を確認してください）" },
  // IMAP（受信箱の読み取り）
  { re: /Invalid credentials|AUTHENTICATIONFAILED/i, jp: "メールのログインに失敗しました（アプリパスワードを確認してください）" },
  { re: /IMAP .*disabled|\[ALERT\].*IMAP/i, jp: "メール側でIMAP（受信箱の読み取り）が無効になっています" },
];

/** 英語のエラー文を日本語にする。該当しなければ元のまま返す */
export function jpError(raw: unknown, max = 220): string {
  const text = String((raw as Error)?.message ?? raw ?? "").trim();
  if (!text) return "";
  // すでに日本語が含まれていれば、そのまま（自前のメッセージ）
  const hasJa = /[ぁ-んァ-ン一-龥]/.test(text);
  const hit = RULES.find((r) => r.re.test(text));
  if (!hit) return text.slice(0, max);
  if (hasJa && text.startsWith(hit.jp)) return text.slice(0, max);
  const tail = text.replace(/\s+/g, " ").slice(0, 120);
  return `${hit.jp}（詳細: ${tail}）`.slice(0, max + 140);
}

/** 英語が残っているかの簡易判定（画面で「原文」を折りたたむかの判断に使う） */
export const looksEnglish = (s: string) => !/[ぁ-んァ-ン一-龥]/.test(String(s ?? ""));
