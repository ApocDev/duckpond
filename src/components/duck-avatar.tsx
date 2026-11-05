import type { Duck } from "../lib/room";

/**
 * A duck's outfit picture. Pass the duck's color to draw a thin ring in it, which keeps ducks
 * that share an outfit apart.
 */
export function DuckAvatar({
  avatar,
  small = false,
  color,
}: {
  avatar: NonNullable<Duck["avatar"]>;
  small?: boolean;
  color?: string;
}) {
  return (
    <img
      className={`duck-avatar ${small ? "small" : ""} ${color ? "ringed" : ""}`}
      style={color ? { "--duck": color } : undefined}
      src={
        avatar.startsWith("generated-")
          ? `/api/avatar?id=${avatar.slice(10)}`
          : `/brand/${avatar}.png`
      }
      alt=""
    />
  );
}
