// Photos are re-drawn on a canvas before upload. That keeps a web-sized copy
// (the full-size original stays with the school) and drops all metadata,
// including GPS location, because a canvas export carries none.

export type PreparedImage = { blob: Blob; width: number; height: number };

async function draw(bitmap: ImageBitmap, maxSide: number, quality: number): Promise<PreparedImage> {
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, width, height);

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), "image/jpeg", quality),
  );
  return { blob, width, height };
}

export async function prepareImage(file: File) {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const full = await draw(bitmap, 2048, 0.85);
    const thumb = await draw(bitmap, 480, 0.75);
    return { full, thumb };
  } finally {
    bitmap.close();
  }
}

export function thumbPath(storagePath: string) {
  return storagePath.replace(/\.jpg$/, "_t.jpg");
}
