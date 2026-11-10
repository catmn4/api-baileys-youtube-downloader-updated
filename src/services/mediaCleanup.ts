import { existsSync } from "node:fs";
import { readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import config from "@/config";
import logger from "@/lib/logger";

const MEDIA_DIR = join(process.cwd(), "media");

export class MediaCleanupService {
  private maxAgeHours: number;
  private intervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;

  constructor(options?: { maxAgeHours?: number; intervalMs?: number }) {
    this.maxAgeHours = options?.maxAgeHours ?? config.media.maxAgeHours;
    this.intervalMs = options?.intervalMs ?? config.media.cleanupIntervalMs;
  }

  start() {
    logger.info(
      "Media cleanup service started (interval: %dms, maxAge: %dh)",
      this.intervalMs,
      this.maxAgeHours,
    );
    this.timer = setInterval(() => this.cleanup().catch(() => {}), this.intervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async cleanup() {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      if (!existsSync(MEDIA_DIR)) {
        this.isRunning = false;
        return;
      }

      const files = await readdir(MEDIA_DIR);
      const now = Date.now();
      const maxAge = this.maxAgeHours * 60 * 60 * 1000;
      let deleted = 0;

      for (const file of files) {
        try {
          const filePath = join(MEDIA_DIR, file);
          const stats = await stat(filePath);
          if (now - stats.mtimeMs > maxAge) {
            await unlink(filePath);
            deleted++;
          }
        } catch (err) {
          // ignore individual file errors
        }
      }

      if (deleted > 0) {
        logger.info("Media cleanup: deleted %d files older than %dh", deleted, this.maxAgeHours);
      }
    } catch (error) {
      logger.debug("Media cleanup skipped: %s", (error as Error).message);
    } finally {
      this.isRunning = false;
    }
  }
}
