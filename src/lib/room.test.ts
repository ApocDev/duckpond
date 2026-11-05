import { describe, expect, it } from "vite-plus/test";
import { shortTitle } from "./room";

describe("shortTitle", () => {
  it("keeps short first lines and cuts long ones at a word boundary", () => {
    expect(shortTitle("Should cables be physical?\nMore detail")).toBe(
      "Should cables be physical?",
    );
    expect(
      shortTitle("Based on where we are right now, what should we be working on next week?"),
    ).toBe("Based on where we are right now, what should we be working…");
  });
});
