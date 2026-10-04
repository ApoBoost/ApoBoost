// 右下の質問箱（キャラクターとのチャット形式）。AIは使わない。
//
// 仕組み: 下の HELP_TOPICS に「分類 → 質問 → 答え」を書いておき、画面ではボタンで選んでもらう。
// 文字で探したい人向けに、キーワード検索も付けている（質問・答え・キーワードの文字の重なりで並べるだけ）。
// 通信は一切しない。答えを足したいときは、HELP_TOPICS に1件足すだけでよい。
//
// 売り物として配るので、「配布元に聞く前に、ここで自己解決できる」ことを狙っている。
// 答えは画面の言葉に合わせ、行き先の画面へのリンクを必ず付ける。

// id: 「この会社について質問する」で、失敗の種類に合わせて先に出す答えを指すための名前
// popular: 開いたときの「よく見られている質問」に出す
// desk: 窓口。send＝送信・特定の会社のこと ／ account＝ログイン・起動・メール接続 ／ other＝そのほか・使い方
type HelpItem = { q: string; a: string; kw?: string; links?: [string, string][]; id?: string; popular?: true };
type HelpTopic = { title: string; desk: "send" | "account" | "other"; items: HelpItem[] };

export const HELP_TOPICS: HelpTopic[] = [
  {
    title: "はじめかた", desk: "account",
    items: [
      { q: "何から始めればいいですか？", kw: "初めて 最初 始め方 セットアップ 設定 手順", a: "「はじめの設定」の6ステップを上から順に進めれば、送信を始められます。送信者の登録 → メールの設定 → 営業メールの決まりの確認 → キャンペーン作成 → リストの取り込み → 送信、の順です。", links: [["/setup", "はじめの設定を開く"], ["/guide", "ご利用ガイド"]] },
      { q: "本番の前に試し送りはできますか？", kw: "テスト 試す 確認 自社", a: "できます。キャンペーンを開き、右上の「…」から「テスト送信」を選ぶと、自社のフォームや自分のメール宛てに試せます。営業リストには送られません。実在の会社に向けたテスト送信はしないでください。", links: [["/campaigns", "キャンペーンを開く"]] },
      { q: "料金はかかりますか？", kw: "費用 無料 有料 AI 課金", a: "テンプレートでの送信・返信の自動確認は無料です。AIで文面を会社ごとに書き分ける送り方を選んだ場合だけ、AIの利用料（使った分だけ）がかかります。", links: [["/guide#ai", "AIの料金の目安"]] },
      { q: "他のパソコンから画面を開けますか？", kw: "共有 チーム 社内 別のPC スマホ URL", a: "同じWi-Fi・社内ネットワークなら開けます。アドレス欄の localhost は他のパソコンでは開けないので、「ユーザー」の画面に出ている共有用のURLを伝えてください（管理者のみ）。", links: [["/users", "ユーザーの画面"]] },
      { q: "ApoBoostにログインできません", kw: "ログインできない パスワード 忘れた ロック 入れない ID", a: "パスワードを忘れたときは、管理者に「ユーザー」の画面でパスワードを発行し直してもらってください。同じログインIDで15分に5回まちがえると、しばらくログインできなくなります（時間を置くと戻ります）。", links: [["/users", "ユーザーの画面（管理者）"]] },
      { q: "パソコンを閉じると送信は止まりますか？", kw: "スリープ ふた 電源 終了 止まる 黒い画面 ターミナル", a: "止まります。送信はこのパソコンの中で動いているので、スリープ・ふたを閉じる・アプリ（黒い画面）の終了で止まります。もう一度起動すると、続きから再開します。" },
    ],
  },
  {
    title: "送れない・要対応", desk: "send",
    items: [
      { q: "「要対応」は何をすればいいですか？", popular: true,  kw: "失敗 送れなかった 片づける 今日", a: "自動で送れなかった会社の一覧です。「今日」の印が付いた会社だけ片づければ十分です。各行の左のボタンが、その会社にいちばん効く操作です。原因が同じものは「同じ原因のまとめ」から1回で片づけられます。", links: [["/todo", "要対応を開く"]] },
      { q: "画像認証（私はロボットではありません）の会社はどうすれば？", id: "captcha",  kw: "CAPTCHA キャプチャ reCAPTCHA 認証 ロボット", a: "画像認証は自動では突破しない方針です。「開いて入力」を押すと、文面まで入力した状態でブラウザが開くので、認証をして送信し、「送信済みにする」を押してください。数が多いときは「画像認証を続けて処理する」で1社ずつ進められます。", links: [["/todo?kind=captcha", "画像認証の会社を見る"]] },
      { q: "「入力エラー」で失敗します", id: "input", popular: true,  kw: "必須 電話番号 フリガナ 住所 未入力 エラー", a: "多くは、フォームが必須にしている項目（電話番号・フリガナ・住所など）が送信者に登録されていないことが原因です。送信者の情報を埋めてから、要対応の「まとめて送り直す」を押してください。", links: [["/senders", "送信者を確認する"], ["/todo", "要対応を開く"]] },
      { q: "「フォームが無い」と出ます", id: "noform",  kw: "フォーム無し 見つからない URL 問い合わせページ", a: "問い合わせフォームのページを見つけられなかった会社です。フォームのURLが分かる場合は「URLを直す」から入れてください。メールアドレスが分かっている会社は「メールで送る」に切り替えられます。", links: [["/todo?kind=noform", "フォーム無しの会社を見る"]] },
      { q: "「サイト側の拒否」とは何ですか？", id: "blocked",  kw: "スパム 403 拒否 受け付けられません ブロック", a: "相手のサイトがスパム判定などで自動の送信を受け付けなかった、という意味です。入力を直しても通らないので、メールアドレスが分かればメールで、無ければ「開いて入力」で手で送るか、見送ってください。" },
      { q: "「送信済みか不明（要確認）」と出ます", id: "unsure",  kw: "判定不能 届いたか 二重 送信後", a: "送信ボタンは押したものの、完了の画面を確認できなかった会社です。二重に送らないよう、自動では送り直しません。スクリーンショットや、相手からの受付メールが届いていないかを見て、届いていれば「送信済みにする」、届いていなければ「もう一度送る」を選んでください。" },
      { q: "タイムアウト・ネットワークエラーと出ます", id: "network", kw: "時間切れ timeout 通信 つながらない 開けない 重い", a: "相手のサイトが重い、一時的に落ちている、ということが多いです。通信が原因の失敗は、自動でもう1回だけ送り直します。それでも失敗するときは、その会社のURLをブラウザで開けるか確かめてから、「もう一度送る」を押してください。", links: [["/todo", "要対応を開く"]] },
      { q: "フォームの形が特殊で失敗します", id: "form", kw: "送信ボタンが見つからない 確認画面を抜けられない 本文欄 入力できない 特殊", a: "確認画面が何段もある、送信ボタンが特殊な作りになっている、といったフォームです。自動では送れないので、要対応の「開いて入力」で文面まで入った状態のブラウザを開き、手で送ってから「送信済みにする」を押してください。数が多いときは、キャンペーンの「② 送信」→「その他の操作」から、手作業で送る会社のリストを書き出せます。", links: [["/todo", "要対応を開く"]] },
      { q: "「要確認（回答を決められない質問）」とは？", id: "check", kw: "要確認 未回答 質問に答える 選択式 業種 予算 回答待ち", a: "フォームに「ご予算」「何で知りましたか」のような、答えを決められない必須の質問があったため、送らずに止めています。要対応の「質問に答える」を押し、会社の詳細の「未回答の質問」で答えを選ぶと、その内容で送り直します。", links: [["/todo?kind=check", "回答待ちの会社を見る"]] },
      { q: "送れなかった会社を、手作業でまとめて送りたい", kw: "手作業 手動 CSV 書き出し リスト 一覧", a: "キャンペーンを開き、「② 送信」→「その他の操作」→「手作業で送る会社のリストを書き出す」で、画像認証や失敗で送れなかった会社を、URLと文面つきのCSVで書き出せます。", links: [["/campaigns", "キャンペーンを開く"]] },
      { q: "送れたかどうか、実際の画面で確かめたい", kw: "スクリーンショット 証拠 確認 画像 本当に送れた", a: "会社の名前を押して詳細を開くと、送信したときの画面のスクリーンショットが残っています（フォーム送信のとき）。画像を押すと大きく見られます。" },
      { q: "開始したのに送信が進みません", popular: true,  kw: "始まらない 止まっている 時間待ち 動かない 送られない", a: "「時間待ち」と出ているときは、送信時間帯の外か、1日の上限に達しています。時間帯になれば自動で送ります。すぐ送りたいときは、キャンペーンの「② 送信」で「時間帯を無視して今すぐ送る」にチェックを入れて開始してください。それでも動かないときは動作チェックを見てください。", links: [["/health", "動作チェックを開く"]] },
    ],
  },
  {
    title: "メールの設定", desk: "account",
    items: [
      { q: "アプリパスワードはどう作りますか？", popular: true,  kw: "Gmail Google 2段階認証 メールにログインできない 受信箱にログインできません パスワード 16文字 SMTP", a: "Googleアカウントで「2段階認証プロセス」をオンにしてから、「アプリパスワード」を作ります（英小文字16文字。普段のログインパスワードではありません）。作ったものを送信者の「メールで送る場合の設定」に入れ、「メール設定を確認」でOKになるか確かめてください。", links: [["/senders", "送信者の画面"], ["https://myaccount.google.com/apppasswords", "アプリパスワード（Google）"]] },
      { q: "Gmailが「一時的に停止」されました", kw: "停止 制限 止められた ブロック 送りすぎ", a: "短時間に送りすぎたことが原因です。通常1時間〜24時間で戻ります。戻るまではメール送信が自動で一時停止になり、会社は「待機」のまま残ります。再開後は1日の上限を下げ、日中に少しずつ送ってください。" },
      { q: "メールは1日に何通まで送れますか？", kw: "上限 何件 通数 ウォームアップ 制限", a: "作ったばかりのアカウントは、1日50〜100通から始めてください。ApoBoostは、新しいアカウントの上限を2週間かけて自動で引き上げます（ウォームアップ）。上限はキャンペーンの「設定を変える」で変えられます。" },
      { q: "受信箱が勝手に整理されるのはなぜ？", kw: "ラベル 自動返信 振り分け 受信トレイ 消えた メール", a: "フォームに送った会社からの「お問い合わせありがとうございます」という自動返信と、届かなかったメールを、ラベル「ApoBoost/自動返信」「ApoBoost/届かなかった」に移して受信箱から外しています。消してはいません。アポの返信にはスターが付きます。止めたいときは、送信者の画面で「受信箱を自動で振り分ける」をオフにしてください。", links: [["/senders", "送信者の画面"]] },
      { q: "メールの末尾に住所や配信停止が入るのはなぜ？", kw: "法律 特定電子メール 署名 配信停止 住所", a: "営業メールには、送信者の名称・住所・配信停止の連絡先の表示が法律で必要なためです。自動で入るので、消すことはできません。", links: [["/law", "営業メールの決まり"]] },
    ],
  },
  {
    title: "リスト・除外", desk: "send",
    items: [
      { q: "営業リストはどんな形式ですか？", kw: "CSV 取り込み インポート 列 見本 エクセル スプレッドシート", a: "CSVで取り込みます。「会社名」と「会社URL」の2列があれば始められます。列名は多少違っていても読み取ります。見本のCSVは、はじめの設定とキャンペーンの「① 準備」にあります。", links: [["/setup", "はじめの設定"]] },
      { q: "送ってはいけない会社を登録したい", kw: "除外 NG 既存顧客 取引先 送らない ブラックリスト", a: "「除外・チーム共有」の画面に登録すると、リストに入っていても送りません。貼り付け・URL・CSVでまとめて登録できます。", links: [["/suppressions", "除外リストを開く"]] },
      { q: "同じ会社に二重に送ってしまいませんか？", kw: "重複 再送 何度も 同じ会社", a: "90日以内に送った会社には送りません（期間はキャンペーンごとに変えられます）。同じグループにしたキャンペーン同士でも重ねて送りません。" },
      { q: "「営業お断り」と書いてある会社は？", kw: "お断り 禁止 クレーム", a: "サイトに「営業お断り」の文言を見つけると、送らずにスキップし、その会社を除外リストに自動で入れます。官公庁・自治体・学校のドメインも、既定で送りません。" },
      { q: "官公庁や学校には送られますか？", kw: "役所 自治体 市役所 学校 病院 公的 go.jp lg.jp", a: "送りません。官公庁・自治体・学校などのドメインは、取り込んだ時点で既定で除外しています。" },
      { q: "クレームが来たときはどうすれば？", kw: "苦情 怒られた 抗議 送るな 迷惑 配信停止", a: "その会社の詳細を開き、「反応を記録」で「断り・不要（今後送らない）」を選んでください。以後、その会社には送りません。同じ画面の「このドメインを除外リストに入れる」を押すと、ほかのキャンペーンでも送らなくなります。", links: [["/suppressions", "除外リストを開く"]] },
      { q: "人材登録など、関係ないフォームに入力されませんか？", kw: "登録フォーム 応募 求職 スタッフ登録 エントリー", a: "求職者向けの登録フォームや応募フォームは、入力欄や見出しから見分けて使いません。その場合はサイト内の問い合わせフォームを探し直し、無ければ送らずに「フォームが無い」にします。" },
    ],
  },
  {
    title: "返信・アポ", desk: "send",
    items: [
      { q: "返信やアポはどこで見られますか？", kw: "反応 返事 アポイント 商談 確認", a: "上のメニューの「アポ」に、アポ・前向きな返信がまとまっています。キャンペーンごとの反応は「③ 結果」の上にある「反応」の一覧で見られます。受信箱を15分ごとに読んで、自動で記録しています。", links: [["/appointments", "アポを開く"]] },
      { q: "返信の判定が違っています", kw: "間違い 誤判定 断り アポじゃない 直す", a: "会社の名前を押して詳細を開き、「反応を記録」で正しいものを選び直してください。直した内容は覚えて、次から同じ言い回しは同じ振り分けになります。" },
      { q: "断られた会社にはもう送りませんか？", kw: "配信停止 断り 不要 送らないで", a: "送りません。断りの返信・配信停止・宛先不明で戻ってきたアドレスには、以後は送らないようにしています。" },
    ],
  },
  {
    title: "キャンペーン・文面", desk: "other",
    items: [
      { q: "送る時間帯や曜日を決めたい", kw: "時間 何時 土日 平日 夜 休日 スケジュール", a: "キャンペーンの「設定を変える」で、送信時間帯（開始・終了の時刻）と「平日のみ」を決められます。時間帯の外では送らずに待ち、時間になると自動で続きを送ります。", links: [["/campaigns", "キャンペーンを開く"]] },
      { q: "1日に何件まで送られますか？", kw: "上限 件数 何社 ペース 制限", a: "キャンペーンの「1日の上限（フォーム／メール）」で決めた数までです。メールは、作ったばかりのアカウントほど少ない数から始まります（ウォームアップ）。", links: [["/campaigns", "キャンペーンを開く"]] },
      { q: "文面を2通り試して比べたい（A/Bテスト）", kw: "AB ABテスト 比較 件名 本文B 2種類", a: "キャンペーンの設定で「2つの文面を半分ずつ送って、反応を比べる」にチェックを入れ、「本文（B）」を書きます。会社ごとにAとBを半分ずつ送り、結果は「③ 結果」に並べて出ます。どちらも100件以上送ってから比べるのが目安です。" },
      { q: "AIの文面とテンプレートの違いは？", kw: "文面モード 個別化 書き分け 冒頭だけ 全文AI", a: "テンプレートは、同じ文面に会社名などを差し込んで送ります（無料）。AIを使うモードは、会社のサイトを読んで会社ごとに書き出しや全文を書き分けます（AIの利用料がかかります）。「AIへの追加指示」で、調子や切り口を指定できます。", links: [["/guide#ai", "AIの料金の目安"]] },
      { q: "資料を付けて送りたい", kw: "添付 PDF ファイル 資料 リンク", a: "メールで送るときは、キャンペーンの「資料ファイル」に登録したファイルを添付します。フォームにはファイルを付けられないので、代わりに「資料の公開リンク」を本文の末尾に自動で入れます。" },
      { q: "「送れそう度」とは何ですか？", kw: "スコア 点数 見込み 事前チェック", a: "事前チェックの結果から出した、その会社に送れる見込みです（0〜100）。フォームがあるか・メールアドレスがあるか・画像認証があるかで決まります。" },
      { q: "同じ会社に、もう一度送りたい", kw: "再送 再度 2回目 フォロー 期間", a: "「同じ会社への再送を止める期間（日）」（既定90日）の中は、同じ会社には送りません。期間はキャンペーンの設定で変えられますが、短くしすぎるとクレームのもとになるので、既定のままを勧めます。" },
    ],
  },
  {
    title: "そのほか", desk: "other",
    items: [
      { q: "新しい版に更新するには？", kw: "アップデート バージョン 最新 更新", a: "上の帯に「新しい版があります」と出たら、それを押して画面の指示に従ってください（管理者のみ）。更新の前に、データの控えを自動で取ります。", links: [["/update", "アップデートの画面"]] },
      { q: "データの控え（バックアップ）は取れますか？", kw: "バックアップ 復元 保存 引っ越し 買い替え", a: "1日1回、自動で控えを取っています（7世代）。手動で取る・戻すのは「動作チェック・バックアップ」の画面からできます。", links: [["/health", "動作チェック・バックアップ"]] },
      { q: "うまく動かないときはどうすれば？", kw: "不具合 エラー 壊れた おかしい 問い合わせ サポート 診断", a: "まず「動作チェック」を開いて、赤や黄色になっている項目を確認してください。解決しない場合は、同じ画面の「診断ファイル」を配布元に送ってください。原因を調べるのに必要な情報がまとまっています（パスワードやキーは含みません）。", links: [["/health", "動作チェックを開く"]] },
      { q: "画面の言葉の意味が分かりません", kw: "用語 意味 キャンペーン 事前チェック 待機 送れそう度", a: "ご利用ガイドの下に「言葉の意味（用語集）」があります。キャンペーン・事前チェック・待機中・要対応・送れそう度 などを説明しています。", links: [["/guide#words", "用語集を開く"]] },
    ],
  },
];

