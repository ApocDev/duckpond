import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { z } from "zod";

const packetSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  result: z.unknown().optional(),
  error: z.object({ message: z.string() }).optional(),
});
export type CodexPacket = z.infer<typeof packetSchema>;

/** One scoped App Server connection, shared by replies and model discovery. */
export function connectCodex(
  cwd: string,
  signal: AbortSignal,
  onPacket: (packet: CodexPacket) => void | Promise<void> = () => {},
) {
  const child = spawn("codex", ["app-server"], {
    cwd,
    env: { ...process.env, OPENAI_API_KEY: undefined, CODEX_API_KEY: undefined },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let nextId = 0;
  let stderr = "";
  let failure: Error | undefined;
  const pending = new Map<number, ReturnType<typeof Promise.withResolvers<unknown>>>();
  const disconnected = Promise.withResolvers<never>();
  void disconnected.promise.catch(() => {});
  function send(packet: unknown) {
    if (!child.stdin.destroyed) child.stdin.write(JSON.stringify(packet) + "\n");
  }
  function request(method: string, params: unknown) {
    if (failure) return Promise.reject(failure);
    const id = nextId++;
    const task = Promise.withResolvers<unknown>();
    pending.set(id, task);
    send({ id, method, params });
    return task.promise;
  }
  function fail(error: Error) {
    failure ??= error;
    for (const task of pending.values()) task.reject(error);
    pending.clear();
    disconnected.reject(error);
  }
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    void (async () => {
      const packet = packetSchema.parse(JSON.parse(line));
      if (typeof packet.id === "number" && !packet.method) {
        const task = pending.get(packet.id);
        pending.delete(packet.id);
        if (packet.error) task?.reject(new Error(packet.error.message));
        else task?.resolve(packet.result);
      } else await onPacket(packet);
    })().catch((error: unknown) =>
      fail(error instanceof Error ? error : new Error("Invalid Codex response")),
    );
  });
  child.on("error", fail);
  child.stdin.on("error", fail);
  child.on("exit", () => fail(new Error(stderr.trim().slice(-1500) || "Codex disconnected")));
  child.stderr.on("data", (data: Buffer) => {
    stderr = (stderr + data.toString()).slice(-3000);
  });
  function close() {
    signal.removeEventListener("abort", abort);
    fail(new Error(signal.aborted ? "Request stopped" : "Codex connection closed"));
    lines.close();
    child.kill("SIGTERM");
    const timeout = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }, 3000);
    timeout.unref();
  }
  function abort() {
    close();
  }
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) close();
  async function initialize() {
    await request("initialize", {
      clientInfo: { name: "duckpond", title: "Duckpond", version: "0.1.0" },
      capabilities: { experimentalApi: true },
    });
    send({ method: "initialized", params: {} });
  }
  return { request, send, initialize, close, disconnected: disconnected.promise };
}
