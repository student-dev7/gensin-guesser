import { avatarInitial, uidToAvatarBackground } from "@/lib/avatarColors";

type Props = {
  uid: string;
  displayName: string;
  size?: "sm" | "md";
};

export function RankingAvatar({ uid, displayName, size = "sm" }: Props) {
  const bg = uidToAvatarBackground(uid);
  const initial = avatarInitial(displayName);
  const dim = size === "md" ? "h-10 w-10 text-base" : "h-8 w-8 text-sm";

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white shadow-inner ring-1 ring-white/15 ${dim}`}
      style={{ backgroundColor: bg }}
      aria-hidden
    >
      {initial}
    </span>
  );
}
