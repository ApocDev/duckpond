import { describe, expect, it } from "vite-plus/test";
import { rosterColors } from "./duck-colors";

describe("rosterColors", () => {
  it("gives every duck in a roster a different color and keeps a duck's color across rosters", () => {
    const ids = Array.from({ length: 9 }, (_, index) => ({ id: `duck-${index}` }));
    const colors = rosterColors(ids);
    expect(new Set(ids.map((duck) => colors.get(duck.id))).size).toBe(ids.length);
    expect(rosterColors([ids[3]]).get("duck-3")).toBe(rosterColors([ids[3], ids[5]]).get("duck-3"));
  });
});
