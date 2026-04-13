import type { Metadata } from "next";
import { RoomsLobby } from "./RoomsLobby";

export const metadata: Metadata = {
  title: "リアルタイム対戦 | GenshinGuesser",
  description: "野良や友達と盛り上がろう。リアルタイム対戦（ルーム）。",
};

export default function RoomsPage() {
  return <RoomsLobby />;
}
