// Photos are downscaled and re-encoded before upload. Re-encoding through a
// canvas also drops EXIF, including the phone's GPS tags, so a shared photo
// never carries a location nobody chose to record.

export const MAX_EDGE = 1800;
const QUALITY = 0.82;

/** Scale (w, h) to fit within max on its longer edge, never upscaling. */
export function fitWithin(w: number, h: number, max = MAX_EDGE): [number, number] {
  const k = Math.min(1, max / Math.max(w, h));
  return [Math.round(w * k), Math.round(h * k)];
}

export interface PreparedPhoto {
  blob: Blob;
  width: number;
  height: number;
}

export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error(`${file.name} isn't an image this browser can read. Try a JPEG or PNG.`);
  }
  const [width, height] = fitWithin(bmp.width, bmp.height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, width, height);
  bmp.close();
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", QUALITY));
  if (!blob) throw new Error(`Couldn't process ${file.name}.`);
  return { blob, width, height };
}
