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

/** Name colors for a roster, given out in roster order so neighbors in the list never clash. */
export function rosterColors(ducks: Pick<Duck, "id">[]) {
  return new Map<string, string>([
    ["mediator", hostColor],
    ["guide", hostColor],
    ...ducks.map((duck, index) => [duck.id, palette[index % palette.length]] as const),
  ]);
}

/** Color for one speaker, including ducks no longer in the roster. */
export function speakerColor(colors: Map<string, string>, id: string) {
  return colors.get(id) ?? palette[hash(id) % palette.length];
}
