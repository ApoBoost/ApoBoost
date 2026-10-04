// 1社分の送信を実行する（ブラウザ起動〜結果判定〜スクショ）。
import { chromium, type Browser, type BrowserContext, type Page, type Frame } from "playwright";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { SCREENSHOT_DIR, type SenderProfile, type JobStatus } from "./db.js";
import { detectRefusal, CAPTCHA_CHECK_SCRIPT, CHALLENGE_RE } from "./detect.js";
import { findContactForm, detectFormService } from "./formFinder.js";
import { collectFields, fillFields, clickNextButton, judgeOutcome, classify, hasHiddenTextarea, pageText, collectUnknownQuestions, toPendingQuestions, aiAnswerUnknownFields, allSubmitButtonsDisabled, fillRequiredLeftovers, fillAriaChoices, describeInvalidFields, clickBackButton, type PendingQuestion, type FieldInfo } from "./formFiller.js";
import { extractLegalName } from "./company.js";
import { llm } from "./message.js";

export type SubmitInput = {
  jobId: number;
  formUrl: string;
  siteUrl: string;
  sender: SenderProfile;
  subject: string;
  message: string;
  dryRun?: boolean; // 入力だけしてスクショを撮り、送信はしない
  ignoreRefusal?: boolean; // 営業お断り文言があっても送る（キャンペーン設定）
  aiMode?: boolean; // 全文AI生成モード: 想定外の必須項目をAIに回答させる（決められなければ要確認へ）
  company?: string; // AI回答の文脈用（宛先の会社名）
  manualAnswers?: { label: string; answer: string }[]; // 要確認画面で利用者が選んだ回答（AIより優先）
};

export type SubmitResult = {
  status: JobStatus;
  detail: string;
  finalUrl: string;
  screenshot: string;
  log: string[];
  pendingQuestions?: PendingQuestion[]; // 要確認: 利用者に画面で選んでもらう質問
};

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

/** フォーム操作に使うブラウザの実体。
 *  通常は Playwright が入れる Chromium（npx playwright install chromium）を使う。
 *  ただし Playwright は古いOS（例: macOS 13 以前）向けの Chromium を配布しておらず
 *  「Playwright does not support chromium on mac13」で入れられないため、
 *  その場合はPCに入っている Google Chrome / Microsoft Edge を自動で使う。環境変数 CHROMIUM_PATH があれば最優先 */
export function browserExecutablePath(): string | undefined {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  if (process.env.FO_FORCE_SYSTEM_CHROME !== "1") {
    try { if (fs.existsSync(chromium.executablePath())) return undefined; } catch { /* 未インストール */ }
  }
  const home = os.homedir();
  const local = process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local");
  const candidates = process.platform === "darwin"
    ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", path.join(home, "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"), "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"]
    : process.platform === "win32"
      ? ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe", path.join(local, "Google\\Chrome\\Application\\chrome.exe"), "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"]
      : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  const found = candidates.find((c) => { try { return fs.existsSync(c); } catch { return false; } });
  if (found) return found;
  throw new Error("フォーム送信用のブラウザが見つかりません。ターミナルで「npx playwright install chromium」を実行するか、Google Chrome をインストールしてください（macOS 13 以前のMacは Google Chrome が必要です）");
}

export async function launchBrowser(): Promise<Browser> {
  return chromium.launch({
    headless: process.env.HEADLESS !== "0",
    executablePath: browserExecutablePath(),
    args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
    // 終了の合図（Ctrl+C 等）でブラウザを勝手に閉じない。閉じると送信の途中で失敗・誤判定になるため、
    // アプリ側（server.ts の終了処理）で送信中の会社が終わるのを待ってから閉じる
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
  });
}

/** ページの中で実行する関数（page.evaluate）のための補助。
 *  このアプリは tsx で動かしており、tsx は関数に名前を付けるための `__name(...)` という呼び出しをコードに差し込む。
 *  ところがページの中にはその `__name` が無いため、内側に名前付きの関数を持つ処理は
 *  「__name is not defined」で失敗し、しかも多くは catch で握りつぶされて黙って空振りしていた
 *  （送信後の「赤字のエラー表示を拾う」処理がこれで効いていなかった）。
 *  全ページ・全フレームに、何もしない `__name` を先に置いておく。 */
