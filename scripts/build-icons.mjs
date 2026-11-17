import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

// Raster fallbacks always come from the same SVG used by the inline marks.
// librsvg is a build tool only; the installed app has no graphics dependency.
const raster = (size, background = []) => execFileSync('rsvg-convert', [
  '--width', String(size), '--height', String(size), ...background, 'web/icon.svg',
]);
await writeFile('web/icon.png', raster(256));
// iOS applies its own corner mask and needs a fully opaque home-screen icon.
await writeFile('web/apple-touch-icon.png', raster(180, ['--background-color', '#e8e8e8']));

const sizes = [16, 32, 48];
const images = sizes.map(size => raster(size));
const directory = Buffer.alloc(6 + 16 * sizes.length);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(sizes.length, 4);
let offset = directory.length;
for (const [index, size] of sizes.entries()) {
  const entry = 6 + index * 16;
  directory[entry] = directory[entry + 1] = size;
  directory.writeUInt16LE(1, entry + 4);
  directory.writeUInt16LE(32, entry + 6);
  directory.writeUInt32LE(images[index].length, entry + 8);
  directory.writeUInt32LE(offset, entry + 12);
  offset += images[index].length;
}
await writeFile('web/favicon.ico', Buffer.concat([directory, ...images]));
