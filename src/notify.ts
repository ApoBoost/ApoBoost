// 送信が止まったときなどに、パソコンの通知（Macの通知センター／Windowsのトースト）で知らせる。
// 追加のソフトは入れず、OSに最初から入っている仕組みだけを使う。失敗しても送信には影響させない（best-effort）。
//
// Mac: 以前は osascript から直接通知を出していたため、通知の持ち主が「スクリプトエディタ」になり、
//      通知を押すとスクリプトエディタが開き、アイコンもスクリプトエディタのものだった。
//      そこで、通知専用の小さなアプリ「ApoBoost」をそのMacの中で作り（osacompile）、そこから通知を出す。
//      通知を押すとそのアプリが起動し、開いているApoBoostのタブを前に出す（無ければ新しく開く）。
import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { S } from "./settings.js";
import { DATA_DIR, getSetting } from "./db.js";

/** 直近に出した通知。同じ内容を何度も出さない（1時間に1回まで） */
const lastSent = new Map<string, number>();

export function notifyEnabled(): boolean {
  return getSetting(S.notifyDesktop, "1") === "1";
}

const appUrl = () => `http://localhost:${Number(process.env.PORT ?? 3210)}`;
const ICON_PNG = path.resolve(process.cwd(), "assets", "icon.png");

// ---- Mac: 通知専用アプリ ----
const NOTIFIER_VERSION = "6"; // 中身を変えたら上げる（各PCで作り直される）
// 置き場所はホームの Library の下にする。data/ の下（＝ダウンロードやデスクトップの中のことが多い）に置くと、
// macOS が「このアプリにダウンロードフォルダを読ませてよいか」を止めてしまい、通知が出なかった
const NOTIFIER_DIR = process.platform === "darwin"
  ? path.join(os.homedir(), "Library", "Application Support", "apoboost", "notifier")
  : path.join(DATA_DIR, "notifier");
const NOTIFIER_APP = path.join(NOTIFIER_DIR, "ApoBoost.app");
const PENDING = path.join(NOTIFIER_DIR, "pending.txt");
const URL_FILE = path.join(NOTIFIER_DIR, "url.txt");
let notifierReady: boolean | null = null;

const q = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** 通知専用アプリの中身（AppleScript）。
 *  ・pending.txt があれば、その内容で通知を出して終わる
 *  ・無ければ「通知が押された」ということなので、ApoBoostの画面を前に出す */
function notifierSource(): string {
  return `
on run
	set msgFile to ${q(PENDING)}
	set urlFile to ${q(URL_FILE)}
	set hasMsg to false
	try
		set txt to read (POSIX file msgFile) as «class utf8»
		do shell script "rm -f " & quoted form of msgFile
		set hasMsg to true
	end try
	if hasMsg then
		set AppleScript's text item delimiters to linefeed
		set parts to text items of txt
		set AppleScript's text item delimiters to ""
		display notification (item 3 of parts) with title (item 1 of parts) subtitle (item 2 of parts) sound name "Submarine"
		delay 1
	else
		set u to "http://localhost:3210"
		try
			set u to do shell script "cat " & quoted form of urlFile
		end try
		my showApp(u)
	end if
end run

-- 開いているApoBoostのタブを前に出す。見つからなければ新しく開く
on showApp(u)
	set found to false
	try
		if application "Google Chrome" is running then
			tell application "Google Chrome"
				repeat with w in windows
					set i to 0
					repeat with t in tabs of w
						set i to i + 1
						if (URL of t) starts with u then
							set active tab index of w to i
							set index of w to 1
							activate
							set found to true
							exit repeat
						end if
					end repeat
					if found then exit repeat
				end repeat
			end tell
		end if
	end try
	if not found then
		try
			if application "Safari" is running then
				tell application "Safari"
					repeat with w in windows
						repeat with t in tabs of w
							if (URL of t) starts with u then
								set current tab of w to t
								set index of w to 1
								activate
								set found to true
								exit repeat
							end if
						end repeat
						if found then exit repeat
					end repeat
				end tell
			end if
		end try
	end if
	if not found then open location u
end showApp
`;
}

