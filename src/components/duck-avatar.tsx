import type { Duck } from "../lib/room";

export function DuckAvatar({
  avatar,
  small = false,
}: {
  avatar: NonNullable<Duck["avatar"]>;
  small?: boolean;
}) {
  return (
    <img className={`duck-avatar ${small ? "small" : ""}`} src={`/brand/${avatar}.png`} alt="" />
  );
}
