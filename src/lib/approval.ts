import { z } from "zod";
import { shellScript } from "./activity";

/**
 * Absolute paths a command names outside `cwd`, so an approval card can point them out. It reads
 * words, not shell syntax, so it's a hint: `find /` shows up, a path built at runtime doesn't.
 */
export function pathsOutside(command: string, cwd: string) {
  const folder = cwd.replace(/\/+$/, "");
  const words = shellScript(command)
    .split(/\s+/)
    .slice(1)
    .map((word) => word.replace(/^['"(]+|['";|&)]+$/g, ""));
  return [
    ...new Set(
      words.filter(
        (word) =>
          /^(\/|~)/.test(word) &&
          !word.startsWith("/dev/") &&
          word !== folder &&
          !word.startsWith(`${folder}/`),
      ),
    ),
  ];
}

export type ApprovalField = {
  key: string;
  label: string;
  options: string[];
  kind: "text" | "number" | "boolean";
  required: boolean;
};
const questionSchema = z.object({
  id: z.string().optional(),
  question: z.string(),
  options: z.array(z.object({ label: z.string() })).optional(),
});
export function questionFields(value: unknown): ApprovalField[] {
  const parsed = z.array(questionSchema).safeParse(value);
  return parsed.success
    ? parsed.data.map((question) => ({
        key: question.id ?? question.question,
        label: question.question,
        options: question.options?.map((option) => option.label) ?? [],
        kind: "text",
        required: true,
      }))
    : [];
}
export function mcpFields(value: unknown): ApprovalField[] {
  const parsed = z
    .object({
      properties: z.record(
        z.string(),
        z.object({
          title: z.string().optional(),
          description: z.string().optional(),
          type: z.string().optional(),
          enum: z.array(z.string()).optional(),
        }),
      ),
      required: z.array(z.string()).optional(),
    })
    .safeParse(value);
  if (!parsed.success) return [];
  return Object.entries(parsed.data.properties).map(([key, field]) => ({
    key,
    label: field.title ?? field.description ?? key,
    options: field.enum ?? [],
    kind:
      field.type === "boolean"
        ? "boolean"
        : field.type === "number" || field.type === "integer"
          ? "number"
          : "text",
    required: parsed.data.required?.includes(key) ?? false,
  }));
}
