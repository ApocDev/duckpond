import { expect, it } from "vite-plus/test";
import { pathsOutside } from "./approval";

it("points out paths a command names outside the project folder", () => {
  expect(pathsOutside("find / -name loans.ts 2>/dev/null", "/pond")).toEqual(["/"]);
  expect(pathsOutside("/usr/bin/bash -lc 'cat /pond/src/loans.ts ~/.ssh/config'", "/pond")).toEqual(
    ["~/.ssh/config"],
  );
  expect(pathsOutside("ls src", "/pond")).toEqual([]);
  expect(pathsOutside("S=/tmp/other cp a.ts $TMPDIR/t.ts // note", "/pond")).toEqual([
    "/tmp/other",
    "$TMPDIR/t.ts",
  ]);
  expect(
    pathsOutside(
      "cat > src/loans.ts <<'EOF'\n/** Loans */\nconst a = b / c;\nEOF\nnode -e \"const x = '/returned'\" /tmp/t.json",
      "/pond",
    ),
  ).toEqual(["/tmp/t.json"]);
  expect(pathsOutside("/repo/node_modules/.bin/tsc --noEmit", "/pond")).toEqual([
    "/repo/node_modules/.bin/tsc",
  ]);
});
