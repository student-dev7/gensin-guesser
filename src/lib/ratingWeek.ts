/**
 * レート週次リセット用: 東京（JST）の暦で、その週の月曜日 0 時を含む日付の YYYY-MM-DD キー。
 * 週の定義: 月曜始まり。
 */
export function getRatingWeekMondayKeyJst(now = new Date()): string {
  const ymd = now.toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" });
  const [y, m, day] = ymd.split("-").map((x) => parseInt(x, 10));
  const noonJstMs = Date.parse(
    `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}T12:00:00+09:00`
  );
  const dow = new Date(noonJstMs).getUTCDay();
  const daysFromMon = (dow + 6) % 7;
  const monMs = noonJstMs - daysFromMon * 86400000;
  return new Date(monMs).toLocaleDateString("en-CA", {
    timeZone: "Asia/Tokyo",
  });
}
