import type { Duck } from "./room";

// Readable on the dark pond background; ordered so neighbors in a roster contrast.
const palette = [
  "#ff9a7a",
  "#7cc8ff",
  "#b9e07a",
  "#e8a0f0",
  "#ffc46b",
  "#6fe0bf",
  "#ff8fb3",
  "#a9a6ff",
];
const hostColor = "#c4b5fd";

/** A duck's name color: its roster position, a fixed color for Guide and Mediator, else a hash. */
export function duckColor(ducks: Pick<Duck, "id">[], id: string) {
  if (id === "guide" || id === "mediator") return hostColor;
  const index = ducks.findIndex((duck) => duck.id === id);
  if (index >= 0) return palette[index % palette.length];
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return palette[Math.abs(hash) % palette.length];
}
