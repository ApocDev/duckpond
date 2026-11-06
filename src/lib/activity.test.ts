import { expect, it } from "vite-plus/test";
import { activityLabel } from "./activity";

it("describes provider tool events in plain words", () => {
  expect(activityLabel({ name: "Read", input: { file_path: "/repo/docs/garage-loop.md" } })).toBe(
    "reading docs/garage-loop.md",
  );
  expect(activityLabel({ name: "commandExecution", command: "cd /repo && pnpm test --run" })).toBe(
    "running pnpm test",
  );
  expect(
    activityLabel({
      name: "commandExecution",
      command: "/usr/bin/bash -lc 'sed -n 1,80p README.md'",
    }),
  ).toBe("running sed -n");
  expect(
    activityLabel({
      name: "fileChange",
      input: { changes: [{ path: "/pond/src/loans.ts" }, { path: "/pond/README.md" }] },
    }),
  ).toBe("editing src/loans.ts and 1 more");
  expect(activityLabel({ name: "mcp__unity__get_scene" })).toBe("using unity");
  expect(activityLabel({ name: "somethingNew" })).toBe("working");
});