const NAME_SHIM = "globalThis.__name = globalThis.__name || function (f) { return f; };";

export async function newContext(browser: Browser): Promise<BrowserContext> {
  const ctx = await browser.newContext({ userAgent: UA, locale: "ja-JP", viewport: { width: 1280, height: 900 }, ignoreHTTPSErrors: true });
  ctx.setDefaultTimeout(15000);
  await ctx.addInitScript(NAME_SHIM);
  return ctx;
}

/** 画面にブラウザを開き、問い合わせフォームを探して入力した状態で止める（送信ボタンは押さない）。
 *  CAPTCHA 等で自動送信できない会社を、人が内容を確認して送るための補助。
 *  headless/keepOpen はテスト用（通常は画面に開いたまま、利用者がウィンドウを閉じるまで残す）。 */
export async function openAndFill(
  input: { formUrl: string; siteUrl: string; sender: SenderProfile; subject: string; message: string },
  opts: { headless?: boolean; keepOpen?: boolean } = {},
): Promise<{ ok: boolean; detail: string; page?: Page; close: () => Promise<void> }> {
  const browser = await chromium.launch({ headless: opts.headless ?? false, executablePath: browserExecutablePath(), args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"] });
  const close = async () => { await browser.close().catch(() => {}); };
  const ctx = await browser.newContext({ userAgent: UA, locale: "ja-JP", viewport: null, ignoreHTTPSErrors: true });
  ctx.setDefaultTimeout(15000);
  await ctx.addInitScript(NAME_SHIM);
  const page = await ctx.newPage();
  try {
    const formPage = await findContactForm(page, input.formUrl, input.siteUrl);
    if (!formPage) {
      // 見つからなくても、人が探せるようにサイトは開いたままにする
      if (!page.url().startsWith("http")) await page.goto(input.formUrl || input.siteUrl, { waitUntil: "domcontentloaded", timeout: 25000 }).catch(() => {});
      return { ok: false, detail: "問い合わせフォームが見つからなかったので、サイトだけ開きました", page, close };
    }
    let target: Page | Frame = page;
    let fields = await collectFields(page);
    if (!fields.some((f) => classify(f) === "message")) {
      for (const fr of page.frames()) {
        if (fr === page.mainFrame()) continue;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const ff = await Promise.race([collectFields(fr), new Promise<FieldInfo[]>((res) => { timer = setTimeout(() => res([]), 5000); })]);
          if (ff.some((f) => classify(f) === "message")) { target = fr; fields = ff; break; }
        } catch {} finally { if (timer) clearTimeout(timer); }
      }
    }
    const report = await fillFields(target, fields, { sender: input.sender, subject: input.subject, message: input.message }, { requireMessage: false });
    // 送信ボタンは押さない。入力した欄が見えるように先頭の入力欄までスクロール
    await page.evaluate(() => document.querySelector("[data-fo-idx]")?.scrollIntoView({ block: "center" })).catch(() => {});
    const detail = report.filled.length
      ? `${report.filled.length}項目を入力しました${report.unfilled.length ? `（入力できなかった項目 ${report.unfilled.length}）` : ""}。内容を確認して送信してください`
      : "フォームは見つかりましたが、入力できる項目がありませんでした";
    return { ok: report.filled.length > 0, detail, page, close };
  } catch (e) {
    return { ok: false, detail: `途中でエラー: ${String((e as Error).message ?? e).slice(0, 120)}`, page, close };
  } finally {
    if (opts.keepOpen === false) await close();
  }
}

export async function submitToCompany(browser: Browser, input: SubmitInput): Promise<SubmitResult> {
  const log: string[] = [];
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  // サイトが出す警告のポップアップ（alert）。これまでは黙って閉じていたので、
  // 「お電話を入力してください」と言われていても気づけず、確認ボタンを押し続けていた。文言を控えておき、入力エラーとして扱う
  const dialogs: string[] = [];
  page.on("dialog", (d) => { dialogs.push(d.message().replace(/\s+/g, " ").trim().slice(0, 120)); d.accept().catch(() => {}); });
  const shot = path.join(SCREENSHOT_DIR, `job-${input.jobId}.png`);
  const done = async (status: JobStatus, detail: string, pendingQuestions?: PendingQuestion[]): Promise<SubmitResult> => {
    let screenshot = "";
    try {
      await page.screenshot({ path: shot, fullPage: false });
      screenshot = shot;
    } catch {}
    const finalUrl = page.url();
    await ctx.close().catch(() => {});
    return { status, detail, finalUrl, screenshot, log, pendingQuestions };
  };

  try {
    const formPage = await findContactForm(page, input.formUrl, input.siteUrl);
    if (!formPage) return done("skip_no_form", "問い合わせフォームが見つからない");
    log.push(`form: ${formPage}`);

    const textBefore = await pageText(page);
    if (CHALLENGE_RE.test(textBefore.slice(0, 3000))) return done("skip_captcha", "ブラウザ確認ページ（自動アクセス遮断）");
    const refusal = detectRefusal(textBefore);
    if (refusal && !input.ignoreRefusal) return done("skip_refused", `営業お断り文言: 「${refusal}」`);

    const captcha = await page.evaluate(CAPTCHA_CHECK_SCRIPT).catch(() => null);
    if (captcha) return done("skip_captcha", `CAPTCHAあり (${captcha})`);

    // フォーム本体があるフレームを選ぶ（埋め込みフォーム対応）。
    // Googleフォーム・formrun・HubSpot 等の外部サービスは、そのフレームを先に見る（#4）
    const service = await detectFormService(page);
    if (service) log.push(`フォームサービス: ${service.name}${service.frameUrl ? ` (${service.frameUrl})` : ""}`);
    let target: Page | Frame = page;
    let fields = await collectFields(page);
    if (!fields.some((f) => classify(f) === "message")) {
      const frames = page.frames().filter((fr) => fr !== page.mainFrame());
      // サービスのフレームを先頭に持ってくる
      frames.sort((a, b) => (service?.frameUrl && b.url() === service.frameUrl ? 1 : 0) - (service?.frameUrl && a.url() === service.frameUrl ? 1 : 0));
      for (const fr of frames) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          // 返ってこないフレーム（about:blank の隠しフレーム等）で止まらないよう5秒で見切る
          const ff = await Promise.race([collectFields(fr), new Promise<FieldInfo[]>((res) => { timer = setTimeout(() => res([]), 5000); })]);
          if (ff.some((f) => classify(f) === "message")) { target = fr; fields = ff; log.push(`iframe: ${fr.url()}`); break; }
          // 本文欄が無くても、外部フォームサービスのフレームに入力欄が3つ以上あればそれを使う
          if (service?.frameUrl && fr.url() === service.frameUrl && ff.length >= 3) { target = fr; fields = ff; log.push(`iframe(${service.name}): ${fr.url()}`); }
        } catch {} finally { if (timer) clearTimeout(timer); }
      }
    }
    // 段階式フォーム: 本文欄が2ページ目にある → 1ページ目を埋めて「次へ」を押してから本題へ（最大2段）
    for (let step = 0; step < 2 && !fields.some((f) => classify(f) === "message"); step++) {
      if (!(await hasHiddenTextarea(target))) break;
      const pre = await fillFields(target, fields, { sender: input.sender, subject: input.subject, message: input.message }, { requireMessage: false });
      log.push(`step${step + 1} filled: ${pre.filled.join(",")}`);
      const k = await clickNextButton(target, page, log);
      if (k === "none") break;
      fields = await collectFields(target);
    }
    if (!fields.some((f) => classify(f) === "message") && !(service && fields.length >= 3)) return done("skip_no_form", "本文（textarea）欄が無い");

    const report = await fillFields(target, fields, { sender: input.sender, subject: input.subject, message: input.message });
    log.push(`filled: ${report.filled.join(",")}`);
    if (report.unfilled.length) log.push(`unfilled: ${report.unfilled.join(",")}`);
    log.push(...report.log);
    if (!report.hasMessage && !(service && report.filled.length >= 3)) return done("failed", "本文欄への入力に失敗");
    // Googleフォームなどの「見た目だけの選択肢」のうち、必須の設問に回答しておく（#119）
    await fillAriaChoices(target, log, { requiredOnly: true });

    // 想定外の質問（判定できないテキスト欄・未チェックの選択肢グループ）への対応。
    // 優先順位は「要確認画面で利用者が選んだ回答」→「AI（全文AIモードのとき）」。
    // それでも決められない質問が残る場合は、無理に送らず「要確認」にして質問一覧を画面に出す。
    if (input.aiMode || input.manualAnswers?.length) {
      const fresh = await collectFields(target); // 入力後のチェック状態で見直す
      const unknowns = collectUnknownQuestions(fresh);
      if (unknowns.texts.length || unknowns.groups.length) {
        const r = await aiAnswerUnknownFields(
          target, unknowns,
          { company: input.company || "", sender: input.sender, message: input.message },
          input.aiMode ? llm : null,
          input.manualAnswers ?? [],
        );
        if (r.answered.length) log.push(`想定外の質問に回答: ${r.answered.join(" / ")}`);
        log.push(...r.log);
        if (r.unsure.length) {
          return done(
            "failed",
            `要確認: 回答を決められない質問があるため送信していません（${r.unsure.map((u) => u.label).join(" / ")}）\nこの下の「未回答の質問」で選んで再送信できます`,
            r.unsure,
          );
        }
      }
    }

    // React系フォーム（Jicoo等）: fill() の値セットが認識されず送信ボタンが無効のまま、というケースがある。
    // その場合はキーボードの実打鍵方式で入れ直して、ボタンが有効になるか確かめる。
    if (await allSubmitButtonsDisabled(target)) {
      log.push("送信ボタンが無効 → キーボード入力方式で入れ直し（React系フォーム対策）");
      const again2 = await collectFields(target);
      const rt = await fillFields(target, again2, { sender: input.sender, subject: input.subject, message: input.message }, { normalize: true, mode: "type" });
      log.push(`入れ直し: ${rt.filled.join(",") || "なし"}`);
      await page.waitForTimeout(800);
      if (await allSubmitButtonsDisabled(target)) {
        // 見た目だけの選択肢や、空のままの必須項目が原因のことが多いので、1回だけ補ってから見直す
        const a1 = await fillAriaChoices(target, log, { requiredOnly: false });
        const a2 = await fillRequiredLeftovers(target, log);
        if (a1 || a2) await page.waitForTimeout(600);
        if (await allSubmitButtonsDisabled(target)) {
          // どの欄で止まっているかを残す（#122）。人が直すときに、どこを見ればよいか分かるように
          const bad = await describeInvalidFields(target);
          return done("failed", `フォームの入力チェックを通過できず、送信ボタンが有効になりません${bad.length ? `\n引っかかっている欄: ${bad.join(" / ")}` : ""}\nスクリーンショットで未入力・エラー表示になっている欄を確認してください`);
        }
      }
    }

    if (input.dryRun) return done("queued", "テスト入力のみ（送信していない）");

    const fieldCountBefore = fields.length;
    const urlBefore = page.url(); // 送信ボタンを押す前のURL（ページが切り替わったかの判定に使う）
    let refilled = false; // 入力エラー後の埋め直しは1回だけ
    let advanced = false; // 確認ボタンを押して、確認画面へ進めたか（進めたあとは「送信」を優先して押す）
    let stuck = 0; // 確認ボタンを押しても入力画面のまま、が続いた回数
    // 5回まで: 確認→送信→（エラーなら戻って入れ直し）→確認→送信、の流れに足りる回数（#121）
    for (let round = 0; round < 5; round++) {
      dialogs.length = 0;
      const urlAtRound = page.url();
      const kind = await clickNextButton(target, page, log, { preferSubmit: advanced });
      // ボタンを押したときにサイトが出した警告（alert）のうち、入力の不備を言っているもの
      const warned = dialogs.find((m) => /(入力|記入|選択|必須|未入力|正しく|エラー|チェック|同意|ください|下さい)/.test(m) && !/よろしい(です|でしょう)か/.test(m));
      if (warned) log.push(`サイトの警告: ${warned}`);
      if (kind === "none") {
        // 確認ボタンを押した先が、エラーや拒否のページだった（入力欄も送信ボタンも無い）場合は、その内容を理由にする
        const why = await judgeOutcome(page, fieldCountBefore, false, textBefore, urlBefore);
        log.push(`judge[${round}]: ${why.status} ${why.detail}（ボタンなし）`);
        // 入力エラーのページなら、前の画面に戻って（電話番号なども入れて）1回だけやり直す
        if (why.status === "failed" && why.detail.startsWith("入力エラー") && !refilled && round < 3) {
          refilled = true; advanced = false;
          const went = await clickBackButton(target, page);
          log.push(`前の画面に戻って入れ直し: ${went ? "戻りました" : "戻れませんでした"}`);
          const again = await collectFields(target).catch(() => [] as FieldInfo[]);
          if (again.length) {
            const r3 = await fillFields(target, again, { sender: input.sender, subject: input.subject, message: input.message }, { normalize: true });
            log.push(`エラー後の自動修正・埋め直し: ${r3.filled.join(",") || "なし"}`);
            await fillRequiredLeftovers(target, log);
            await fillAriaChoices(target, log, { requiredOnly: false });
            if (r3.filled.length) continue;
          }
        }
        if (why.status === "failed") return done("failed", why.detail);
        return done("failed", "送信ボタンが見つからない");
      }
      // 確認画面で CAPTCHA が出る場合
      const cap2 = await page.evaluate(CAPTCHA_CHECK_SCRIPT).catch(() => null);
      if (cap2) {
        // 送信ボタンを押したら画像認証（reCAPTCHAのポップアップ）が出て止まったケースは未送信（sugoikaizen.com の実例）
        if (/bframe/.test(String(cap2))) return done("skip_captcha", `送信時に画像認証（reCAPTCHA）が表示され未送信 (${cap2})`);
        return done("skip_captcha", `確認画面にCAPTCHA (${cap2})`);
      }
      let outcome = await judgeOutcome(page, fieldCountBefore, kind === "submit", textBefore, urlBefore);
      if (outcome.status === "unsure" && warned) outcome = { status: "failed", detail: `入力エラー: ${warned}` };
      log.push(`judge[${round}]: ${outcome.status} ${outcome.detail}`);
      if (outcome.status === "sent") return done("sent", outcome.detail);
      if (outcome.status === "unsure" && outcome.detail.startsWith("確認画面")) {
        // ボタン名では確認ボタンと分からなかったが確認画面に進んでいた → 次のラウンドで「送信する」を押す
        log.push("確認画面を検知 → 送信ボタンを押す");
        continue;
      }
      // サイトの側で断られた（スパム判定・403・サイトの不具合など）。入力を直しても通らないので、そのまま理由を返す
      if (outcome.status === "failed" && outcome.detail.startsWith("サイト側")) {
        return done("failed", `${outcome.detail}\nフォームからは自動で送れない会社です。メールアドレスが分かればメールで、無ければ手動での送信か見送りになります`);
      }
      // 確認・送信ボタンを押しても入力画面のまま（URLも入力欄もそのまま）で、エラーの文言も拾えなかった。
      // 多くは、空のままの必須欄（任意と判断して入れなかった電話番号など）をブラウザやサイトが止めている。
      // 入力エラーと同じ扱いにして、電話番号なども入れて1回だけやり直す
      if (outcome.status === "unsure" && page.url() === urlAtRound && !outcome.detail.startsWith("確認画面")) {
        const here = await collectFields(target).catch(() => [] as FieldInfo[]);
        const stillForm = here.length >= fieldCountBefore && here.some((f) => classify(f) === "message");
        const bad = stillForm ? await describeInvalidFields(target) : [];
        if (stillForm && (kind === "confirm" || bad.length)) {
          stuck++;
          if (!refilled) outcome = { status: "failed", detail: `入力エラー: ボタンを押しても先へ進めません${bad.length ? `（${bad.join(" / ")}）` : ""}` };
          else if (stuck >= 2 || bad.length) return done("failed", `入力エラー: ${kind === "confirm" ? "確認" : "送信"}ボタンを押しても先へ進めません${bad.length ? `\n引っかかっている欄: ${bad.join(" / ")}` : ""}\nスクリーンショットで未入力・エラー表示になっている欄を確認してください`);
          if (outcome.status === "failed") log.push(`judge[${round}]→ ${outcome.detail}`);
        }
      }
      if (outcome.status === "failed") {
        // バリデーションエラーなら、カナのスペース除去などの修正ルールを通して集め直し、埋め直して1回だけ再送する
        if (!refilled && round < 3 && /入力エラー/.test(outcome.detail)) {
          refilled = true;
          // 「前画面に戻って正しく入力してください」と言われたら、戻ってから入れ直す（#121）
          // 入力欄が1つも無いエラーページ（サーバーが返す「【電話番号】は必須項目です」だけのページ）のときも戻る
          // （ヘッダーの検索欄などは残っているので、「本文欄が無い」で見分ける）
          const noFields = !(await collectFields(target).catch(() => [] as FieldInfo[])).some((f) => classify(f) === "message");
          if (noFields || /(前(の)?(画面|ページ)|入力画面)(に|へ)?戻/.test(outcome.detail)) {
            const went = await clickBackButton(target, page);
            advanced = false;
            log.push(`前の画面に戻って入れ直し: ${went ? "戻りました" : "戻れませんでした"}`);
          }
          // フリガナの文字種を指定された場合は、それに合わせる（#120）
          const kana = /ひらがな|平仮名/.test(outcome.detail) ? "hira" as const : /カタカナ|片仮名|全角カナ/.test(outcome.detail) ? "kata" as const : undefined;
          const again = await collectFields(target);
          // どの必須項目が空のまま弾かれたか（次のエラー表示に併記する）
          const emptyRequired = again.filter((f) => f.required && classify(f) !== "ignore" && !f.checked);
          if (again.length) {
            const r3 = await fillFields(target, again, { sender: input.sender, subject: input.subject, message: input.message }, { normalize: true, kana });
            log.push(`エラー後の自動修正・埋め直し: ${r3.filled.join(",") || "なし"}${kana ? `（フリガナは${kana === "hira" ? "ひらがな" : "カタカナ"}で入力）` : ""}`);
            // それでも空のまま残っている必須項目（判定できなかった質問など）を安全な値で埋める（#6）
            const extra = await fillRequiredLeftovers(target, log);
            // 見た目だけの選択肢（Googleフォーム等）で未選択のものに回答する（#119）
            const aria = await fillAriaChoices(target, log, { requiredOnly: false });
            if (r3.filled.length || extra || aria) continue;
          }
          if (emptyRequired.length) {
            const names = emptyRequired.map((f) => (f.sig.split(" || ")[0] || f.name || "項目").slice(0, 16)).slice(0, 4);
            return done("failed", `${outcome.detail}\n未入力の必須項目の可能性: ${names.join(" / ")}（この欄が必須で、値を用意できず送信できませんでした）`);
          }
        }
        return done("failed", `${outcome.detail}\n※ 入力しないと出るエラーは、その項目が必須になっていることが多いです。`);
      }
      // 確認画面なら次のラウンドで送信ボタンを押す。確認画面の項目は再収集
      if (kind === "confirm") {
        // 確認画面に未入力の必須項目（同意チェック等）が残っていれば埋める
        const more = await collectFields(target);
        // 確認画面へ進めた（URLが変わった、または入力欄が減った）。次からは「送信」を優先して押す
        if (page.url() !== urlAtRound || more.length < fieldCountBefore) advanced = true;
        if (more.length) {
          const r2 = await fillFields(target, more, { sender: input.sender, subject: input.subject, message: input.message });
          if (r2.filled.length) log.push(`confirm-page filled: ${r2.filled.join(",")}`);
        }
        continue;
      }
      // submit を押したのに判定不能 → もう一度だけ待って判定
      await page.waitForTimeout(3000);
      const again = await judgeOutcome(page, fieldCountBefore, true, textBefore, urlBefore);
      if (again.status === "sent") return done("sent", again.detail);
      // 届いたかどうかは会社によって違う（完了画面が出ている／確認画面で止まっている／画像認証で止まっている 等）ので、
      // 一律に送信済みにはしない（v0.3.51で一律送信済みにしたが取り消し）。自動再試行はしない（worker 側で除外）
      return done("failed", `送信後の判定不能: ${again.detail}`);
    }
    return done("failed", "確認画面を抜けられない");
  } catch (e) {
    log.push(`exception: ${String(e).slice(0, 200)}`);
    return done("failed", `例外: ${String((e as Error).message ?? e).slice(0, 120)}`);
  }
}