/** ログイン後の全画面に入れる（</body> の直前）。右下の丸いボタンを押すと開く。
 *  ・答える前に、1秒ほど「・・・」（入力中）を出す。すぐ答えが出ると機械的で、読む側の気持ちが追いつかないため
 *  ・用意した答えで解決しないときは、担当者（配布元）に質問を送れる。返信はこのチャットに届く（support.ts）
 *  ・開いたときは「よく見られている質問」と「窓口3つ」を出す。会社の詳細・要対応・キャンペーンの画面からは、
 *    その会社の状況を付けて開ける（window.foHelpOpen({ jobId })）。何の件かが最初から分かるので、聞き返しが要らない */
export const HELP_WIDGET = `<style>
#fo-help-btn{position:fixed;right:18px;bottom:18px;z-index:80;width:58px;height:58px;border-radius:50%;border:1px solid rgba(0,0,0,.08);background:#fff url(/assets/mascot.png?v=1) 42% 6%/165% auto no-repeat;box-shadow:0 6px 20px rgba(0,0,0,.18);cursor:pointer;padding:0;transition:transform .15s,box-shadow .15s}
#fo-help-btn:hover{transform:translateY(-2px);box-shadow:0 10px 26px rgba(0,0,0,.22)}
#fo-help-btn.new::after{content:"";position:absolute;right:2px;top:2px;width:14px;height:14px;border-radius:50%;background:var(--c-ng);border:2px solid #fff}
#fo-help{position:fixed;right:18px;bottom:18px;z-index:81;width:372px;max-width:calc(100vw - 24px);height:min(600px,calc(100vh - 36px));display:flex;flex-direction:column;background:#F5F5F7;border-radius:22px;box-shadow:0 18px 60px rgba(0,0,0,.28),0 0 0 1px rgba(0,0,0,.06);overflow:hidden}
#fo-help[hidden]{display:none}
#fo-help .hd{display:flex;align-items:center;gap:10px;padding:14px 14px 12px;background:#fff;border-bottom:1px solid var(--c-line)}
#fo-help .ava{flex:none;width:38px;height:38px;border-radius:50%;background:#EAF3FE url(/assets/mascot.png?v=1) 42% 6%/165% auto no-repeat}
#fo-help .hd b{display:block;font-size:15px;line-height:1.3}
#fo-help .hd span{font-size:12px;color:var(--c-ink-3)}
#fo-help .x{margin-left:auto;width:30px;height:30px;border-radius:50%;border:0;background:var(--c-fill);color:var(--c-ink-2);font-size:16px;line-height:1;cursor:pointer}
#fo-help .x:hover{background:var(--c-fill-hover)}
#fo-help .log{flex:1;overflow-y:auto;padding:14px 14px 6px;display:flex;flex-direction:column;gap:8px}
#fo-help .msg{max-width:88%;padding:9px 13px;border-radius:16px;font-size:14px;line-height:1.65;white-space:pre-wrap;word-break:break-word}
#fo-help .bot{align-self:flex-start;background:#fff;border-bottom-left-radius:5px}
#fo-help .me{align-self:flex-end;background:var(--c-brand);color:#fff;border-bottom-right-radius:5px}
#fo-help .staff{border:1px solid var(--c-brand);}
#fo-help .staff::before{content:"担当者より";display:block;font-size:11px;font-weight:700;color:var(--c-brand);margin-bottom:2px}
#fo-help .note{align-self:center;font-size:12px;color:var(--c-ink-3);margin:2px 0}
#fo-help .bot a{display:inline-block;margin:8px 6px 0 0;padding:4px 11px;border-radius:8px;background:var(--c-brand-bg);color:var(--c-link);font-size:13px;font-weight:600;text-decoration:none}
#fo-help .bot a:hover{background:#DCEBFD}
/* 入力中の「・・・」 */
#fo-help .typing{display:inline-flex;gap:5px;align-items:center;padding:13px 15px}
#fo-help .typing i{width:7px;height:7px;border-radius:50%;background:#A1A1A6;animation:fo-dot 1s ease-in-out infinite}
#fo-help .typing i:nth-child(2){animation-delay:.15s}
#fo-help .typing i:nth-child(3){animation-delay:.3s}
@keyframes fo-dot{0%,60%,100%{transform:translateY(0);opacity:.45}30%{transform:translateY(-4px);opacity:1}}
@media (prefers-reduced-motion:reduce){#fo-help .typing i{animation:none}}
#fo-help .opts{display:flex;flex-wrap:wrap;gap:6px;justify-content:flex-end;margin:2px 0 6px}
#fo-help .opts button{font:inherit;font-size:13.5px;padding:7px 13px;border-radius:999px;border:1px solid var(--c-line-strong);background:#fff;color:var(--c-ink);cursor:pointer;text-align:left;line-height:1.4}
#fo-help .opts button:hover{border-color:var(--c-brand);color:var(--c-brand)}
#fo-help .opts button.sub{background:transparent;border-color:transparent;color:var(--c-ink-3)}
#fo-help .opts .oh{flex:1 1 100%;text-align:right;font-size:11.5px;color:var(--c-ink-3);margin:4px 2px 0}
#fo-help .ctx{align-self:stretch;background:#fff;border:1px solid var(--c-line);border-radius:12px;padding:9px 12px;font-size:12.5px;line-height:1.6}
#fo-help .ctx b{display:block;font-size:13.5px}
#fo-help .ctx dl{display:grid;grid-template-columns:auto 1fr;gap:1px 10px;margin:4px 0 0}
#fo-help .ctx dt{color:var(--c-ink-3)}
#fo-help .ctx dd{margin:0;word-break:break-all}
#fo-help .st{align-self:flex-end;font-size:11.5px;font-weight:600;padding:1px 8px;border-radius:6px;margin-top:-4px}
#fo-help .st.wait{background:var(--c-wait-bg);color:var(--c-wait)}
#fo-help .st.go{background:var(--c-info-bg);color:var(--c-info)}
#fo-help .st.ok{background:var(--c-ok-bg);color:var(--c-ok)}
#fo-help form{display:flex;gap:8px;padding:10px 12px 12px;background:#fff;border-top:1px solid var(--c-line);align-items:flex-end}
#fo-help form textarea{flex:1;min-width:0;min-height:38px;max-height:120px;height:38px;border-radius:19px;padding:8px 14px;resize:none;line-height:1.5}
#fo-help form.ask textarea{height:84px;border-radius:14px}
#fo-help form button{flex:none;border:0;border-radius:999px;background:var(--c-brand);color:#fff;font:inherit;font-weight:600;padding:0 16px;height:38px;cursor:pointer}
#fo-help form button[disabled]{opacity:.5}
@media (max-width:520px){#fo-help{right:0;bottom:0;width:100vw;max-width:100vw;height:86vh;border-radius:22px 22px 0 0}}
@media print{#fo-help,#fo-help-btn{display:none!important}}
</style>
<button id="fo-help-btn" type="button" aria-label="質問箱を開く" title="困ったときはこちら"></button>
<div id="fo-help" hidden role="dialog" aria-label="質問箱">
<div class="hd"><div class="ava" aria-hidden="true"></div><div><b>ApoBoost 質問箱</b><span>よくある質問に、その場でお答えします</span></div><button class="x" type="button" aria-label="閉じる">×</button></div>
<div class="log" aria-live="polite"></div>
<form autocomplete="off"><textarea id="fo-help-q" rows="1" placeholder="言葉で探す（例: アプリパスワード）" aria-label="質問を入力"></textarea><button>探す</button></form>
</div>
<script>
// 質問箱。用意した答えはすべてこのページに入っている（AIは使わない）。
// 通信するのは、担当者への質問・その返信・会社の状況の取得・使われ方の記録のときだけ（どれもこのアプリのサーバーまで。
// 外へ出るのは「担当者に送る」を押したときだけ）
(function(){
  var TOPICS = ${JSON.stringify(HELP_TOPICS).replace(/</g, "\\u003c")};
  var DESKS = [["send", "送信・特定の会社のこと"], ["account", "ログイン・起動・メール接続"], ["other", "そのほか・使い方"]];
  // 失敗の種類 → 先に出す答え（HELP_TOPICS の id）
  var KEY_ITEMS = { captcha: ["captcha"], input: ["input"], noform: ["noform"], blocked: ["blocked"], unsure: ["unsure"], network: ["network"], form: ["form"], check: ["check"] };
  var box = document.getElementById("fo-help"), btn = document.getElementById("fo-help-btn");
  if (!box || !btn) return;
  var log = box.querySelector(".log"), form = box.querySelector("form"), input = document.getElementById("fo-help-q"), sendBtn = form.querySelector("button");
  var started = false, staffOn = false, staffNote = "", askMode = false, ctx = null, parentId = 0;
  var TYPE_MS = 1000;
  function el(tag, cls, text){ var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function scroll(){ log.scrollTop = log.scrollHeight; }
  function send(url, body){ try { fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(function(){}); } catch (e) {} }
  // 順番どおりに出すための列。答えの前に「・・・」を1秒ほど出す
  var queue = Promise.resolve();
  function later(fn){ queue = queue.then(fn); return queue; }
  function wait(ms){ return new Promise(function(ok){ setTimeout(ok, ms); }); }
  function addBot(text, links, cls){
    var m = el("div", "msg bot" + (cls ? " " + cls : ""), text);
    (links || []).forEach(function(l){ var a = el("a", "", l[1]); a.href = l[0]; if (l[0].indexOf("http") === 0) { a.target = "_blank"; a.rel = "noopener"; a.textContent = l[1] + " ↗"; } m.appendChild(a); });
    log.appendChild(m); scroll();
  }
  function bot(text, links){
    return later(function(){
      clearOpts();
      var t = el("div", "msg bot typing"); t.setAttribute("aria-label", "入力中"); t.appendChild(el("i")); t.appendChild(el("i")); t.appendChild(el("i"));
      log.appendChild(t); scroll();
      return wait(TYPE_MS).then(function(){ t.remove(); addBot(text, links); });
    });
  }
  function me(text){ return later(function(){ clearOpts(); log.appendChild(el("div", "msg me", text)); scroll(); }); }
  function note(text){ log.appendChild(el("div", "note", text)); scroll(); }
  function clearOpts(){ var old = log.querySelectorAll(".opts"); for (var i = 0; i < old.length; i++) old[i].remove(); }
  function opts(list){
    return later(function(){
      // 前に出した選択肢は片づける（古いボタンが残っていると、どれを押せばよいか迷う）
      clearOpts();
      var wrap = el("div", "opts");
      list.forEach(function(o){
        if (o.head) { wrap.appendChild(el("div", "oh", o.head)); return; }
        var b = el("button", o.sub ? "sub" : "", o.label); b.type = "button"; b.onclick = function(){ o.run(); }; wrap.appendChild(b);
      });
      log.appendChild(wrap); scroll();
    });
  }
  function findItem(id){ var hit = null; TOPICS.forEach(function(t){ t.items.forEach(function(it){ if (it.id === id) hit = { it: it, t: t }; }); }); return hit; }
  function deskButtons(){
    var list = DESKS.map(function(d){ return { label: d[1], run: function(){ me(d[1]); desk(d[0]); } }; });
    if (staffOn) list.push({ label: "担当者に質問する", sub: true, run: function(){ me("担当者に質問する"); askStaff(); } });
    return list;
  }
  // 最初の画面: よく見られている質問4本と、窓口3つ
  function home(first){
    ctx = null; parentId = 0;
    bot(first ? "こんにちは。困りごとに近いものを選んでください。下の欄に、文章で書いて探すこともできます。" : "ほかに知りたいことはありますか？");
    var popular = [];
    TOPICS.forEach(function(t){ t.items.forEach(function(it){ if (it.popular && popular.length < 4) popular.push({ label: it.q, run: function(){ me(it.q); answer(it, t); } }); }); });
    opts((first ? [{ head: "よく見られている質問" }].concat(popular) : []).concat([{ head: "窓口を選ぶ" }]).concat(deskButtons()));
  }
  // 窓口 → 分類（分類が1つだけなら、その段は飛ばす）
  function desk(key){
    var ts = TOPICS.filter(function(t){ return t.desk === key; });
    if (ts.length === 1) { topic(ts[0]); return; }
    bot("どれに近いですか？");
    opts(ts.map(function(t){ return { label: t.title, run: function(){ me(t.title); topic(t); } }; }).concat([{ label: "← 最初に戻る", sub: true, run: function(){ home(false); } }]));
  }
  function topic(t){
    bot("「" + t.title + "」について、近いものを選んでください。");
    opts(t.items.map(function(it){ return { label: it.q, run: function(){ me(it.q); answer(it, t); } }; }).concat([{ label: "← 最初に戻る", sub: true, run: function(){ home(false); } }]));
  }
  function unsolved(){
    if (staffOn) { askStaff(); return; }
    bot("お役に立てずすみません。ご利用ガイドに、画面ごとのくわしい手順があります。それでも解決しないときは、動作チェックの「診断ファイル」を配布元に送ってください。", [["/guide", "ご利用ガイド"], ["/health", "動作チェック"]]);
    opts([{ label: "最初に戻る", run: function(){ home(false); } }]);
  }
  function answer(it, t){
    bot(it.a, it.links);
    // 解決したかを聞く。結果はこの端末の中だけに残す（どの答えが役に立っていないかを知るため）
    var more = [
      { label: "解決した", run: function(){ me("解決した"); send("/support/feedback", { question: it.q, solved: true }); bot("よかったです。"); home(false); } },
      { label: "解決しなかった", run: function(){ me("解決しなかった"); send("/support/feedback", { question: it.q, solved: false }); unsolved(); } },
    ];
    if (t) more.push({ label: "「" + t.title + "」のほかの質問", sub: true, run: function(){ topic(t); } });
    more.push({ label: "最初に戻る", sub: true, run: function(){ home(false); } });
    opts(more);
  }
  // ---- この会社について質問する（会社の詳細・要対応・キャンペーンの画面から） ----
  function ctxCard(c, title){
    var d = el("div", "ctx"); d.appendChild(el("b", "", title));
    var dl = el("dl"); c.rows.forEach(function(r){ dl.appendChild(el("dt", "", r[0])); dl.appendChild(el("dd", "", r[1])); }); d.appendChild(dl);
    log.appendChild(d); scroll();
  }
  function startContext(o){
    var url = "/support/context?" + (o.jobId ? "job=" + encodeURIComponent(o.jobId) : "campaign=" + encodeURIComponent(o.campaignId));
    fetch(url, { cache: "no-store" }).then(function(r){ return r.ok ? r.json() : null; }).catch(function(){ return null; }).then(function(c){
      if (!c || !c.ok) { home(!started); return; }
      later(function(){ clearOpts(); });
      me(o.jobId ? "この会社について質問する" : "このキャンペーンについて質問する");
      later(function(){ ctx = c; ctxCard(c, "「" + c.company + "」についてのご質問ですね"); });
      var ids = KEY_ITEMS[c.key] || [];
      var hit = ids.length ? findItem(ids[0]) : null;
      if (hit) {
        // 失敗の種類に合った答えを先に出す（担当者に回す前に、その場で解決できるように）
        bot("この会社は「" + (c.kind || c.status) + "」で止まっています。まず、こちらをお試しください。");
        answerKeep(hit.it, hit.t);
      } else {
        bot("どんなことでお困りですか？ 近いものを選ぶか、下の欄に書いてください。");
        var ts = TOPICS.filter(function(t){ return t.desk === "send"; });
        opts(ts.map(function(t){ return { label: t.title, run: function(){ me(t.title); topicKeep(t); } }; }).concat(staffOn ? [{ label: "担当者に質問する", sub: true, run: function(){ me("担当者に質問する"); askStaff(); } }] : []));
      }
    });
  }
  // 会社の状況を付けたまま進む版（最初に戻ると、状況は外れる）
  function topicKeep(t){
    bot("「" + t.title + "」について、近いものを選んでください。");
    opts(t.items.map(function(it){ return { label: it.q, run: function(){ me(it.q); answerKeep(it, t); } }; }).concat([{ label: "← 最初に戻る", sub: true, run: function(){ home(false); } }]));
  }
  function answerKeep(it, t){
    bot(it.a, it.links);
    opts([
      { label: "解決した", run: function(){ me("解決した"); send("/support/feedback", { question: it.q, solved: true }); bot("よかったです。"); home(false); } },
      { label: "解決しなかった", run: function(){ me("解決しなかった"); send("/support/feedback", { question: it.q, solved: false }); unsolved(); } },
      { label: "ほかの質問を見る", sub: true, run: function(){ topicKeep(t); } },
    ]);
  }
  // ---- 担当者に質問する ----
  function setAsk(on){
    askMode = on; form.className = on ? "ask" : "";
    input.placeholder = on ? "困っていることを、くわしく書いてください" : "言葉で探す（例: アプリパスワード）";
    sendBtn.textContent = on ? "送る" : "探す";
    if (on) setTimeout(function(){ input.focus(); }, 50);
  }
  function askStaff(){
    bot("担当者に質問を送ります。困っていることを下の欄にくわしく書いて、「送る」を押してください。" + (staffNote ? "\\n" + staffNote : "") + "\\n\\n送られるのは、質問の文章・ご利用の版・会社名・開いている画面" + (ctx ? "と、下の「この件の状況」" : "") + "です。営業リスト・文面・送信履歴は送られません。");
    if (ctx) later(function(){ ctxCard(ctx, "この件の状況（担当者に送られます）"); });
    opts([{ label: "やめる", sub: true, run: function(){ setAsk(false); home(false); } }]);
    later(function(){ setAsk(true); });
  }
  function sendToStaff(text){
    me(text); setAsk(false); sendBtn.disabled = true;
    var body = { question: text, page: location.pathname };
    if (ctx && ctx.jobId) body.jobId = ctx.jobId;
    if (ctx && ctx.campaignId) body.campaignId = ctx.campaignId;
    if (parentId) body.parentId = parentId;
    fetch("/support/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      .then(function(r){ return r.json().catch(function(){ return { ok: false }; }); })
      .then(function(j){
        if (!j.ok) { bot(j.error || "送れませんでした。時間を置いてもう一度お試しください。"); opts([{ label: "もう一度書く", run: function(){ askStaff(); } }, { label: "最初に戻る", sub: true, run: function(){ home(false); } }]); return; }
        bot(j.sent ? "担当者に送りました。追って、このチャットでご連絡します。" + (staffNote ? "\\n" + staffNote : "") + "\\n返信が届くと、右下のボタンに赤い印が付きます（通知をオンにしていれば、通知でもお知らせします）。" : "質問を控えました。いまは配布元につながらなかったので、つながり次第、自動で送ります。返信は、このチャットに届きます。");
        later(function(){ var st = el("div", "st " + (j.sent ? "go" : "wait"), j.sent ? "受付済み・返信待ち" : "送信待ち"); log.appendChild(st); scroll(); });
        opts([{ label: "最初に戻る", run: function(){ home(false); } }]);
      })
      .catch(function(){ bot("送れませんでした。時間を置いてもう一度お試しください。"); opts([{ label: "もう一度書く", run: function(){ askStaff(); } }]); })
      .then(function(){ sendBtn.disabled = false; });
  }
  // ---- 言葉で探す: 入力した言葉の「2文字ずつの切れ端」が、質問・キーワード・答えにいくつ入っているかで並べる ----
  function search(text){
    var q = text.replace(/[\\s　、。？?！!]/g, "").toLowerCase();
    if (!q) return [];
    var grams = []; if (q.length < 2) grams.push(q); for (var i = 0; i + 2 <= q.length; i++) grams.push(q.slice(i, i + 2));
    var hits = [];
    TOPICS.forEach(function(t){ t.items.forEach(function(it){
      var head = (it.q + " " + (it.kw || "")).toLowerCase(), body = it.a.toLowerCase(), s = 0;
      grams.forEach(function(g){ if (head.indexOf(g) >= 0) s += 3; else if (body.indexOf(g) >= 0) s += 1; });
      if (s >= Math.max(3, grams.length)) hits.push({ s: s, it: it, t: t });
    }); });
    hits.sort(function(a, b){ return b.s - a.s; });
    return hits.slice(0, 4);
  }
  form.addEventListener("submit", function(e){
    e.preventDefault();
    var text = input.value.trim(); if (!text) return;
    input.value = "";
    if (askMode) { if (text.length < 5) { input.value = text; note("もう少しくわしく書いてください"); return; } sendToStaff(text); return; }
    me(text);
    var hits = search(text);
    var compact = text.replace(/[\\s　]/g, "");
    if (!hits.length && compact.length <= 6) {
      // 単語だけだと、何に困っているのかが分からない。すぐ「見つかりません」にせず、場面を聞き返す
      bot("もう少し教えてください。どの場面でお困りですか？「〜したら〜になる」のように文章で書くと、見つかりやすくなります。");
      opts([{ head: "窓口を選ぶ" }].concat(deskButtons()));
      return;
    }
    if (!hits.length) {
      send("/support/miss", { text: text });
      bot(staffOn ? "用意した答えの中には見つかりませんでした。このまま担当者に質問を送ることもできます。" : "その言葉では見つかりませんでした。言い方を変えるか、下から選んでください。");
      opts((staffOn ? [{ label: "この内容を担当者に送る", run: function(){ later(function(){ if (ctx) ctxCard(ctx, "この件の状況（担当者に送られます）"); }); sendToStaff(text); } }] : []).concat([{ head: "窓口を選ぶ" }]).concat(deskButtons()));
      return;
    }
    if (hits.length === 1 || hits[0].s >= hits[1].s * 2) { (ctx ? answerKeep : answer)(hits[0].it, hits[0].t); return; }
    bot("近い質問が見つかりました。");
    opts(hits.map(function(h){ return { label: h.it.q, run: function(){ me(h.it.q); (ctx ? answerKeep : answer)(h.it, h.t); } }; }).concat([{ label: "最初に戻る", sub: true, run: function(){ home(false); } }]));
  });
  // Enter で送る（Shift+Enter は改行）。日本語の変換中の Enter では送らない
  input.addEventListener("keydown", function(e){ if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit ? form.requestSubmit() : sendBtn.click(); } });
  // ---- 担当者とのこれまでのやり取り ----
  function loadThread(seen){
    return fetch("/support/thread" + (seen ? "?seen=1" : ""), { cache: "no-store" }).then(function(r){ return r.ok ? r.json() : null; }).catch(function(){ return null; });
  }
  function showTicket(t){
    log.appendChild(el("div", "msg me", t.question));
    if (t.context) { var c = el("div", "note", "状況: " + t.context.slice(0, 90)); c.style.alignSelf = "flex-end"; c.style.textAlign = "right"; log.appendChild(c); }
    // 状態の色は全画面共通（黄＝待ち／青＝進行中／緑＝済み）
    log.appendChild(el("div", "st " + (t.reply ? "ok" : t.sent ? "go" : "wait"), t.reply ? "返信あり" : t.sent ? "受付済み・返信待ち" : "送信待ち（つながり次第、自動で送ります）"));
    if (t.reply) addBot(t.reply, null, "staff");
  }
  function showThread(list){
    if (!list || !list.length) return null;
    note("担当者とのこれまでのやり取り");
    list.forEach(showTicket);
    var last = list[list.length - 1];
    return last.reply ? last : null;
  }
  // 返信のあと: 解決したか、追加で聞くか
  function afterReply(last){
    opts([
      { label: "解決しました", run: function(){ me("解決しました"); bot("よかったです。"); home(false); } },
      { label: "追加で質問する", run: function(){ me("追加で質問する"); parentId = last.id; askStaff(); } },
      { label: "別のことを聞く", sub: true, run: function(){ home(true); } },
    ]);
  }
  function show(){ box.hidden = false; btn.hidden = true; btn.classList.remove("new"); setTimeout(function(){ input.focus(); }, 50); }
  // o: { jobId } / { campaignId } を渡すと、その会社（キャンペーン）についての質問として開く
  function open(o){
    show();
    var first = !started; started = true;
    loadThread(true).then(function(j){
      if (j) { staffOn = !!j.enabled; staffNote = j.note || ""; }
      var last = null;
      if (first && j) last = showThread(j.list);
      else if (j && j.unread) { j.list.filter(function(t){ return t.reply; }).slice(-j.unread).forEach(function(t){ later(function(){ showTicket(t); }); last = t; }); }
      if (o && (o.jobId || o.campaignId)) { startContext(o); return; }
      if (last && staffOn) { later(function(){ note("担当者から返信が届いています"); }); afterReply(last); return; }
      if (first) home(true);
    });
  }
  function close(){ box.hidden = true; btn.hidden = false; }
  window.foHelpOpen = function(o){ open(o || null); };
  btn.addEventListener("click", function(){ open(null); });
  box.querySelector(".x").addEventListener("click", close);
  addEventListener("keydown", function(e){ if (e.key === "Escape" && !box.hidden) close(); });
  // 読んでいない返信があれば、右下のボタンに赤い印を付ける
  loadThread(false).then(function(j){ if (j && j.unread) btn.classList.add("new"); });
})();
</script>`;
