import { createHash } from "node:crypto";
import { z } from "zod";

/** Match the exact command, directory, provider and requested privileges. Never use command prefixes. */
export function commandPermission(provider: "codex" | "claude", value: Record<string, unknown>) {
  const parsed = z.object({ command: z.string().min(1), cwd: z.string().min(1) }).safeParse(value);
  if (!parsed.success) return undefined;
  const metadata = new Set([
    "threadId",
    "turnId",
    "itemId",
    "startedAtMs",
    "reason",
    "description",
    "commandActions",
  ]);
  function stable(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, child]) => [key, stable(child)]),
      );
    return value;
  }
  const scope = Object.fromEntries(Object.entries(value).filter(([key]) => !metadata.has(key)));
  const id = createHash("sha256")
    .update(JSON.stringify(stable({ provider, scope })))
    .digest("hex");
  return { id, provider, command: parsed.data.command, cwd: parsed.data.cwd };
}
