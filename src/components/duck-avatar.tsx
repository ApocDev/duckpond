import type { Duck } from "../lib/room";

export function DuckAvatar({
  avatar,
  small = false,
}: {
  avatar: NonNullable<Duck["avatar"]>;
  small?: boolean;
}) {
  return (
    <img
      className={`duck-avatar ${small ? "small" : ""}`}
      src={
        avatar.startsWith("generated-")
          ? `/api/avatar?id=${avatar.slice(10)}`
          : `/brand/${avatar}.png`
      }
      alt=""
    />
  );
}
