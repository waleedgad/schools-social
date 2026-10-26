// Photo adjustments done in the browser, pixel by pixel, so they look the
// same on every device (Safari has no canvas filters).

export const CROPS = { original: 0, square: 1, portrait: 4 / 5, landscape: 16 / 9 } as const;
export type Crop = keyof typeof CROPS;

export type EditSettings = {
  exposure: number; // -1..1, in stops
  contrast: number; // -1..1
  saturation: number; // -1..1
  warmth: number; // -1..1
  black: number; // 0..0.3, levels black point
  white: number; // 0.7..1, levels white point
  crop: Crop;
  position: number; // 0..1, where the crop sits along the long side
};

export const NO_EDIT: EditSettings = {
  exposure: 0,
  contrast: 0,
  saturation: 0,
  warmth: 0,
  black: 0,
  white: 1,
  crop: "original",
  position: 0.5,
};

export function cropBox(width: number, height: number, crop: Crop, position: number) {
  const ratio = CROPS[crop];
  if (!ratio) return { sx: 0, sy: 0, sw: width, sh: height };
  if (width / height > ratio) {
    const sw = Math.round(height * ratio);
    return { sx: Math.round((width - sw) * position), sy: 0, sw, sh: height };
  }
  const sh = Math.round(width / ratio);
  return { sx: 0, sy: Math.round((height - sh) * position), sw: width, sh };
}

function adjust(data: Uint8ClampedArray, s: EditSettings) {
  const gain = 2 ** s.exposure;
  const range = Math.max(0.05, s.white - s.black);
  const sat = 1 + s.saturation;
  const contrast = 1 + s.contrast;
  const warm = s.warmth * 0.08;

  // One lookup table for the tone steps, then colour steps per pixel.
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    let v = (i / 255 - s.black) / range;
    v *= gain;
    v = (v - 0.5) * contrast + 0.5;
    lut[i] = v;
  }

  for (let i = 0; i < data.length; i += 4) {
    let r = lut[data[i]];
    let g = lut[data[i + 1]];
    let b = lut[data[i + 2]];
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    r = luma + (r - luma) * sat + warm;
    g = luma + (g - luma) * sat;
    b = luma + (b - luma) * sat - warm;
    data[i] = r * 255;
    data[i + 1] = g * 255;
    data[i + 2] = b * 255;
  }
}

// Draws the edited photo, at most maxSide pixels on its long side.
export function render(bitmap: ImageBitmap, s: EditSettings, maxSide: number) {
  const box = cropBox(bitmap.width, bitmap.height, s.crop, s.position);
  const scale = Math.min(1, maxSide / Math.max(box.sw, box.sh));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(box.sw * scale);
  canvas.height = Math.round(box.sh * scale);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bitmap, box.sx, box.sy, box.sw, box.sh, 0, 0, canvas.width, canvas.height);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  adjust(pixels.data, s);
  ctx.putImageData(pixels, 0, 0);
  return canvas;
}

// "Auto": stretch the tones so the darkest and brightest 1% reach black and
// white, lift dark photos, and add a little colour to flat ones.
export function autoSettings(bitmap: ImageBitmap): EditSettings {
  const size = 256;
  const scale = Math.min(1, size / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);

  const hist = new Array(256).fill(0);
  let satSum = 0;
  let rSum = 0;
  let bSum = 0;
  const count = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    hist[Math.round(0.299 * r + 0.587 * g + 0.114 * b)]++;
    satSum += (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
    rSum += r;
    bSum += b;
  }
  const percentile = (p: number) => {
    let seen = 0;
    for (let i = 0; i < 256; i++) {
      seen += hist[i];
      if (seen >= count * p) return i / 255;
    }
    return 1;
  };
  const black = Math.min(0.3, percentile(0.01));
  const white = Math.max(0.7, percentile(0.99));
  const median = (percentile(0.5) - black) / Math.max(0.05, white - black);
  const exposure = Math.max(-0.5, Math.min(0.8, Math.log2(0.45 / Math.max(0.05, median)) * 0.6));
  const saturation = satSum / count < 0.2 ? 0.15 : 0.05;
  const cast = (rSum - bSum) / count / 255; // > 0 is already warm
  const warmth = Math.max(-0.5, Math.min(0.5, -cast * 2));

  const round = (v: number) => Math.round(v * 100) / 100;
  return { ...NO_EDIT, black: round(black), white: round(white), exposure: round(exposure), saturation, warmth: round(warmth), contrast: 0.05 };
}
