/**
 * Client-side background removal for a flat NFT image.
 *
 * Most PFP art (T00ns included) sits on a solid background colour, so a
 * flood-fill seeded from the image corners removes the connected background
 * while leaving the character — and, crucially, never punches holes in
 * interior pixels that happen to share the background colour, because it only
 * clears the region reachable from the border.
 *
 * Returns a PNG data URL with the background made transparent, or null when it
 * can't run (tainted canvas from a cross-origin image without CORS headers, or
 * no 2D context) so the caller can fall back to the original image.
 */
export function cutoutBackground(
  img: HTMLImageElement,
  maxSize = 256,
  tolerance = 72,
): string | null {
  const nw = img.naturalWidth || img.width;
  const nh = img.naturalHeight || img.height;
  if (!nw || !nh) return null;

  const scale = Math.min(1, maxSize / Math.max(nw, nh));
  const w = Math.max(1, Math.round(nw * scale));
  const h = Math.max(1, Math.round(nh * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, w, h);

  let data: ImageData;
  try {
    data = ctx.getImageData(0, 0, w, h);
  } catch {
    return null; // cross-origin taint — caller keeps the original
  }
  const px = data.data;

  // Seed colour = average of the four corners.
  const corners = [
    [0, 0],
    [w - 1, 0],
    [0, h - 1],
    [w - 1, h - 1],
  ];
  let sr = 0;
  let sg = 0;
  let sb = 0;
  for (const [x, y] of corners) {
    const i = (y * w + x) * 4;
    sr += px[i];
    sg += px[i + 1];
    sb += px[i + 2];
  }
  sr /= 4;
  sg /= 4;
  sb /= 4;

  const tol2 = tolerance * tolerance;
  const matches = (i: number) => {
    const dr = px[i] - sr;
    const dg = px[i + 1] - sg;
    const db = px[i + 2] - sb;
    return dr * dr + dg * dg + db * db <= tol2;
  };

  // Flood-fill inward from every border pixel.
  const visited = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let x = 0; x < w; x++) {
    stack.push(x, x + (h - 1) * w);
  }
  for (let y = 0; y < h; y++) {
    stack.push(y * w, w - 1 + y * w);
  }

  let cleared = 0;
  while (stack.length) {
    const p = stack.pop()!;
    if (visited[p]) continue;
    visited[p] = 1;
    const i = p * 4;
    if (!matches(i)) continue;
    px[i + 3] = 0; // transparent
    cleared++;
    const x = p % w;
    const y = (p - x) / w;
    if (x + 1 < w) stack.push(p + 1);
    if (x - 1 >= 0) stack.push(p - 1);
    if (y + 1 < h) stack.push(p + w);
    if (y - 1 >= 0) stack.push(p - w);
  }

  // If almost nothing was removed the background probably wasn't solid; keep
  // the original rather than showing a barely-changed image.
  if (cleared < w * h * 0.02) return null;

  ctx.putImageData(data, 0, 0);
  return canvas.toDataURL("image/png");
}
