import { existsSync } from "node:fs";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { AnyMessageContent, WAMessage } from "@whiskeysockets/baileys";
import type { BaileysConnection } from "@/baileys/connection";

interface Format {
  format_id: string;
  height?: number | null;
  ext?: string;
  fps?: number | null;
  vcodec?: string;
  acodec?: string;
  abr?: number | null;
  audio_channels?: number | null;
  filesize?: number | null;
  filesize_approx?: number | null;
}
interface VideoInfo {
  title?: string;
  formats?: Format[];
}

const root = resolve(import.meta.dir, "../..");
const ytdlp = process.env.YTDLP_PATH?.trim() || join(root, "vendor", "yt-dlp");
const workDir = resolve(process.env.YOUTUBE_OUTPUT_DIR?.trim() || join(root, "youtube-downloads"));
const cookiesPath = process.env.YOUTUBE_COOKIES_FILE?.trim()
  ? resolve(process.env.YOUTUBE_COOKIES_FILE.trim())
  : "";
const jsRuntime = process.versions.bun ? "bun" : "node";
const jsRuntimeArgs = ["--js-runtimes", `${jsRuntime}:${process.execPath}`];
const activeJobs = new Set<string>();
let diskUploadTail = Promise.resolve();

function safeYouTubeUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (
      ![
        "youtube.com",
        "www.youtube.com",
        "m.youtube.com",
        "music.youtube.com",
        "youtu.be",
      ].includes(url.hostname)
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}

async function run(
  args: string[],
  timeoutMs = 15 * 60_000,
): Promise<{ code: number; stdout: string; stderr: string }> {
  if (cookiesPath && !existsSync(cookiesPath)) {
    throw new Error(`ملف cookies المحدد غير موجود: ${cookiesPath}`);
  }
  const ytDlpArgs = [
    ...jsRuntimeArgs,
    ...(cookiesPath ? ["--cookies", cookiesPath] : []),
    ...args,
  ];
  const child = Bun.spawn([ytdlp, ...ytDlpArgs], {
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });
  const timeout = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
  try {
    const [stdout, stderr] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    return { code: await child.exited, stdout, stderr };
  } finally {
    clearTimeout(timeout);
  }
}

