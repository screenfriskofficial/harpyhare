import { t } from "@/i18n";
import { downscaleFactor, NO_DOWNSCALE, toImagePayload, type Attachment } from "@/lib/composer";

const DOWNSCALE_JPEG_QUALITY = 0.85;
const DOWNSCALE_MEDIA_TYPE = "image/jpeg";
const MIN_CANVAS_SIDE_PX = 1;
const DATA_URL_BASE64_MARKER = ";base64,";
const SCREENSHOT_FILE_NAME = "screenshot";

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      resolve(fr.result as string);
    };
    fr.onerror = () => {
      reject(new Error(fr.error?.message ?? t("errors.fileReadFailed")));
    };
    fr.readAsDataURL(file);
  });
}

function scaledSidePx(sidePx: number, factor: number): number {
  return Math.max(MIN_CANVAS_SIDE_PX, Math.round(sidePx * factor));
}

async function downscaleToJpegDataUrl(file: File, factor: number): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = scaledSidePx(bitmap.width, factor);
  canvas.height = scaledSidePx(bitmap.height, factor);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error(t("errors.canvasContextUnavailable"));
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL(DOWNSCALE_MEDIA_TYPE, DOWNSCALE_JPEG_QUALITY);
}

async function fileToAttachment(file: File): Promise<Attachment> {
  const factor = downscaleFactor(file.size);
  if (factor === NO_DOWNSCALE) {
    const dataUrl = await readAsDataUrl(file);
    return { payload: toImagePayload(dataUrl, file.type), preview: dataUrl };
  }
  const dataUrl = await downscaleToJpegDataUrl(file, factor);
  return { payload: toImagePayload(dataUrl, DOWNSCALE_MEDIA_TYPE), preview: dataUrl };
}

/** Картинка, которую не удалось прочитать или ужать, — `null`; причину решает вызывающий. */
export async function fileToAttachmentOrNull(file: File): Promise<Attachment | null> {
  try {
    return await fileToAttachment(file);
  } catch {
    return null;
  }
}

export function dataUrlToFile(dataUrl: string, mediaType: string): File {
  const markerIdx = dataUrl.indexOf(DATA_URL_BASE64_MARKER);
  const base64 =
    markerIdx >= 0 ? dataUrl.slice(markerIdx + DATA_URL_BASE64_MARKER.length) : dataUrl;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], SCREENSHOT_FILE_NAME, { type: mediaType });
}
