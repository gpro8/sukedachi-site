/**
 * Client-side image prep for free-forever on-chain metadata.
 * Compresses uploads so metadataURI stays within a gas-safe budget.
 * No third-party host / pin service.
 */

/** Max length of image field (data URI or https URL) inside JSON before outer encode. */
export const MAX_IMAGE_FIELD_CHARS = 18_000;
/** Soft cap on full metadataURI (outer data:application/json;base64,…) */
export const MAX_METADATA_URI_CHARS = 42_000;

export type PreparedImage =
  | { ok: true; dataUri: string; bytesApprox: number }
  | { ok: false; error: string };

function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(new Error("画像の読み込みに失敗しました"));
    r.readAsDataURL(blob);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("画像を開けませんでした"));
    img.src = src;
  });
}

/**
 * Resize + JPEG compress until data URI ≤ maxChars (or quality floor).
 */
export async function prepareImageFile(
  file: File,
  maxChars = MAX_IMAGE_FIELD_CHARS
): Promise<PreparedImage> {
  if (!file.type.startsWith("image/")) {
    return { ok: false, error: "画像ファイルを選んでください" };
  }
  // Reject absurd files early
  if (file.size > 12 * 1024 * 1024) {
    return { ok: false, error: "ファイルが大きすぎます（12MB未満）" };
  }

  try {
    const rawUri = await blobToDataUri(file);
    const img = await loadImage(rawUri);

    const maxEdge = 720;
    let w = img.naturalWidth || img.width;
    let h = img.naturalHeight || img.height;
    if (w < 1 || h < 1) {
      return { ok: false, error: "無効な画像です" };
    }
    if (w > maxEdge || h > maxEdge) {
      const scale = maxEdge / Math.max(w, h);
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { ok: false, error: "画像処理に失敗しました" };
    ctx.fillStyle = "#f4f1ea";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);

    let quality = 0.78;
    let dataUri = canvas.toDataURL("image/jpeg", quality);
    while (dataUri.length > maxChars && quality > 0.35) {
      quality -= 0.08;
      dataUri = canvas.toDataURL("image/jpeg", quality);
    }

    // Still too big → shrink dimensions
    let scale = 0.85;
    while (dataUri.length > maxChars && scale > 0.35) {
      const nw = Math.max(160, Math.round(w * scale));
      const nh = Math.max(100, Math.round(h * scale));
      canvas.width = nw;
      canvas.height = nh;
      ctx.fillStyle = "#f4f1ea";
      ctx.fillRect(0, 0, nw, nh);
      ctx.drawImage(img, 0, 0, nw, nh);
      dataUri = canvas.toDataURL("image/jpeg", 0.62);
      scale -= 0.1;
    }

    if (dataUri.length > maxChars) {
      return {
        ok: false,
        error:
          "画像を十分に圧縮できませんでした。別の画像にするか、カバー自動生成をご利用ください。",
      };
    }

    return {
      ok: true,
      dataUri,
      bytesApprox: Math.round((dataUri.length * 3) / 4),
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "画像処理エラー",
    };
  }
}

export function isLikelyDisplayableImageSrc(src?: string): boolean {
  if (!src) return false;
  const s = src.trim();
  return (
    s.startsWith("data:image/") ||
    s.startsWith("https://") ||
    s.startsWith("http://") ||
    s.startsWith("ipfs://")
  );
}
