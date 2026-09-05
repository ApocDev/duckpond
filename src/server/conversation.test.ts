import { describe, expect, it, vi } from "vite-plus/test";
import { defaults, selectDucks, type Room } from "../lib/room";
vi.mock("./providers.server", () => ({ reply: vi.fn() }));
vi.mock("./store.server", () => ({ saveRoom: vi.fn() }));
import { runConversation } from "./conversation.server";

function room(): Room {
  return {
    id: crypto.randomUUID(),
    title: "New conversation",
    ducks: structuredClone(defaults),
    messages: [],
    notes: "Keep it small",
    observe: false,
    updatedAt: new Date().toISOString(),
  };
}
const emit = () => {};
const persist = () => {};
describe("conversation rounds", () => {
  it("keeps first opinions independent and makes all reviews available to the bounded second round", async () => {
    const value = room();
    const seen: { id: string; prompt: string }[] = [];
    await runConversation(
      value,
      "Would this be fun?",
      "discussion",
      "explorer",
      new AbortController().signal,
      emit,
      async (duck, _system, prompt, _signal, write) => {
        seen.push({ id: duck.id, prompt });
        write(`opinion-${duck.id}`);
      },
      persist,
    );
    expect(seen).toHaveLength(6);
    for (const entry of seen.slice(0, 3)) {
      expect(entry.prompt).toContain("Would this be fun?");
      expect(entry.prompt).not.toContain("opinion-");
    }
    for (const entry of seen.slice(3))
      for (const duck of defaults) expect(entry.prompt).toContain(`opinion-${duck.id}`);
    expect(value.messages).toHaveLength(7);
  });
  it("routes explicit mentions without also calling the default duck", () => {
    expect(selectDucks(defaults, "@skeptic check this", "explorer").map((duck) => duck.id)).toEqual(
      ["skeptic"],
    );
    expect(
      selectDucks(defaults, "Unaddressed thought", "simplifier").map((duck) => duck.id),
    ).toEqual(["simplifier"]);
  });
  it("preserves partial replies on cancellation and does not start the discussion round", async () => {
    const value = room();
    const controller = new AbortController();
    const called: string[] = [];
    await runConversation(
      value,
      "Check this",
      "discussion",
      "explorer",
      controller.signal,
      emit,
      async (duck, _system, _prompt, _signal, write) => {
        called.push(duck.id);
        write("A partial thought");
        controller.abort();
        throw new Error("aborted");
      },
      persist,
    );
    expect(called).toEqual(["explorer"]);
    expect(value.messages.at(-1)).toMatchObject({ text: "A partial thought", status: "stopped" });
  });
  it("removes quiet observers instead of publishing PASS as a contribution", async () => {
    const value = room();
    value.observe = true;
    await runConversation(
      value,
      "A thought",
      "conversation",
      "explorer",
      new AbortController().signal,
      emit,
      async (duck, _system, _prompt, _signal, write) => {
        write(duck.id === "explorer" ? "A question" : "PASS");
      },
      persist,
    );
    expect(value.messages.map((message) => message.text)).toEqual(["A thought", "A question"]);
  });
  it("keeps the other duck's response when one provider fails", async () => {
    const value = room();
    await runConversation(
      value,
      "@explorer @skeptic check",
      "conversation",
      "explorer",
      new AbortController().signal,
      emit,
      async (duck, _system, _prompt, _signal, write) => {
        if (duck.id === "explorer") throw new Error("Usage limit");
        write("Still useful");
      },
      persist,
    );
    expect(value.messages[1]).toMatchObject({ status: "error", text: "Usage limit" });
    expect(value.messages[2]).toMatchObject({ status: "complete", text: "Still useful" });
  });
});
