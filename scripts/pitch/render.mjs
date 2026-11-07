// Renders the pitch video from scripts/pitch/composer.html + pitch/shots/*.jpg:
// one MP4 per scene (frames piped straight into ffmpeg), then joined without re-encoding.
// Output: pitch/out/derma-pitch.mp4 (+ a few still frames for review in pitch/out/frames).
import { spawn } from "node:child_process";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const FPS = 30;
const OUT = "pitch/out";
mkdirSync(`${OUT}/frames`, { recursive: true });
mkdirSync(`${OUT}/scenes`, { recursive: true });

const shots = pathToFileURL(resolve("pitch/shots")).href + "/";
const page = await (await chromium.launch()).newPage({
  viewport: { width: 1080, height: 1920 },
  deviceScaleFactor: 1,
});
await page.goto(pathToFileURL(resolve("scripts/pitch/composer.html")).href + "?base=" + encodeURIComponent(shots));
await page.evaluate(() => window.ready);
await page.waitForTimeout(1500);
const durs = await page.evaluate(() => window.SCENES);
console.log("scenes", durs, "total", durs.reduce((a, b) => a + b, 0));

function encoder(file) {
  const ff = spawn("ffmpeg", [
    "-y", "-loglevel", "error",
    "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-",
    "-c:v", "libx264", "-crf", "20", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-r", String(FPS),
    file,
  ]);
  ff.stderr.on("data", (d) => process.stderr.write(d));
  const done = new Promise((res, rej) => ff.on("close", (c) => (c === 0 ? res() : rej(new Error(`ffmpeg ${c}`)))));
  return { ff, done };
}

const files = [];
let start = 0;
for (const [i, dur] of durs.entries()) {
  const frames = Math.round(dur * FPS);
  const tmp = `${OUT}/scenes/scene-${i}.tmp.mp4`;
  const fin = `${OUT}/scenes/scene-${i}.mp4`;
  const { ff, done } = encoder(tmp);
  for (let f = 0; f < frames; f++) {
    const t = start + f / FPS;
    await page.evaluate((x) => window.renderFrame(x), t);
    const jpg = await page.screenshot({ type: "jpeg", quality: 92 });
    if (!ff.stdin.write(jpg)) await new Promise((r) => ff.stdin.once("drain", r));
    // Stills for review: the middle and near the end of each scene.
    if (f === Math.round(frames * 0.5) || f === Math.round(frames * 0.85)) {
      writeFileSync(`${OUT}/frames/s${i}-${f}.jpg`, jpg);
    }
  }
  ff.stdin.end();
  await done;
  renameSync(tmp, fin);
  files.push(fin);
  console.log(`scene ${i} done (${frames} frames)`);
  start += dur;
}

writeFileSync(`${OUT}/scenes/list.txt`, files.map((f) => `file '${resolve(f)}'`).join("\n") + "\n");
await new Promise((res, rej) => {
  const ff = spawn("ffmpeg", [
    "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", `${OUT}/scenes/list.txt`,
    "-c", "copy", "-movflags", "+faststart", `${OUT}/derma-pitch.tmp.mp4`,
  ]);
  ff.stderr.on("data", (d) => process.stderr.write(d));
  ff.on("close", (c) => (c === 0 ? res() : rej(new Error(`concat ${c}`))));
});
renameSync(`${OUT}/derma-pitch.tmp.mp4`, `${OUT}/derma-pitch.mp4`);
console.log("video ready");
process.exit(0);
