
import { junoJson, junoOptions } from "@/lib/juno/api";
import { pinFile } from "@/lib/juno/pinata";
import { videoPoster } from "@/lib/juno/poster";
import sharp from "sharp";

export const runtime = "nodejs";
/** The Expo client is a different origin; the preflight has to answer. */
export const OPTIONS = junoOptions;

/** Anything larger is a problem for the pinning step, not a real upload. */
const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED = /^(image|video)\//;

export async function POST(request: Request) {
  if (!process.env.PINATA_JWT) {
    return junoJson({ error: "Uploads are not configured" }, { status: 503 });
  }

  /**
   * Only what this route reads.
   *
   * Two incompatible `FormData` types are visible during the production build —
   * the ambient DOM one and the undici one `.formData()` actually returns — and
   * annotating either way fails. `tsc --noEmit` sees only one of them and
   * passes, which is why this only surfaces at build time.
   */
  let form: { get(name: string): unknown };
  try {
    form = (await request.formData()) as unknown as typeof form;
  } catch {
    return junoJson({ error: "Expected multipart form data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return junoJson({ error: "No file" }, { status: 400 });
  }
  if (!ALLOWED.test(file.type)) {
    return junoJson({ error: "Only images and video" }, { status: 415 });
  }
  if (file.size > MAX_BYTES) {
    return junoJson({ error: "File is over 25MB" }, { status: 413 });
  }

  try {
    const pinned = await pinFile(file);
    const bytes = Buffer.from(await file.arrayBuffer());

    /*
     * Dimensions for both kinds, and a poster for video.
     *
     * Neither is optional decoration. A reel without a poster draws as an
     * empty box in every list, and media without dimensions is laid out at a
     * guessed ratio. A failure here fails the upload with a reason rather than
     * handing back a video the rest of the app cannot show.
     */
    if (file.type.startsWith("video/")) {
      const poster = await videoPoster(bytes);
      const pinnedPoster = await pinFile(
        new File([new Uint8Array(poster.jpeg)], "poster.jpg", { type: "image/jpeg" }),
        `${file.name || "reel"}-poster`,
      );
      return junoJson(
        {
          ...pinned,
          mimeType: file.type,
          posterUri: pinnedPoster.uri,
          posterUrl: pinnedPoster.url,
          width: poster.width,
          height: poster.height,
        },
        { status: 201 },
      );
    }

    const meta = await sharp(bytes).metadata();
    return junoJson(
      { ...pinned, mimeType: file.type, width: meta.width ?? null, height: meta.height ?? null },
      { status: 201 },
    );
  } catch (error) {
    return junoJson(
      { error: error instanceof Error ? error.message : "Upload failed" },
      { status: 502 },
    );
  }
}
