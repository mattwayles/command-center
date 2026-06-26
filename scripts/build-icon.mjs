import sharp from 'sharp';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const svgPath = path.join(root, 'assets/icon.svg');
const iconsetDir = path.join(root, 'assets/icon.iconset');
const icnsPath = path.join(root, 'assets/icon.icns');

fs.mkdirSync(iconsetDir, { recursive: true });

// macOS iconset spec: logical size → actual pixel size pairs
const sizes = [
  [16, 16], [16, 32],
  [32, 32], [32, 64],
  [128, 128], [128, 256],
  [256, 256], [256, 512],
  [512, 512], [512, 1024],
];

const svg = fs.readFileSync(svgPath);

for (const [logical, pixels] of sizes) {
  const suffix = pixels === logical ? '' : '@2x';
  const filename = `icon_${logical}x${logical}${suffix}.png`;
  await sharp(svg).resize(pixels, pixels).png().toFile(path.join(iconsetDir, filename));
  console.log(`  wrote ${filename} (${pixels}px)`);
}

execSync(`iconutil -c icns "${iconsetDir}" -o "${icnsPath}"`);
fs.rmSync(iconsetDir, { recursive: true });
console.log(`\nIcon built: assets/icon.icns`);