/** 企業HPのテキストを取得（AI個別化用）。失敗時は空文字 */
export async function fetchSiteText(browser: Browser, siteUrl: string): Promise<{ title: string; text: string }> {
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  try {
    const url = siteUrl.startsWith("http") ? siteUrl : `https://${siteUrl}`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(500);
    const title = await page.title();
    const text: string = await page.evaluate(() => {
      for (const el of Array.from(document.querySelectorAll("script, style, nav, footer, header, noscript"))) el.remove();
      return (document.body?.innerText ?? "").replace(/\s+/g, " ").trim();
    });
    return { title, text: text.slice(0, 3000) };
  } catch {
    return { title: "", text: "" };
  } finally {
    await ctx.close().catch(() => {});
  }
}

export type ScanResult = {
  formUrl: string | null;
  refused: string | null;
  captcha: string | null;
  emails: string[];
  note: string;
  legalName: string | null; // HPの表記から読み取った正式名称（法人格つき）。無ければ null
};

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const BAD_EMAIL_RE = /(noreply|no-reply|example\.|sentry|wixpress|@[0-9.]+$|\.png$|\.jpg$|\.gif$|\.svg$|\.webp$)/i;

async function collectEmails(page: Page): Promise<string[]> {
  const found: string[] = await page.evaluate(() => {
    const out: string[] = [];
    for (const a of Array.from(document.querySelectorAll("a[href^='mailto:']"))) out.push((a.getAttribute("href") || "").replace(/^mailto:/i, "").split("?")[0]);
    out.push(document.body?.innerText ?? "");
    return out;
  }).catch(() => []);
  const set = new Set<string>();
  for (const t of found) for (const m of t.match(EMAIL_RE) ?? []) {
    const e = m.toLowerCase();
    if (!BAD_EMAIL_RE.test(e)) set.add(e);
  }
  // 代表窓口っぽいものを先頭に
  const score = (e: string) => (/^(info|contact|inquiry|sales|eigyo|support|office|mail|toiawase|otoiawase)@/.test(e) ? 0 : /^(recruit|saiyo|jinji|hr)@/.test(e) ? 2 : 1);
  return Array.from(set).sort((a, b) => score(a) - score(b)).slice(0, 5);
}

