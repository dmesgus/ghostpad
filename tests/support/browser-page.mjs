import { createHash } from 'node:crypto';

// Match src/page.rs, including its exact CSP hashes. read accepts a web asset name.
export async function browserPage(read) {
 const [source,css,boot,fill,g,t,a]=await Promise.all(
  ['index.html','style.css','boot.js','super-fill.js','gestures.js','text.js','app.js'].map(read)
 );
 const gestures=g.replace('export class Gestures','class Gestures');
 const text=t.replaceAll('export function','function');
 // Older revisions used by the comparison profiler have no momentum module.
 const scroll=a.includes("from './scroll.js'")?(await read('scroll.js')).replace('export class ScrollMomentum','class ScrollMomentum'):'';
 const app=a.replace("import { Gestures } from './gestures.js';",'').replace("import { ScrollMomentum } from './scroll.js';",'').replace("import { textEdit, normalizeText } from './text.js';",'');
 const script=`(function () {\n${gestures}\n${text}\n${scroll}\n${app}\n})();`;
 const html=source.replace('<link rel="stylesheet" href="/style.css">',()=>`<style>${css}</style>`)
  .replace('<script src="/super-fill.js"></script>','')
  .replace('<script type="module" src="/app.js"></script>',()=>`<script>${boot}</script><script>${fill}</script><script>${script}</script>`);
 const hash=s=>createHash('sha256').update(s).digest('base64');
 const policy=`default-src 'self'; connect-src 'self' ws://ghostpad.test; style-src 'self' 'sha256-${hash(css)}'; script-src 'self' 'sha256-${hash(boot)}' 'sha256-${hash(script)}' 'sha256-${hash(fill)}'`;
 return {html,policy};
}
