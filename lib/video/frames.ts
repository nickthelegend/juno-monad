import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";
import ffmpeg from "fluent-ffmpeg";
import { readdirSync } from "node:fs";
import { join } from "node:path";

ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

export type VideoMeta = {
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  durationSec: number;
};

export function probeVideo(path: string): Promise<VideoMeta> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(path, (err, data) => {
      if (err) return reject(err);
      const v = data.streams.find((s) => s.codec_type === "video");
      const a = data.streams.find((s) => s.codec_type === "audio");
      if (!v) return reject(new Error("no video stream found"));
      const [num, den] = (v.r_frame_rate ?? "30/1").split("/").map(Number);
      resolve({
        width: v.width ?? 0,
        height: v.height ?? 0,
        fps: den ? num / den : 30,
        hasAudio: Boolean(a),
        durationSec: Number(data.format.duration ?? 0),
      });
    });
  });
}

/**
 * Extract keyframes at `fps` (default from BLUR_KEYFRAME_FPS) into `outDir` as
 * frame-0001.jpg, frame-0002.jpg, ... Resolves to the sorted file paths.
 *
 * Sampling at a low fps (e.g. 1) keeps detection cost down; SAM2 interpolates
 * the mask across the frames in between (PRD §7.1).
 */
export function extractKeyframes(
  videoPath: string,
  outDir: string,
  fps = Number(process.env.BLUR_KEYFRAME_FPS ?? 1),
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .outputOptions(["-vf", `fps=${fps}`, "-q:v", "2"])
      .output(join(outDir, "frame-%04d.jpg"))
      .on("end", () => {
        const files = readdirSync(outDir)
          .filter((f) => /^frame-\d+\.jpg$/.test(f))
          .sort()
          .map((f) => join(outDir, f));
        resolve(files);
      })
      .on("error", reject)
      .run();
  });
}
