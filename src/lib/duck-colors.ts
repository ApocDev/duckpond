import type { Duck } from "./room";

// Twelve hues on the dark pond background, alternating lighter and deeper so neighbors differ in
// brightness as well as hue. Yellow (reserved for actions and live status) and Mediator's
// lavender are left out.
const palette = [0, 22, 45, 128, 150, 172, 194, 216, 238, 260, 318, 338].map(
  (hue, index) => `oklch(${index % 2 ? 72 : 84}% ${index % 2 ? 0.14 : 0.11} ${hue})`,
);
export const hostColor = "#c4b5fd";

function hash(id: string) {
  let value = 0;
  for (const char of id) value = (value * 31 + char.charCodeAt(0)) | 0;
  return Math.abs(value);
}

/**
 * Name colors for a roster. Each duck keeps the color its id hashes to, so it looks the same in
 * every conversation; a collision within the roster moves to the next free color.
 */
export function rosterColors(ducks: Pick<Duck, "id">[]) {
  const colors = new Map<string, string>([
    ["mediator", hostColor],
    ["guide", hostColor],
  ]);
  const taken = new Set<number>();
  for (const duck of ducks) {
    let slot = hash(duck.id) % palette.length;
    for (let step = 0; step < palette.length && taken.has(slot); step++)
      slot = (slot + 1) % palette.length;
    taken.add(slot);
    colors.set(duck.id, palette[slot]);
  }
  return colors;
}

/** Color for one speaker, including ducks no longer in the roster. */
export function speakerColor(colors: Map<string, string>, id: string) {
  return colors.get(id) ?? palette[hash(id) % palette.length];
}
