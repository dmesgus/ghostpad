import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Keep every brand mark and browser icon tied to one canonical SVG.
const icon = await readFile('web/icon.svg', 'utf8');
const mark = icon.match(/<g id="orb">([\s\S]+)<\/g>/)?.[1];
if (!mark) throw new Error('web/icon.svg must contain the canonical orb group');
const version = createHash('sha256').update(icon).digest('hex').slice(0, 12);
for (const name of ['index', 'desktop']) {
  const path = `web/${name}.html`;
  const html = (await readFile(path, 'utf8'))
    .replace(/(<svg\b[^>]*\bdata-brand\b[^>]*>)[\s\S]*?<\/svg>/g, (_, opening) => `${opening}${mark}</svg>`)
    .replace(/href="\/(icon\.svg|icon\.png|favicon\.ico|apple-touch-icon\.png)(?:\?v=[a-f0-9]+)?"/g,
      (_, asset) => `href="/${asset}?v=${version}"`);
  await writeFile(path, html);
}

// Compact declaration boundaries and value prefixes, preserving calc spacing.
for (const name of ['style', 'desktop']) {
  const css = (await readFile(`web/src/${name}.css`, 'utf8'))
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s*([{};])\s*/g, '$1').replace(/:\s+/g, ':').trim();
  await writeFile(`web/${name}.css`, css + '\n');
}

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
