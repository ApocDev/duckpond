import { describe, expect, it } from "vite-plus/test";
import { rosterColors } from "./duck-colors";

describe("rosterColors", () => {
  it("keeps the first six ducks' hues at least 40 degrees apart", () => {
    const ducks = Array.from({ length: 6 }, (_, index) => ({ id: `duck-${index}` }));
    const colors = rosterColors(ducks);
    const hues = ducks.map((duck) => Number(colors.get(duck.id)!.match(/ (\d+)\)$/)![1]));
    for (const [index, hue] of hues.entries())
      for (const other of hues.slice(index + 1)) {
        const gap = Math.abs(hue - other);
        expect(Math.min(gap, 360 - gap)).toBeGreaterThanOrEqual(40);
      }
  });
});