/** 通知専用アプリを用意する（無ければ作る）。作れなければ false（その場合は従来の方法で出す） */
export function ensureNotifierApp(): boolean {
  if (notifierReady !== null) return notifierReady;
  try {
    const marker = path.join(NOTIFIER_DIR, "version.txt");
    const want = `${NOTIFIER_VERSION}:${NOTIFIER_DIR}`;
    if (fs.existsSync(NOTIFIER_APP) && fs.existsSync(marker) && fs.readFileSync(marker, "utf8") === want) return (notifierReady = true);
    fs.mkdirSync(NOTIFIER_DIR, { recursive: true });
    fs.rmSync(NOTIFIER_APP, { recursive: true, force: true });
    const srcFile = path.join(NOTIFIER_DIR, "notifier.applescript");
    fs.writeFileSync(srcFile, notifierSource(), "utf8");
    execFileSync("osacompile", ["-o", NOTIFIER_APP, srcFile], { stdio: "ignore" });
    // アイコンをロゴにする（sips と iconutil はMacに最初から入っている）
    if (fs.existsSync(ICON_PNG)) {
      const iconset = path.join(NOTIFIER_DIR, "icon.iconset");
      fs.rmSync(iconset, { recursive: true, force: true });
      fs.mkdirSync(iconset, { recursive: true });
      for (const [size, name] of [[16, "icon_16x16"], [32, "icon_16x16@2x"], [32, "icon_32x32"], [64, "icon_32x32@2x"], [128, "icon_128x128"], [256, "icon_128x128@2x"], [256, "icon_256x256"], [512, "icon_256x256@2x"], [512, "icon_512x512"]] as const) {
        execFileSync("sips", ["-z", String(size), String(size), ICON_PNG, "--out", path.join(iconset, `${name}.png`)], { stdio: "ignore" });
      }
      execFileSync("iconutil", ["-c", "icns", iconset, "-o", path.join(NOTIFIER_APP, "Contents", "Resources", "applet.icns")], { stdio: "ignore" });
      fs.rmSync(iconset, { recursive: true, force: true });
      // 新しいmacOSでは、アプリの絵が Assets.car（標準のスクリプトの絵）から読まれて、上の applet.icns が使われない。
      // Assets.car と、その参照（CFBundleIconName）を外して、ロゴの絵が確実に使われるようにする
      fs.rmSync(path.join(NOTIFIER_APP, "Contents", "Resources", "Assets.car"), { force: true });
      try { execFileSync("plutil", ["-remove", "CFBundleIconName", path.join(NOTIFIER_APP, "Contents", "Info.plist")], { stdio: "ignore" }); } catch { /* 元から無い場合 */ }
    }
    // Dockに出さない（裏で動く小さなアプリとして扱う）＋ 名前をそろえる
    const plist = path.join(NOTIFIER_APP, "Contents", "Info.plist");
    const set = (key: string, type: string, value: string) => execFileSync("plutil", ["-replace", key, type, value, plist], { stdio: "ignore" });
    set("LSUIElement", "-bool", "YES");
    set("CFBundleName", "-string", "ApoBoost");
    set("CFBundleIdentifier", "-string", "jp.apoboost.notifier");
    // 中身を書き換えたので署名し直す（しないと起動できない）
    execFileSync("codesign", ["--force", "--deep", "-s", "-", NOTIFIER_APP], { stdio: "ignore" });
    fs.writeFileSync(marker, want, "utf8");
    notifierReady = true;
  } catch (e) {
    console.error("[apoboost] 通知用アプリを作れませんでした（従来の通知で代用します）:", String((e as Error).message ?? e).slice(0, 200));
    notifierReady = false;
  }
  return notifierReady;
}

// ---- 開いているApoBoostのページから出す通知 ----
// OSの通知（上のアプリ経由）は、macOSの設定や状況（画面の共有・録画中、集中モードなど）で出ないことがあり、
// 「1回目は来たが2回目は来ない」が起きた。そこで、ブラウザで開いているApoBoostのページ自身に通知を出させる。
//  ・ページが数秒ごとに /events を見に来て、新しいお知らせがあればブラウザの通知とページ内の帯で知らせる
//  ・通知を押すと、そのタブが前に出る（探して切り替える必要がない）
//  ・ページを開いていないときだけ、OSの通知（上のアプリ）を使う
export type WebEvent = { id: number; title: string; body: string; at: number };
const webEvents: WebEvent[] = [];
let nextEventId = Date.now(); // 起動のたびに重ならない番号にする（ブラウザ側は「この番号より後」を取りに来る）
let lastClientPoll = 0;

