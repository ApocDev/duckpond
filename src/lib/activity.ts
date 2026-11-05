/** A provider tool event, normalized from Claude tool calls and Codex thread items. */
export type ToolEvent = {
  /** Claude tool name, Codex item type, or Codex MCP tool name. */
  name: string;
  input?: unknown;
  command?: string;
};

function field(input: unknown, ...keys: string[]) {
  if (!input || typeof input !== "object") return undefined;
  const record = Object.fromEntries(Object.entries(input));
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

/** The last path segment, so labels stay short. */
function file(path?: string) {
  return path ? path.split("/").filter(Boolean).slice(-2).join("/") : undefined;
}

/** The program being run, without its arguments. */
function program(command?: string) {
  const words =
    command
      ?.replace(/^(cd [^&;]+(&&|;)\s*)+/, "")
      .trim()
      .split(/\s+/) ?? [];
  const name = words[0] === "bash" || words[0] === "sh" ? "a script" : words.slice(0, 2).join(" ");
  return name.length > 40 ? `${name.slice(0, 40)}…` : name;
}

/** A short present-tense description of what a duck is doing, for status lines. */
export function activityLabel({ name, input, command }: ToolEvent) {
  const path = file(field(input, "file_path", "path", "notebook_path"));
  switch (name) {
    case "Read":
      return path ? `reading ${path}` : "reading a file";
    case "Grep":
    case "Glob":
    case "LS":
      return "searching files";
    case "Edit":
    case "MultiEdit":
    case "Write":
    case "NotebookEdit":
    case "fileChange":
      return path ? `editing ${path}` : "editing files";
    case "Bash":
    case "commandExecution":
      return `running ${program(command ?? field(input, "command")) || "a command"}`;
    case "WebSearch":
    case "webSearch":
      return "searching the web";
    case "WebFetch":
      return "reading a web page";
    case "Task":
      return "delegating a subtask";
    case "TodoWrite":
    case "plan":
    case "todoList":
      return "planning";
    case "imageGeneration":
      return "drawing";
  }
  if (name.startsWith("mcp__")) return `using ${name.split("__")[1] ?? "a tool"}`;
  if (
    /^(ask_duck|request_turn|start_review|assign_action|report_action|review_action|give_floor|finish_discussion)$/.test(
      name,
    )
  )
    return "coordinating";
  return "working";
}
