// 画面のHTML。画面ごとに src/ui/ の下のファイルに分かれている（#139）。
// ここは、これまでどおり "./views.js" から読めるようにまとめて再輸出しているだけ。
// 新しい画面を足すときは src/ui/ に置き、ここに1行足す。
export { esc, layout, n, errorPage, settingsTabs, type NavUser } from "./ui/layout.js";
export * from "./ui/parts.js";
export * from "./ui/home.js";
export * from "./ui/senders.js";
export * from "./ui/campaign.js";
export * from "./ui/job.js";
export * from "./ui/settings.js";
export * from "./ui/account.js";
export * from "./ui/onboarding.js";
export * from "./ui/stats.js";
export * from "./ui/game.js";
export * from "./ui/todo.js";
export * from "./ui/appointments.js";