/** ページからの確認（/events）。since より後のお知らせを返す */
export function pollEvents(since: number): { events: WebEvent[]; last: number } {
  lastClientPoll = Date.now();
  // 初めて来たページには、過去のお知らせをまとめて出さない（いまの番号だけ教える）
  const events = since > 0 ? webEvents.filter((e) => e.id > since) : [];
  return { events, last: webEvents.length ? webEvents[webEvents.length - 1].id : nextEventId };
}
/** いまブラウザでページが開いているか（裏のタブは確認の間隔が1分ほどに延びるので、長めに見る） */
function webClientAlive(): boolean {
  return Date.now() - lastClientPoll < 90_000;
}

/** パソコンに通知を出す。key が同じ通知は1時間に1回だけ。出した（または出そうとした）ら true */
export function notify(title: string, body: string, key = title): boolean {
  // 同じ内容は1時間に1回まで（画面のログも同じ扱い。以前は通知だけ抑えて、ログには毎分出し続けていた）
  const now = Date.now();
  if (now - (lastSent.get(key) ?? 0) < 60 * 60_000) return false;
  lastSent.set(key, now);
  console.log(`[apoboost] お知らせ: ${title} — ${body}`);
  if (!notifyEnabled()) return true;
  if (process.env.FO_NO_NOTIFY === "1") return true; // 自動テスト中は、利用者の画面に通知を出さない
  // 開いているページ向けに積んでおく（直近50件）
  webEvents.push({ id: ++nextEventId, title: title.slice(0, 60), body: body.replace(/\s+/g, " ").slice(0, 180), at: now });
  if (webEvents.length > 50) webEvents.shift();
  // ページが開いていれば、通知はページに任せる（OSの通知と二重に出さない）
  if (webClientAlive()) return true;
  const t = title.replace(/["'\\\n]/g, " ").slice(0, 60);
  const b = body.replace(/["'\\]/g, " ").replace(/\s+/g, " ").slice(0, 180);
  try {
    if (process.platform === "darwin") {
      if (ensureNotifierApp()) {
        // 1行目=タイトル、2行目=小見出し、3行目=本文。-g は「前面に出さない」
        fs.writeFileSync(URL_FILE, appUrl(), "utf8");
        fs.writeFileSync(PENDING, `ApoBoost\n${t}\n${b}`, "utf8");
        execFile("open", ["-g", "-n", NOTIFIER_APP], () => {});
      } else {
        execFile("osascript", ["-e", `display notification "${b}" with title "ApoBoost" subtitle "${t}" sound name "Submarine"`], () => {});
      }
    } else if (process.platform === "win32") {
      // Windows 10/11 のトースト通知（PowerShell の標準機能だけで出す）。
      // 押すとApoBoostの画面を開き（activationType=protocol）、左の絵はロゴにする。
      // 新しい形で作れなかった場合は、これまでの形（文字だけ）で出す
      const x = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const logo = fs.existsSync(ICON_PNG) ? `<image placement='appLogoOverride' src='file:///${ICON_PNG.replace(/\\/g, "/")}'/>` : "";
      const xml = `<toast activationType='protocol' launch='${appUrl()}'><visual><binding template='ToastGeneric'>${logo}<text>ApoBoost: ${x(t)}</text><text>${x(b)}</text></binding></visual></toast>`;
      const ps = `$ErrorActionPreference='SilentlyContinue';[Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime]>$null;[Windows.Data.Xml.Dom.XmlDocument,Windows.Data.Xml.Dom.XmlDocument,ContentType=WindowsRuntime]>$null;` +
        `$x=New-Object Windows.Data.Xml.Dom.XmlDocument;$x.LoadXml("${xml}");` +
        `if($x.GetElementsByTagName('text').Length -eq 0){$x=[Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02);` +
        `$n=$x.GetElementsByTagName('text');$n.Item(0).AppendChild($x.CreateTextNode('ApoBoost: ${t}'))>$null;$n.Item(1).AppendChild($x.CreateTextNode('${b}'))>$null};` +
        `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('ApoBoost').Show([Windows.UI.Notifications.ToastNotification]::new($x))`;
      execFile("powershell", ["-NoProfile", "-WindowStyle", "Hidden", "-Command", ps], () => {});
    }
  } catch {
    /* 通知が出せなくても送信は続ける */
  }
  return true;
}
