import type { Duck } from "./room";

// Hues in the order ducks receive them. Any first six sit at least 40° apart, so a typical
// roster never shows two similar colors. Yellow and amber (reserved for actions and live
// status) and Mediator's violet are left out.
const hues = [135, 20, 225, 330, 180, 265, 355, 155, 245, 40];
const palette = hues.map((hue) => `oklch(80% 0.13 ${hue})`);
export const hostColor = "#c4b5fd";

function hash(id: string) {
  let value = 0;
  for (const char of id) value = (value * 31 + char.charCodeAt(0)) | 0;
  return Math.abs(value);
}

/**
 * Gives every duck a palette slot: its stored one if no earlier duck holds it, otherwise the first
 * free slot. Saving a roster stores these, so later removals leave the other ducks' colors alone.
 */
export function withColors<T extends Pick<Duck, "id" | "color">>(ducks: T[]) {
  const used = new Set<number>();
  const kept = ducks.map((duck) => {
    const color = duck.color !== undefined && !used.has(duck.color) ? duck.color : undefined;
    if (color !== undefined) used.add(color);
    return color;
  });
  return ducks.map((duck, index) => {
    let color = kept[index];
    if (color === undefined) {
      const free = palette.findIndex((_, slot) => !used.has(slot));
      color = free === -1 ? index % palette.length : free;
      used.add(color);
    }
    return { ...duck, color };
  });
}

/** Name colors for a roster. Neighbors in a fresh roster never clash. */
export function rosterColors(ducks: Pick<Duck, "id" | "color">[]) {
  return new Map<string, string>([
    ["mediator", hostColor],
    ["guide", hostColor],
    ...withColors(ducks).map((duck) => [duck.id, palette[duck.color]] as const),
  ]);
}

/** Color for one speaker. Ducks no longer in the roster get a color no current duck uses. */
export function speakerColor(colors: Map<string, string>, id: string) {
  const taken = new Set(colors.values());
  const free = palette.filter((color) => !taken.has(color));
  const choices = free.length ? free : palette;
  return colors.get(id) ?? choices[hash(id) % choices.length];
}
