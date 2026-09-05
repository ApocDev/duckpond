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
