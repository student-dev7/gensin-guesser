import { redirect } from "next/navigation";

/** 旧 URL。リアルタイム対戦＝ルーム（/rooms）と同一。 */
export default function RtBattleRedirectPage() {
  redirect("/rooms");
}
