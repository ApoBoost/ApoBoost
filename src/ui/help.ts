// 右下の質問箱（キャラクターとのチャット形式）。AIは使わない。
//
// 仕組み: 下の HELP_TOPICS に「分類 → 質問 → 答え」を書いておき、画面ではボタンで選んでもらう。
// 文字で探したい人向けに、キーワード検索も付けている（質問・答え・キーワードの文字の重なりで並べるだけ）。
// 通信は一切しない。答えを足したいときは、HELP_TOPICS に1件足すだけでよい。
//
// 売り物として配るので、「配布元に聞く前に、ここで自己解決できる」ことを狙っている。
// 答えは画面の言葉に合わせ、行き先の画面へのリンクを必ず付ける。

type HelpItem = { q: string; a: string; kw?: string; links?: [string, string][] };
type HelpTopic = { title: string; items: HelpItem[] };

export const HELP_TOPICS: HelpTopic[] = [
  {
    title: "はじめかた",
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
    title: "送れない・要対応",
    items: [
      { q: "「要対応」は何をすればいいですか？", kw: "失敗 送れなかった 片づける 今日", a: "自動で送れなかった会社の一覧です。「今日」の印が付いた会社だけ片づければ十分です。各行の左のボタンが、その会社にいちばん効く操作です。原因が同じものは「同じ原因のまとめ」から1回で片づけられます。", links: [["/todo", "要対応を開く"]] },
      { q: "画像認証（私はロボットではありません）の会社はどうすれば？", kw: "CAPTCHA キャプチャ reCAPTCHA 認証 ロボット", a: "画像認証は自動では突破しない方針です。「開いて入力」を押すと、文面まで入力した状態でブラウザが開くので、認証をして送信し、「送信済みにする」を押してください。数が多いときは「画像認証を続けて処理する」で1社ずつ進められます。", links: [["/todo?kind=captcha", "画像認証の会社を見る"]] },
      { q: "「入力エラー」で失敗します", kw: "必須 電話番号 フリガナ 住所 未入力 エラー", a: "多くは、フォームが必須にしている項目（電話番号・フリガナ・住所など）が送信者に登録されていないことが原因です。送信者の情報を埋めてから、要対応の「まとめて送り直す」を押してください。", links: [["/senders", "送信者を確認する"], ["/todo", "要対応を開く"]] },
      { q: "「フォームが無い」と出ます", kw: "フォーム無し 見つからない URL 問い合わせページ", a: "問い合わせフォームのページを見つけられなかった会社です。フォームのURLが分かる場合は「URLを直す」から入れてください。メールアドレスが分かっている会社は「メールで送る」に切り替えられます。", links: [["/todo?kind=noform", "フォーム無しの会社を見る"]] },
      { q: "「サイト側の拒否」とは何ですか？", kw: "スパム 403 拒否 受け付けられません ブロック", a: "相手のサイトがスパム判定などで自動の送信を受け付けなかった、という意味です。入力を直しても通らないので、メールアドレスが分かればメールで、無ければ「開いて入力」で手で送るか、見送ってください。" },
      { q: "「送信済みか不明（要確認）」と出ます", kw: "判定不能 届いたか 二重 送信後", a: "送信ボタンは押したものの、完了の画面を確認できなかった会社です。二重に送らないよう、自動では送り直しません。スクリーンショットや、相手からの受付メールが届いていないかを見て、届いていれば「送信済みにする」、届いていなければ「もう一度送る」を選んでください。" },
      { q: "開始したのに送信が進みません", kw: "始まらない 止まっている 時間待ち 動かない 送られない", a: "「時間待ち」と出ているときは、送信時間帯の外か、1日の上限に達しています。時間帯になれば自動で送ります。すぐ送りたいときは、キャンペーンの「② 送信」で「時間帯を無視して今すぐ送る」にチェックを入れて開始してください。それでも動かないときは動作チェックを見てください。", links: [["/health", "動作チェックを開く"]] },
    ],
  },
  {
    title: "メールの設定",
    items: [
      { q: "アプリパスワードはどう作りますか？", kw: "Gmail Google 2段階認証 メールにログインできない 受信箱にログインできません パスワード 16文字 SMTP", a: "Googleアカウントで「2段階認証プロセス」をオンにしてから、「アプリパスワード」を作ります（英小文字16文字。普段のログインパスワードではありません）。作ったものを送信者の「メールで送る場合の設定」に入れ、「メール設定を確認」でOKになるか確かめてください。", links: [["/senders", "送信者の画面"], ["https://myaccount.google.com/apppasswords", "アプリパスワード（Google）"]] },
      { q: "Gmailが「一時的に停止」されました", kw: "停止 制限 止められた ブロック 送りすぎ", a: "短時間に送りすぎたことが原因です。通常1時間〜24時間で戻ります。戻るまではメール送信が自動で一時停止になり、会社は「待機」のまま残ります。再開後は1日の上限を下げ、日中に少しずつ送ってください。" },
      { q: "メールは1日に何通まで送れますか？", kw: "上限 何件 通数 ウォームアップ 制限", a: "作ったばかりのアカウントは、1日50〜100通から始めてください。ApoBoostは、新しいアカウントの上限を2週間かけて自動で引き上げます（ウォームアップ）。上限はキャンペーンの「設定を変える」で変えられます。" },
      { q: "受信箱が勝手に整理されるのはなぜ？", kw: "ラベル 自動返信 振り分け 受信トレイ 消えた メール", a: "フォームに送った会社からの「お問い合わせありがとうございます」という自動返信と、届かなかったメールを、ラベル「ApoBoost/自動返信」「ApoBoost/届かなかった」に移して受信箱から外しています。消してはいません。アポの返信にはスターが付きます。止めたいときは、送信者の画面で「受信箱を自動で振り分ける」をオフにしてください。", links: [["/senders", "送信者の画面"]] },
      { q: "メールの末尾に住所や配信停止が入るのはなぜ？", kw: "法律 特定電子メール 署名 配信停止 住所", a: "営業メールには、送信者の名称・住所・配信停止の連絡先の表示が法律で必要なためです。自動で入るので、消すことはできません。", links: [["/law", "営業メールの決まり"]] },
    ],
  },
  {
    title: "リスト・除外",
    items: [
      { q: "営業リストはどんな形式ですか？", kw: "CSV 取り込み インポート 列 見本 エクセル スプレッドシート", a: "CSVで取り込みます。「会社名」と「会社URL」の2列があれば始められます。列名は多少違っていても読み取ります。見本のCSVは、はじめの設定とキャンペーンの「① 準備」にあります。", links: [["/setup", "はじめの設定"]] },
      { q: "送ってはいけない会社を登録したい", kw: "除外 NG 既存顧客 取引先 送らない ブラックリスト", a: "「除外・チーム共有」の画面に登録すると、リストに入っていても送りません。貼り付け・URL・CSVでまとめて登録できます。", links: [["/suppressions", "除外リストを開く"]] },
      { q: "同じ会社に二重に送ってしまいませんか？", kw: "重複 再送 何度も 同じ会社", a: "90日以内に送った会社には送りません（期間はキャンペーンごとに変えられます）。同じグループにしたキャンペーン同士でも重ねて送りません。" },
      { q: "「営業お断り」と書いてある会社は？", kw: "お断り 禁止 クレーム", a: "サイトに「営業お断り」の文言を見つけると、送らずにスキップし、その会社を除外リストに自動で入れます。官公庁・自治体・学校のドメインも、既定で送りません。" },
      { q: "人材登録など、関係ないフォームに入力されませんか？", kw: "登録フォーム 応募 求職 スタッフ登録 エントリー", a: "求職者向けの登録フォームや応募フォームは、入力欄や見出しから見分けて使いません。その場合はサイト内の問い合わせフォームを探し直し、無ければ送らずに「フォームが無い」にします。" },
    ],
  },
  {
    title: "返信・アポ",
    items: [
      { q: "返信やアポはどこで見られますか？", kw: "反応 返事 アポイント 商談 確認", a: "上のメニューの「アポ」に、アポ・前向きな返信がまとまっています。キャンペーンごとの反応は「③ 結果」の上にある「反応」の一覧で見られます。受信箱を15分ごとに読んで、自動で記録しています。", links: [["/appointments", "アポを開く"]] },
      { q: "返信の判定が違っています", kw: "間違い 誤判定 断り アポじゃない 直す", a: "会社の名前を押して詳細を開き、「反応を記録」で正しいものを選び直してください。直した内容は覚えて、次から同じ言い回しは同じ振り分けになります。" },
      { q: "断られた会社にはもう送りませんか？", kw: "配信停止 断り 不要 送らないで", a: "送りません。断りの返信・配信停止・宛先不明で戻ってきたアドレスには、以後は送らないようにしています。" },
    ],
  },
  {
    title: "そのほか",
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
 *  ・用意した答えで解決しないときは、担当者（配布元）に質問を送れる。返信はこのチャットに届く（support.ts） */
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
// 通信するのは、担当者への質問を送るとき・その返信を取りに行くときだけ（このアプリのサーバーを通る）
(function(){
  var TOPICS = ${JSON.stringify(HELP_TOPICS).replace(/</g, "\\u003c")};
  var box = document.getElementById("fo-help"), btn = document.getElementById("fo-help-btn");
  if (!box || !btn) return;
  var log = box.querySelector(".log"), form = box.querySelector("form"), input = document.getElementById("fo-help-q"), sendBtn = form.querySelector("button");
  var started = false, staffOn = false, askMode = false;
  var TYPE_MS = 1000;
  function el(tag, cls, text){ var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function scroll(){ log.scrollTop = log.scrollHeight; }
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
      list.forEach(function(o){ var b = el("button", o.sub ? "sub" : "", o.label); b.type = "button"; b.onclick = function(){ o.run(); }; wrap.appendChild(b); });
      log.appendChild(wrap); scroll();
    });
  }
  function topicButtons(){
    var list = TOPICS.map(function(t){ return { label: t.title, run: function(){ me(t.title); topic(t); } }; });
    if (staffOn) list.push({ label: "担当者に質問する", sub: true, run: function(){ me("担当者に質問する"); askStaff(); } });
    return list;
  }
  function home(first){
    bot(first ? "こんにちは。困りごとに近いものを選んでください。下の欄に言葉を入れて探すこともできます。" : "ほかに知りたいことはありますか？");
    opts(topicButtons());
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
    var more = [];
    if (t) more.push({ label: "「" + t.title + "」のほかの質問", run: function(){ topic(t); } });
    more.push({ label: "最初に戻る", run: function(){ home(false); } });
    more.push({ label: "解決しなかった", sub: true, run: function(){ me("解決しなかった"); unsolved(); } });
    opts(more);
  }
  // ---- 担当者に質問する ----
  function setAsk(on){
    askMode = on; form.className = on ? "ask" : "";
    input.placeholder = on ? "困っていることを、くわしく書いてください" : "言葉で探す（例: アプリパスワード）";
    sendBtn.textContent = on ? "送る" : "探す";
    if (on) setTimeout(function(){ input.focus(); }, 50);
  }
  function askStaff(){
    bot("担当者に質問を送ります。困っていることを下の欄にくわしく書いて、「送る」を押してください。\\n\\n送られるのは、質問の文章・ご利用の版・会社名・開いている画面です。営業リストや送信履歴は送られません。");
    opts([{ label: "やめる", sub: true, run: function(){ setAsk(false); home(false); } }]);
    later(function(){ setAsk(true); });
  }
  function sendToStaff(text){
    me(text); setAsk(false); sendBtn.disabled = true;
    fetch("/support/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: text, page: location.pathname }) })
      .then(function(r){ return r.json().catch(function(){ return { ok: false }; }); })
      .then(function(j){
        if (!j.ok) { bot(j.error || "送れませんでした。時間を置いてもう一度お試しください。"); opts([{ label: "もう一度書く", run: function(){ askStaff(); } }, { label: "最初に戻る", sub: true, run: function(){ home(false); } }]); return; }
        bot(j.sent ? "担当者に送りました。追って、このチャットでご連絡します。\\n返信が届くと、右下のボタンに赤い印が付きます（通知をオンにしていれば、通知でもお知らせします）。" : "質問を控えました。いまは配布元につながらなかったので、つながり次第、自動で送ります。返信は、このチャットに届きます。");
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
    if (!hits.length) {
      bot(staffOn ? "用意した答えの中には見つかりませんでした。このまま担当者に質問を送ることもできます。" : "その言葉では見つかりませんでした。言い方を変えるか、下から選んでください。");
      opts((staffOn ? [{ label: "この内容を担当者に送る", run: function(){ sendToStaff(text); } }] : []).concat(topicButtons()));
      return;
    }
    if (hits.length === 1 || hits[0].s >= hits[1].s * 2) { answer(hits[0].it, hits[0].t); return; }
    bot("近い質問が見つかりました。");
    opts(hits.map(function(h){ return { label: h.it.q, run: function(){ me(h.it.q); answer(h.it, h.t); } }; }).concat([{ label: "最初に戻る", sub: true, run: function(){ home(false); } }]));
  });
  // Enter で送る（Shift+Enter は改行）。日本語の変換中の Enter では送らない
  input.addEventListener("keydown", function(e){ if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit ? form.requestSubmit() : sendBtn.click(); } });
  // ---- 担当者とのこれまでのやり取り ----
  function loadThread(seen){
    return fetch("/support/thread" + (seen ? "?seen=1" : ""), { cache: "no-store" }).then(function(r){ return r.ok ? r.json() : null; }).catch(function(){ return null; });
  }
  function showThread(list){
    if (!list || !list.length) return;
    note("担当者とのこれまでのやり取り");
    list.forEach(function(t){
      log.appendChild(el("div", "msg me", t.question));
      if (t.reply) addBot(t.reply, null, "staff"); else note(t.sent ? "担当者からの返信を待っています" : "まだ送れていません（つながり次第、自動で送ります）");
    });
    note("ここから新しい質問");
  }
  function open(){
    box.hidden = false; btn.hidden = true; btn.classList.remove("new");
    if (!started) {
      started = true;
      loadThread(true).then(function(j){ if (j) { staffOn = !!j.enabled; showThread(j.list); } home(true); });
    } else {
      // 開き直したとき、新しい返信が来ていれば出す
      loadThread(true).then(function(j){ if (j && j.unread) { j.list.filter(function(t){ return t.reply; }).slice(-j.unread).forEach(function(t){ later(function(){ log.appendChild(el("div", "msg me", t.question)); addBot(t.reply, null, "staff"); }); }); } });
    }
    setTimeout(function(){ input.focus(); }, 50);
  }
  function close(){ box.hidden = true; btn.hidden = false; }
  btn.addEventListener("click", open);
  box.querySelector(".x").addEventListener("click", close);
  addEventListener("keydown", function(e){ if (e.key === "Escape" && !box.hidden) close(); });
  // 読んでいない返信があれば、右下のボタンに赤い印を付ける
  loadThread(false).then(function(j){ if (j && j.unread) btn.classList.add("new"); });
})();
</script>`;