/** 送信せずに、フォームの有無・お断り・CAPTCHA・メールアドレスを調べる（事前チェック） */
export async function scanCompany(browser: Browser, input: { formUrl: string; siteUrl: string; companyName?: string }): Promise<ScanResult> {
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.dismiss().catch(() => {}));
  const r: ScanResult = { formUrl: null, refused: null, captcha: null, emails: [], note: "", legalName: null };
  try {
    // トップページからメールを拾う
    const site = input.siteUrl || input.formUrl;
    if (site) {
      try {
        await page.goto(site.startsWith("http") ? site : `https://${site}`, { waitUntil: "domcontentloaded", timeout: 20000 });
        await page.waitForTimeout(400);
        r.emails = await collectEmails(page);
        // 社名に法人格（株式会社など）が無ければ、トップページの表記から正式名称を拾う（AI不要）
        if (input.companyName) {
          const top: string = await page.evaluate(() => document.title + "\n" + (document.body?.innerText ?? "").slice(0, 8000)).catch(() => "");
          r.legalName = extractLegalName(input.companyName, top);
        }
      } catch {
        r.note = "サイトにアクセスできない";
      }
    }
    const formPage = await findContactForm(page, input.formUrl, input.siteUrl);
    if (formPage) {
      r.formUrl = formPage;
      const text: string = await page.evaluate(() => document.body?.innerText ?? "").catch(() => "");
      r.refused = detectRefusal(text);
      if (input.companyName && !r.legalName) r.legalName = extractLegalName(input.companyName, text); // フォームページのフッター等からも
      r.captcha = (await page.evaluate(CAPTCHA_CHECK_SCRIPT).catch(() => null)) as string | null;
      for (const e of await collectEmails(page)) if (!r.emails.includes(e)) r.emails.push(e);
    } else if (!r.note) r.note = "フォームが見つからない";
  } catch (e) {
    r.note = `例外: ${String((e as Error).message ?? e).slice(0, 100)}`;
  } finally {
    await ctx.close().catch(() => {});
  }
  return r;
}
