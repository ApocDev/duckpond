/** Find the mention under the caret, including any unfinished suffix. */
export function mentionAt(text: string, caret: number) {
  const match = /(?:^|\s)@([\w-]*)$/.exec(text.slice(0, caret));
  if (!match) return null;
  return {
    start: caret - match[1].length - 1,
    end: caret + (/^[\w-]*/.exec(text.slice(caret))?.[0].length ?? 0),
    query: match[1].toLowerCase(),
  };
}

export function insertMention(text: string, range: { start: number; end: number }, id: string) {
  const suffix = text.slice(range.end);
  const prefix = text.slice(0, range.start) + `@${id}` + (/^\s/.test(suffix) ? "" : " ");
  return { text: prefix + suffix, caret: prefix.length };
}

/** Readable aliases leave stored duck IDs and provider sessions unchanged. */
export function mentionHandle(
  duck: { id: string; name: string },
  ducks: { id: string; name: string }[],
) {
  const slug = (name: string) =>
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  const name = slug(duck.name);
  if (
    !name ||
    ducks.some((other) => other.id !== duck.id && (slug(other.name) === name || other.id === name))
  )
    return duck.id;
  return name;
}
