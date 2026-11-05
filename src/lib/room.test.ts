import { describe, expect, it } from "vite-plus/test";
import { defaults, makePrompt, shortTitle } from "./room";

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

it("restates the duck's core perspective on every turn", () => {
  const { prompt } = makePrompt(defaults[1], [], "conversation", "");
  expect(prompt).toContain(
    "Stay Skeptic: You protect the room from convincing itself of something it has not established.",
  );
});
