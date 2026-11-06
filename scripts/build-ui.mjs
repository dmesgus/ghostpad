import { readFile, readdir, writeFile } from 'node:fs/promises';

// Compact declaration boundaries and value prefixes, preserving calc spacing.
const css = (await readFile('web/src/style.css', 'utf8'))
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s*([{};])\s*/g, '$1').replace(/:\s+/g, ':').trim();
await writeFile('web/style.css', css + '\n');

// Drop indentation only where it cannot belong to a multiline string. Keep
// newlines (and thus automatic semicolon insertion) and all literal text intact.
for (const name of await readdir('web/src')) {
  if (!name.endsWith('.ts')) continue;
  const path = `web/${name.slice(0, -3)}.js`;
  const code = await readFile(path, 'utf8');
  const templates = code.match(/`(?:\\[\s\S]|[^`\\])*`/g) || [];
  const singleLineTemplates = templates.every(value => !/[\r\n]/.test(value));
  if (singleLineTemplates && !/\\\r?\n/.test(code))
    await writeFile(path, code.replace(/^[ \t]+/gm, ''));
}