function bytesLabel(bytes: number | null | undefined): string {
  if (!Number.isFinite(bytes) || !bytes || bytes < 0) return "الحجم الدقيق غير متاح من المصدر";
  const units = ["B", "KiB", "MiB", "GiB"];
  let value = bytes,
    unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(unit === 0 ? 0 : 2)} ${units[unit]} (${bytes.toLocaleString("en-US")} بايت)`;
}

function getText(message: WAMessage): string | null {
  const m = message.message;
  if (!m) return null;
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    null
  );
}

interface VideoChoice {
  height: number;
  withAudio?: Format;
  videoOnly?: Format;
}

function listFormats(info: VideoInfo) {
  const videos = new Map<number, VideoChoice>();
  const audioByRate = new Map<number, Format>();
  for (const f of info.formats ?? []) {
    if (f.acodec && f.acodec !== "none" && (!f.vcodec || f.vcodec === "none")) {
      const rate = Math.round(f.abr ?? 0);
      const old = audioByRate.get(rate);
      if (!old || (typeof f.filesize === "number" && typeof old.filesize !== "number")) {
        audioByRate.set(rate, f);
      }
      continue;
    }
    if (!f.height || !f.vcodec || f.vcodec === "none") continue;
    const choice = videos.get(f.height) ?? { height: f.height };
    const hasAudio = Boolean(f.acodec && f.acodec !== "none");
    const existing = hasAudio ? choice.withAudio : choice.videoOnly;
    if (!existing || (typeof f.filesize === "number" && typeof existing.filesize !== "number")) {
      if (hasAudio) choice.withAudio = f;
      else choice.videoOnly = f;
    }
    videos.set(f.height, choice);
  }
  const video = [...videos.values()].sort((a, b) => a.height - b.height);
  const audio = [...audioByRate.values()].sort((a, b) => (a.abr ?? 0) - (b.abr ?? 0));
  return { video, audio };
}

export async function handleYouTubeCommand(
  connection: BaileysConnection,
  message: WAMessage,
): Promise<boolean> {
  if (message.key.fromMe) return false;
  const text = getText(message);
  if (!text || !/^\/y(?:\s|$)/i.test(text)) return false;
  const jid = message.key.remoteJid;
  if (!jid) return true;
  const reply = (body: string, extra: Partial<AnyMessageContent> = {}) =>
    connection.sendMessage(jid, { text: body, ...extra }, { quoted: message });
  const args = text.trim().split(/\s+/);
  try {
    if (args.length === 2) {
      const url = safeYouTubeUrl(args[1] ?? "");
      if (!url) {
        await reply("صيغة الأمر: /y رابط_يوتيوب");
        return true;
      }
      await reply("جارٍ فحص الفيديو واستخراج الجودات والأحجام الدقيقة…");
      const result = await run(
        ["--dump-single-json", "--no-playlist", "--no-warnings", url],
        90_000,
      );
      if (result.code !== 0) throw new Error(result.stderr.trim() || "تعذّر جلب معلومات الفيديو.");
      const info = JSON.parse(result.stdout) as VideoInfo;
      const choices = listFormats(info);
      rememberYouTubeChoices(connection, jid, url, info);
      if (!choices.video.length) throw new Error("لم يعثر yt-dlp على جودات فيديو قابلة للتنزيل.");
      const lines = [`🎞️ ${info.title ?? "الفيديو"}`, "", "جودات الفيديو:"];
      choices.video.forEach((choice, i) => {
        const audioSize = choice.withAudio
          ? bytesLabel(choice.withAudio.filesize)
          : "غير متاح كملف واحد";
        const silentSize = choice.videoOnly
          ? bytesLabel(choice.videoOnly.filesize)
          : "غير متاح كملف صامت";
        lines.push(
          `${i + 1}. ${choice.height}p — مع الصوت: ${audioSize} — بدون صوت: ${silentSize}`,
        );
      });
      lines.push("", "جودات الصوت المنفصلة:");
      lines.push("0. بدون تنزيل صوت");
      choices.audio.forEach((f, i) => {
        lines.push(`${i + 1}. ${Math.round(f.abr ?? 0)} kbps — ${bytesLabel(f.filesize)}`);
      });
      lines.push(
        "",
        "للتنزيل أرسل: /y رقم_الفيديو رقم_الصوت",
        "مثال: /y 2 3 — نزّل الفيديو والصوت الثالث كملفين منفصلين بلا دمج.",
      );
      lines.push(
        "الأحجام المعروضة هي أحجام yt-dlp الدقيقة فقط؛ عند غيابها يظهر أنها غير متاحة ولا يُستخدم الحجم التقريبي.",
      );
      await reply(lines.join("\n"));
      return true;
    }
    if (args.length !== 3 || !/^\d+$/.test(args[1] ?? "") || !/^\d+$/.test(args[2] ?? "")) {
      await reply(
        "الصيغة: /y رابط ثم /y رقم_جودة_الفيديو رقم_جودة_الصوت. استخدم 0 لاستبعاد الصوت.",
      );
      return true;
    }
    const videoIndex = Number(args[1]),
      audioIndex = Number(args[2]);
    if (videoIndex < 1) {
      await reply("رقم جودة الفيديو يبدأ من 1؛ الرقم 0 مخصص لاستبعاد الصوت فقط.");
      return true;
    }
    const previous = (
      connection as unknown as {
        youtubeChoices?: Map<
          string,
          {
            url: string;
            videoIds: string[];
            videoHeights: number[];
            audioRates: number[];
            title: string;
          }
        >;
      }
    ).youtubeChoices;
    const cached = previous?.get(jid);
    if (!cached) {
      await reply("لم أجد قائمة جودات سابقة لهذه المحادثة. أرسل /y رابط_يوتيوب أولًا.");
      return true;
    }
    if (videoIndex > cached.videoIds.length || audioIndex > cached.audioRates.length) {
      await reply("رقم الجودة خارج القائمة المعروضة. أرسل /y رابط_يوتيوب لإظهار القائمة مجددًا.");
      return true;
    }
    if (activeJobs.has(jid)) {
      await reply("يوجد تنزيل جارٍ في هذه المحادثة؛ انتظر حتى يكتمل.");
      return true;
    }
    activeJobs.add(jid);
    await reply("بدأ التنزيل. سأرسل الملف عند اكتماله.");
    void downloadAndSend(connection, jid, message, cached, videoIndex - 1, audioIndex)
      .catch(async (error) => {
        await connection
          .sendMessage(jid, {
            text: `فشل التنزيل: ${error instanceof Error ? error.message : String(error)}`,
          })
          .catch(() => {});
      })
      .finally(() => activeJobs.delete(jid));
    return true;
  } catch (error) {
    await reply(
      `تعذّر تنفيذ الأمر: ${error instanceof Error ? error.message.slice(0, 700) : String(error)}`,
    );
    return true;
  }
}

async function downloadAndSend(
  connection: BaileysConnection,
  jid: string,
  quoted: WAMessage,
  cached: {
    url: string;
    videoIds: string[];
    videoHeights: number[];
    audioRates: number[];
    title: string;
  },
  vi: number,
  ai: number,
): Promise<void> {
  await mkdir(workDir, { recursive: true });
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const dir = join(workDir, id);
  await mkdir(dir, { recursive: true });
  try {
    // Refresh format IDs before downloading because YouTube may change them.
    const refreshed = await run(
      ["--dump-single-json", "--no-playlist", "--no-warnings", cached.url],
      90_000,
    );
    if (refreshed.code !== 0)
      throw new Error(refreshed.stderr.trim().slice(-900) || "تعذر تحديث صيغ الفيديو والصوت.");
    const info = JSON.parse(refreshed.stdout) as VideoInfo;
    const choices = listFormats(info);
    const videoHeight = cached.videoHeights[vi];
    if (!videoHeight)
      throw new Error("الخيار المحدد غير متوفر؛ أرسل رابط الفيديو مجددًا لعرض الجودات الحالية.");
    const videoChoice = choices.video.find((choice) => choice.height === videoHeight);
    const videoFormat = videoChoice?.videoOnly;
    if (!videoFormat) {
      throw new Error("لا تتوفر صيغة فيديو صامتة لهذه الدقة. اختر دقة أخرى أو استخدم 0 للصوت.");
    }
    const audioRate = ai > 0 ? cached.audioRates[ai - 1] : undefined;
    const audioFormat =
      audioRate === undefined
        ? undefined
        : choices.audio.find((format) => Math.round(format.abr ?? 0) === audioRate);
    if (ai > 0 && !audioFormat) {
      throw new Error("جودة الصوت المحددة لم تعد متاحة. أرسل /y الرابط مجددًا.");
    }

    const downloadOne = async (
      formatId: string,
      fallbackSelector: string,
      prefix: "video" | "audio",
      errorLabel: string,
    ): Promise<{ file: string; path: string }> => {
      const output = join(dir, `${prefix}-%(title).100B-%(id)s.%(ext)s`);
      const args = ["--no-playlist", "--no-warnings", "--no-progress", "--format"];
      let result = await run([...args, formatId, "--output", output, cached.url]);
      if (
        result.code !== 0 &&
        /requested format is not available|requested format not available/i.test(result.stderr)
      ) {
        result = await run([...args, fallbackSelector, "--output", output, cached.url]);
      }
      if (result.code !== 0)
        throw new Error(result.stderr.trim().slice(-900) || `فشل تنزيل ${errorLabel}.`);
      const file = (await readdir(dir)).find((name) => name.startsWith(`${prefix}-`));
      if (!file) throw new Error(`اكتمل تنزيل ${errorLabel} لكن تعذر العثور على ملفه.`);
      const path = join(dir, file);
      if ((await stat(path)).size > 1_900_000_000)
        throw new Error(`حجم ملف ${errorLabel} أكبر من الحد الآمن للإرسال عبر واتساب.`);
      return { file, path };
    };

    // Download and upload the video first. Baileys receives a disk path, reads
    // it as a stream, writes its encrypted upload temp to disk, then resolves.
    const videoAsset = await downloadOne(
      videoFormat.format_id,
      `bestvideo[height=${videoHeight}]`,
      "video",
      "الفيديو",
    );
    try {
      await sendDownloadedFile(
        connection,
        jid,
        quoted,
        videoAsset.path,
        videoAsset.file,
        "الفيديو (من دون صوت)",
      );
    } finally {
      await rm(videoAsset.path, { force: true }).catch(() => {});
    }

    // Only after the video upload has completed and its local file is removed,
    // download and upload the selected audio file using the same disk-backed flow.
    if (ai > 0 && audioFormat && audioRate !== undefined) {
      const audioAsset = await downloadOne(
        audioFormat.format_id,
        `bestaudio[abr<=${audioRate}]/bestaudio`,
        "audio",
        "الصوت",
      );
      try {
        await sendDownloadedFile(
          connection,
          jid,
          quoted,
          audioAsset.path,
          audioAsset.file,
          `الصوت المنفصل (${Math.round(audioFormat.abr ?? 0)} kbps)`,
        );
      } finally {
        await rm(audioAsset.path, { force: true }).catch(() => {});
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function sendDownloadedFile(
  connection: BaileysConnection,
  jid: string,
  quoted: WAMessage,
  path: string,
  file: string,
  caption: string,
): Promise<void> {
  const size = (await stat(path)).size;
  const ext = file.split(".").pop()?.toLowerCase() ?? "bin";
  const isAudio = file.startsWith("audio-");
  const mimetype = isAudio
    ? ext === "m4a" || ext === "mp4"
      ? "audio/mp4"
      : ext === "webm"
        ? "audio/webm"
        : ext === "opus" || ext === "ogg"
          ? "audio/ogg"
          : ext === "mp3"
            ? "audio/mpeg"
            : "application/octet-stream"
    : ext === "mp4"
      ? "video/mp4"
      : ext === "webm"
        ? "video/webm"
        : "application/octet-stream";
  const content: AnyMessageContent = {
    document: { url: path },
    mimetype,
    fileName: file,
    caption: `${caption} — ${bytesLabel(size)}`,
  };
  await sendWithDiskBackedEncryption(connection, jid, content, quoted);
}

async function sendWithDiskBackedEncryption(
  connection: BaileysConnection,
  jid: string,
  content: AnyMessageContent,
  quoted: WAMessage,
): Promise<void> {
  await mkdir(workDir, { recursive: true });
  const previousUpload = diskUploadTail;
  let release = () => {};
  diskUploadTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previousUpload;
  const previousTmpDir = process.env.TMPDIR;
  process.env.TMPDIR = workDir;
  try {
    // Baileys reads the on-disk source as a stream, writes the encrypted upload
    // artifact under TMPDIR, uploads it, then removes that encrypted temp file.
    await connection.sendMessage(jid, content, { quoted });
  } finally {
    if (previousTmpDir === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previousTmpDir;
    release();
  }
}

export function rememberYouTubeChoices(
  connection: BaileysConnection,
  jid: string,
  url: string,
  info: VideoInfo,
): void {
  const { video, audio } = listFormats(info);
  const store = connection as unknown as { youtubeChoices?: Map<string, unknown> };
  if (!store.youtubeChoices) store.youtubeChoices = new Map();
  (store.youtubeChoices as Map<string, unknown>).set(jid, {
    url,
    videoIds: video.map((choice) => String(choice.height)),
    videoHeights: video.map((choice) => choice.height),
    audioRates: audio.map((format) => Math.round(format.abr ?? 0)),
    title: info.title ?? "video",
  });
}
