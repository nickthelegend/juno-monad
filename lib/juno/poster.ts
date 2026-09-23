import "server-only";

import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { probeVideo } from "@/lib/video/frames";

const run = promisify(execFile);

/**
 * A still frame and the dimensions of an uploaded video.
 *
 * A reel needs a poster: it is what the feed card, the ring strip and the
 * market list draw, and what the reel shows while the video buffers. Nothing
 * produced one for a video launched from the app, so those reels drew as
 * blank rectangles everywhere but the player. The frame is taken half a
 * second in rather than at zero, where many clips are a black fade.
 */
export async function videoPoster(
  bytes: Buffer,
): Promise<{ jpeg: Buffer; width: number; height: number }> {
  const dir = await mkdtemp(join(tmpdir(), "juno-poster-"));
  try {
    const input = join(dir, "in");
    const output = join(dir, "poster.jpg");
    await writeFile(input, bytes);
    const meta = await probeVideo(input);
    const at = meta.durationSec > 1 ? "0.5" : "0";
    await run(ffmpegInstaller.path, ["-y", "-ss", at, "-i", input, "-frames:v", "1", "-q:v", "3", output]);
    return { jpeg: await readFile(output), width: meta.width, height: meta.height };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
