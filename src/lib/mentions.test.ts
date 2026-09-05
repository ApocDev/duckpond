import { expect, it } from "vite-plus/test";
import { insertMention, mentionAt } from "./mentions";
import { defaults, ducksSchema, roomSchema, selectDucks } from "./room";

it("finds mentions at the caret without treating email addresses as mentions", () => {
  expect(mentionAt("Thoughts @sk", 12)).toEqual({ start: 9, end: 12, query: "sk" });
  expect(mentionAt("name@example.com", 12)).toBeNull();
  expect(mentionAt("@", 1)).toEqual({ start: 0, end: 1, query: "" });
});
it("replaces a mention in the middle without discarding the rest of the message", () => {
  const text = "Ask @skept about fun";
  const range = mentionAt(text, 7)!;
  expect(insertMention(text, range, "skeptic")).toEqual({
    text: "Ask @skeptic about fun",
    caret: 12,
  });
});
it("routes added ducks by stable handle and falls back when a selected duck was removed", () => {
  const duck = { ...defaults[0], id: "play-tester", name: "Play Tester" };
  expect(selectDucks([defaults[0], duck], "@play-tester thoughts?", "explorer")).toEqual([duck]);
  expect(selectDucks([duck], "A new thought", "explorer")).toEqual([duck]);
  expect(ducksSchema.safeParse([duck, duck]).success).toBe(false);
  expect(ducksSchema.safeParse([]).success).toBe(false);
});
it("reads existing rooms without reasoning or avatar fields and accepts changing roster sizes", () => {
  const room = {
    id: crypto.randomUUID(),
    title: "Existing",
    ducks: defaults,
    messages: [],
    notes: "",
    observe: false,
    updatedAt: "now",
  };
  expect(roomSchema.parse(room).ducks).toEqual(defaults);
  expect(roomSchema.parse({ ...room, ducks: [defaults[0]] }).ducks).toHaveLength(1);
});
