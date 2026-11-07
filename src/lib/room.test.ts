import { describe, expect, it } from "vite-plus/test";
import { defaults, duckRole, makePrompt, shortTitle } from "./room";

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

it("labels models the same way with or without a loaded catalog", async () => {
  const { modelLabel } = await import("./models");
  expect(modelLabel("gpt-5.6-luna", "medium")).toBe("GPT-5.6-Luna · Medium");
  expect(modelLabel("", "")).toBe("Default model");
  expect(modelLabel("sonnet", undefined, "Claude Sonnet")).toBe("Claude Sonnet");
});

it("rewords a persona's opening for the person picking a duck", () => {
  expect(duckRole(defaults[0].instructions)).toBe(
    "Protects possibility and the spark that makes an idea worth pursuing.",
  );
  expect(duckRole("You are blunt. Be brief.")).toBe("Is blunt.");
  expect(duckRole("Be a calm partner. Listen.")).toBe("Be a calm partner.");
});
