// Traces the logo's alpha silhouette into a simplified, normalized 2D outline
// for THREE.ExtrudeGeometry. Run: node scripts/trace-logo.mjs
// Output: src/logoShape.json  ({ points: [[x,y],...], aspect })
import sharp from "/Users/waing/Desktop/vincentt/product/backend/node_modules/sharp/lib/index.js";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, "../public/assets/logo.webp");
const OUT = resolve(__dirname, "../src/logoShape.json");

const W = 200; // trace resolution; higher = crisper edge, more points
const ALPHA_T = 60;
const EPSILON = 0.004; // RDP simplify tolerance in normalized units

const { data, info } = await sharp(SRC)
  .resize({ width: W })
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
const { width, height, channels } = info;

const solid = (x, y) =>
  x >= 0 && y >= 0 && x < width && y < height &&
  data[(y * width + x) * channels + 3] > ALPHA_T;

// Find a start pixel (top-most, then left-most) on the silhouette.
let start = null;
outer: for (let y = 0; y < height; y++)
  for (let x = 0; x < width; x++)
    if (solid(x, y)) { start = [x, y]; break outer; }
if (!start) throw new Error("no opaque pixels found");

// Moore-neighbor boundary tracing (clockwise) of the outer contour.
const N8 = [
  [1, 0], [1, 1], [0, 1], [-1, 1],
  [-1, 0], [-1, -1], [0, -1], [1, -1],
];
const contour = [];
let cur = start;
let backDir = 4; // came from the left
const MAX = width * height * 4;
let guard = 0;
do {
  contour.push(cur);
  let found = false;
  // start searching one step clockwise from where we came
  for (let k = 0; k < 8; k++) {
    const dir = (backDir + 1 + k) % 8;
    const nx = cur[0] + N8[dir][0];
    const ny = cur[1] + N8[dir][1];
    if (solid(nx, ny)) {
      backDir = (dir + 4) % 8; // direction back to cur
      cur = [nx, ny];
      found = true;
      break;
    }
  }
  if (!found) break;
} while ((cur[0] !== start[0] || cur[1] !== start[1]) && ++guard < MAX);

// Ramer-Douglas-Peucker simplification.
function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  let dmax = 0, idx = 0;
  const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1];
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / len;
    if (d > dmax) { dmax = d; idx = i; }
  }
  if (dmax > eps) {
    const left = rdp(pts.slice(0, idx + 1), eps);
    const right = rdp(pts.slice(idx), eps);
    return left.slice(0, -1).concat(right);
  }
  return [pts[0], pts[pts.length - 1]];
}

// Normalize: center on origin, scale so height = 1 (y up).
const xs = contour.map((p) => p[0]);
const ys = contour.map((p) => p[1]);
const minX = Math.min(...xs), maxX = Math.max(...xs);
const minY = Math.min(...ys), maxY = Math.max(...ys);
const h = maxY - minY || 1;
const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
const norm = contour.map(([x, y]) => [(x - cx) / h, -(y - cy) / h]);

const simplified = rdp(norm, EPSILON);
const aspect = (maxX - minX) / (maxY - minY);

writeFileSync(OUT, JSON.stringify({ points: simplified, aspect }));
console.log(
  `traced ${contour.length} -> ${simplified.length} points, aspect ${aspect.toFixed(3)} -> ${OUT}`
);
