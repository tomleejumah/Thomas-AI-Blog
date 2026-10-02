import sharp from "sharp";

/**
 * Convert a generated image to a web-friendly JPEG:
 * max 1600px wide, quality 82, progressive. Typically ~1.5 MB PNG -> ~150-300 KB.
 * Falls back to the original bytes if conversion fails.
 */
export async function optimizeForWeb(bytes: Buffer, mime = "image/png") {
  try {
    const out = await sharp(bytes)
      .rotate()
      .resize({ width: 1600, withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 82, progressive: true, mozjpeg: true })
      .toBuffer();
    return { bytes: out, mime: "image/jpeg", ext: "jpg" };
  } catch (err) {
    console.warn("[imageOptimize] failed, uploading original:", err);
    const ext = mime.includes("jpeg") ? "jpg" : mime.includes("webp") ? "webp" : "png";
    return { bytes, mime, ext };
  }
}
