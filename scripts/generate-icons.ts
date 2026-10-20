/** Generates the home-screen app icons from the theme colour (run: pnpm tsx scripts/generate-icons.ts). */
import sharp from "sharp";
import { THEME } from "../src/app/theme";

function svg(size: number, maskable: boolean) {
  const pad = maskable ? size * 0.18 : size * 0.1;
  const r = maskable ? 0 : size * 0.22;
  const c = size / 2;
  const s = (size - pad * 2) / 100; // drawing scale
  const at = (x: number, y: number) => `${pad + x * s},${pad + y * s}`;
  // A simple leaf + sparkle mark (no fonts needed).
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <rect width="${size}" height="${size}" rx="${r}" fill="${THEME.brand}"/>
    <path d="M ${at(50, 12)} C ${at(86, 30)} ${at(86, 74)} ${at(50, 90)} C ${at(14, 74)} ${at(14, 30)} ${at(50, 12)} Z" fill="${THEME.brandForeground}" opacity="0.95"/>
    <path d="M ${at(50, 26)} L ${at(50, 80)}" stroke="${THEME.brand}" stroke-width="${3.5 * s}" stroke-linecap="round"/>
    <circle cx="${c}" cy="${c}" r="0" />
  </svg>`;
}

async function main() {
  const jobs: [string, number, boolean][] = [
    ["public/icons/icon-192.png", 192, false],
    ["public/icons/icon-512.png", 512, false],
    ["public/icons/icon-maskable-512.png", 512, true],
    ["public/icons/apple-touch-icon.png", 180, true],
  ];
  for (const [file, size, maskable] of jobs) {
    await sharp(Buffer.from(svg(size, maskable)))
      .png()
      .toFile(file);
    console.log("wrote", file);
  }
}
main();
