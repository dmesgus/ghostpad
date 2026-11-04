/** Convert native keyboard edits to a bounded tail replacement at the remote caret. */
export function textEdit(previous: string, next: string): { backspaces: number; text: string } {
  if (next.length > 512) throw new Error('Keep each message under 512 characters.');
  if (!/^[\x20-\x7e\n\t]*$/.test(next)) throw new Error('This receiver supports English / US keyboard characters. Use the key grid for shortcuts.');
  let common = 0;
  while (common < previous.length && common < next.length && previous[common] === next[common]) common++;
  return { backspaces: previous.length - common, text: next.slice(common) };
}
export function normalizeText(text: string): string {
  return text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...').replace(/\u00a0/g, ' ');
}
