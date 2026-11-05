import { copyFile } from 'node:fs/promises';

await copyFile('web/src/style.css', 'web/style.css');
