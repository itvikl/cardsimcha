import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { canWrite } from '@/lib/access';
import { requireUser } from '@/lib/auth';
import { getRow } from '@/lib/db';
import { entitlement } from '@/lib/entitlement';
import { isLoopId, VIDEO_HEIGHT, VIDEO_WIDTH } from '@/lib/shabbatLoops';

type Ctx = { params: Promise<{ id: string }> };

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MAX_OVERLAY = 20 * 1024 * 1024;
const GIF_FPS = 12;
const GIF_SECONDS = 4;
const GIF_WIDTH = 540; // half of 1080 for reasonable file size

function pngSize(b: Buffer): { width: number; height: number } | null {
  if (b.length < 24 || b.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

const ffmpeg = (args: string[]) =>
  new Promise<void>((resolve, reject) => {
    execFile(process.env.FFMPEG_PATH || 'ffmpeg', args, { timeout: 90_000 }, (err) => (err ? reject(err) : resolve()));
  });

// one job at a time per server process
let queue: Promise<unknown> = Promise.resolve();

/**
 * The design as an animated GIF.
 * Shabbat designs: the moving loop under the design overlay.
 * Business ads: a fade-in/out animation of the static design.
 */
export async function POST(req: Request, { params }: Ctx) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  const project = await getRow('projects', id);
  if (!project || !canWrite(user, project)) return NextResponse.json({ error: 'לא נמצא' }, { status: 404 });
  const e = await entitlement(user, project);
  if (!e.allowed) return NextResponse.json(e, { status: 402 });

  const form = await req.formData().catch(() => null);
  const file = form?.get('overlay');
  if (!(file instanceof File) || file.size > MAX_OVERLAY) return NextResponse.json({ error: 'קובץ לא תקין' }, { status: 400 });
  const overlay = Buffer.from(await file.arrayBuffer());
  const size = pngSize(overlay);
  if (!size) return NextResponse.json({ error: 'קובץ לא תקין' }, { status: 400 });

  const loop = project.canvas.elements.flatMap(
    (el) => (el.type === 'image' && isLoopId(el.loopId) ? [el.loopId] : [])
  )[0];

  const dir = await mkdtemp(path.join(tmpdir(), 'card-gif-'));
  const run = queue.then(async () => {
    const overlayPath = path.join(dir, 'overlay.png');
    const palettePath = path.join(dir, 'palette.png');
    const out = path.join(dir, 'out.gif');
    await writeFile(overlayPath, overlay);

    if (loop) {
      // Shabbat: animated loop + design overlay
      const loopPath = path.join(process.cwd(), 'public', 'shabbat', `${loop}.mp4`);
      const compose = [
        `[0:v]scale=${VIDEO_WIDTH}:${VIDEO_HEIGHT}:force_original_aspect_ratio=increase,crop=${VIDEO_WIDTH}:${VIDEO_HEIGHT},setsar=1[bg]`,
        `[bg][1:v]overlay=0:0[comp]`,
        `[comp]scale=${GIF_WIDTH}:-1:flags=lanczos,fps=${GIF_FPS}`,
      ].join(';');
      // pass 1: palette
      await ffmpeg([
        '-y', '-stream_loop', '-1', '-t', String(GIF_SECONDS), '-i', loopPath,
        '-i', overlayPath,
        '-filter_complex', compose + '[scaled];[scaled]palettegen=max_colors=128:stats_mode=diff[pal]',
        '-map', '[pal]', palettePath,
      ]);
      // pass 2: GIF
      await ffmpeg([
        '-y', '-stream_loop', '-1', '-t', String(GIF_SECONDS), '-i', loopPath,
        '-i', overlayPath,
        '-i', palettePath,
        '-filter_complex',
        compose + '[scaled];[scaled][2:v]paletteuse=dither=bayer:bayer_scale=3[out]',
        '-map', '[out]', '-loop', '0', out,
      ]);
    } else {
      // Business ad: fade in → hold → fade out animation
      const w = Math.min(size.width, GIF_WIDTH);
      const vf = [
        `scale=${w}:-1:flags=lanczos`,
        `fps=${GIF_FPS}`,
        `fade=t=in:st=0:d=0.6`,
        `fade=t=out:st=${GIF_SECONDS - 0.6}:d=0.6`,
      ].join(',');
      // pass 1: palette
      await ffmpeg([
        '-y', '-loop', '1', '-t', String(GIF_SECONDS), '-i', overlayPath,
        '-vf', `${vf},palettegen=max_colors=128:stats_mode=diff`,
        '-frames:v', '1', palettePath,
      ]);
      // pass 2: GIF
      await ffmpeg([
        '-y', '-loop', '1', '-t', String(GIF_SECONDS), '-i', overlayPath,
        '-i', palettePath,
        '-filter_complex', `[0:v]${vf}[scaled];[scaled][1:v]paletteuse=dither=bayer:bayer_scale=3[out]`,
        '-map', '[out]', '-loop', '0', out,
      ]);
    }
    return readFile(out);
  });
  queue = run.catch(() => undefined);
  try {
    const gif = await run;
    return new Response(new Uint8Array(gif), {
      headers: { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    console.error('gif failed', err);
    return NextResponse.json({ error: 'הכנת ה-GIF נכשלה. אפשר להוריד תמונה בינתיים.' }, { status: 502 });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
