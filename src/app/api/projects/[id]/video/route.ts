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
const SECONDS = 8;

/** The overlay's real size, from its PNG header; null when it isn't a PNG. */
function pngSize(b: Buffer): { width: number; height: number } | null {
  if (b.length < 24 || b.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

const ffmpeg = (args: string[]) =>
  new Promise<void>((resolve, reject) => {
    execFile(process.env.FFMPEG_PATH || 'ffmpeg', args, { timeout: 90_000 }, (err) => (err ? reject(err) : resolve()));
  });

// one video at a time per server process: each one takes all the CPU it can get
let queue: Promise<unknown> = Promise.resolve();

/**
 * The design as an MP4 for a WhatsApp status: the prepared moving background under the design's own texts and logo.
 * The browser sends those as a transparent PNG, drawn by the same code as the screen, so the Hebrew stays exact;
 * the background comes from the saved design, never from the request.
 */
export async function POST(req: Request, { params }: Ctx) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const { id } = await params;
  const project = await getRow('projects', id);
  if (!project || !canWrite(user, project)) return NextResponse.json({ error: 'לא נמצא' }, { status: 404 });
  const e = await entitlement(user, project);
  if (!e.allowed) return NextResponse.json(e, { status: 402 });

  const loop = project.canvas.elements.flatMap((el) => (el.type === 'image' && isLoopId(el.loopId) ? [el.loopId] : []))[0];

  const form = await req.formData().catch(() => null);
  const file = form?.get('overlay');
  if (!(file instanceof File) || file.size > MAX_OVERLAY) return NextResponse.json({ error: 'קובץ לא תקין' }, { status: 400 });
  const overlay = Buffer.from(await file.arrayBuffer());
  const size = pngSize(overlay);
  if (!size) return NextResponse.json({ error: 'קובץ לא תקין' }, { status: 400 });
  if (loop && (size.width !== VIDEO_WIDTH || size.height !== VIDEO_HEIGHT))
    return NextResponse.json({ error: 'קובץ לא תקין' }, { status: 400 });

  const dir = await mkdtemp(path.join(tmpdir(), 'card-video-'));
  const run = queue.then(async () => {
    const overlayPath = path.join(dir, 'overlay.png');
    const out = path.join(dir, 'out.mp4');
    await writeFile(overlayPath, overlay);

    if (loop) {
      // Shabbat: animated loop under the design overlay
      await ffmpeg([
        '-y',
        '-stream_loop', '-1',
        '-i', path.join(process.cwd(), 'public', 'shabbat', `${loop}.mp4`),
        '-i', overlayPath,
        '-filter_complex', `[0:v]scale=${VIDEO_WIDTH}:${VIDEO_HEIGHT}:force_original_aspect_ratio=increase,crop=${VIDEO_WIDTH}:${VIDEO_HEIGHT},setsar=1[bg];[bg][1:v]overlay=0:0,format=yuv420p[v]`,
        '-map', '[v]',
        '-t', String(SECONDS),
        '-r', '30',
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '23',
        '-movflags', '+faststart',
        '-an',
        out,
      ]);
    } else {
      // Business ad: design centered on a blurred version of itself (9:16 portrait)
      await ffmpeg([
        '-y',
        '-loop', '1',
        '-t', String(SECONDS),
        '-i', overlayPath,
        '-filter_complex',
        `[0:v]scale=${VIDEO_WIDTH}:${VIDEO_HEIGHT}:force_original_aspect_ratio=increase,crop=${VIDEO_WIDTH}:${VIDEO_HEIGHT},boxblur=35:35,setsar=1[bg];` +
        `[0:v]scale=${VIDEO_WIDTH}:-2:flags=lanczos[fg];` +
        `[bg][fg]overlay=(W-w)/2:(H-h)/2,format=yuv420p[v]`,
        '-map', '[v]',
        '-t', String(SECONDS),
        '-r', '30',
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '23',
        '-movflags', '+faststart',
        '-an',
        out,
      ]);
    }
    return readFile(out);
  });
  queue = run.catch(() => undefined);
  try {
    const video = await run;
    return new Response(new Uint8Array(video), { headers: { 'Content-Type': 'video/mp4', 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('video failed', err);
    return NextResponse.json({ error: 'הכנת הסרטון נכשלה. אפשר להוריד תמונה בינתיים.' }, { status: 502 });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
