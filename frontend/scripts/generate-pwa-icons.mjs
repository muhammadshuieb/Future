import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { PNG } = require("pngjs");

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "..", "public");

/** Brand-adjacent radial fill (no native deps). `radiusScale`: 1 = full tile; maskable uses < 1 for safe zone. */
function fillRadial(width, height, radiusScale) {
  const png = new PNG({ width, height });
  const cx = width / 2;
  const cy = height / 2;
  const maxD = (Math.min(width, height) / 2) * radiusScale;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (width * y + x) << 2;
      const d = Math.hypot(x - cx, y - cy);
      if (d > maxD) {
        png.data[i] = 15;
        png.data[i + 1] = 23;
        png.data[i + 2] = 42;
        png.data[i + 3] = 255;
        continue;
      }
      const t = d / maxD;
      const pulse = 0.12 * Math.sin(t * Math.PI * 5);
      const core = Math.pow(1 - t, 1.4) + pulse;
      const r = Math.min(255, Math.round(15 + (59 - 15) * core));
      const g = Math.min(255, Math.round(23 + (130 - 23) * core * 0.95));
      const b = Math.min(255, Math.round(42 + (246 - 42) * core * 0.85));
      png.data[i] = r;
      png.data[i + 1] = g;
      png.data[i + 2] = b;
      png.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

function main() {
  writeFileSync(join(publicDir, "pwa-192x192.png"), fillRadial(192, 192, 1));
  writeFileSync(join(publicDir, "pwa-512x512.png"), fillRadial(512, 512, 1));
  writeFileSync(join(publicDir, "apple-touch-icon.png"), fillRadial(180, 180, 1));
  writeFileSync(join(publicDir, "pwa-maskable-512x512.png"), fillRadial(512, 512, 0.52));
  console.log("PWA icons written to public/");
}

main();
