/** ゴールド表示用のコイン風マーク（装飾） */
export function GoldCoinIcon({
  className = "inline-block h-[1.1em] w-[1.1em] shrink-0 align-[-0.12em] text-amber-300",
  title,
}: {
  className?: string;
  /** アクセシブル名（省略時は装飾のみ） */
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : "presentation"}
    >
      {title ? <title>{title}</title> : null}
      <circle
        cx="12"
        cy="12"
        r="9.5"
        fill="currentColor"
        fillOpacity="0.22"
        stroke="currentColor"
        strokeOpacity="0.95"
        strokeWidth="1.35"
      />
      <circle cx="12" cy="12" r="6" fill="currentColor" fillOpacity="0.12" />
      <circle
        cx="12"
        cy="12"
        r="3.25"
        stroke="currentColor"
        strokeOpacity="0.55"
        strokeWidth="0.9"
      />
    </svg>
  );
}
