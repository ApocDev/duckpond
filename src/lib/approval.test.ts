import { expect, it } from "vite-plus/test";
import { pathsOutside } from "./approval";

it("points out paths a command names outside the project folder", () => {
  expect(pathsOutside("find / -name loans.ts 2>/dev/null", "/pond")).toEqual(["/"]);
  expect(pathsOutside("/usr/bin/bash -lc 'cat /pond/src/loans.ts ~/.ssh/config'", "/pond")).toEqual(
    ["~/.ssh/config"],
  );
  expect(pathsOutside("ls src", "/pond")).toEqual([]);
});
