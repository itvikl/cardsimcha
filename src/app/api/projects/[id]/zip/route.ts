import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { zipSync } from 'fflate';
import { canWrite } from '@/lib/access';
import { requireUser } from '@/lib/auth';
import { getRow } from '@/lib/db';
import { entitlement } from '@/lib/entitlement';
import { formatOfPage } from '@/lib/adFormats';
import { isLoopId, VIDEO_HEIGHT, VIDEO_WIDTH } from '@/lib/shabbatLoops';

type Ctx = { params: Promise<{ id: string }> };

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MAX_OVERLAY = 20 * 1024 * 1024;
const SECONDS = 8;

function pngSize(b: Buffer): { width: number; height: number } | null {
  if (b.length < 24 || b.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

const ffmpeg = (args: string[]) =>
  new Promise<void>((resolve, reject) => {
    execFile(process.env.FFMPEG_PATH || 'ffmpeg', args, { timeout: 90_000 }, (err) => (err ? reject(err) : resolve()));
  });

let queue: Promise<unknown> = Promise.resolve();

/**
 * A ZIP archive with the design in multiple useful formats:
 *   - {name}.png — original quality PNG
 *   - {name}_whatsapp.jpg — compressed JPEG suitable for WhatsApp
 *   - {name}.mp4 — animated video (for digital formats)
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
  if (!pngSize(overlay)) return NextResponse.json({ error: 'קובץ לא תקין' }, { status: 400 });

  const loop = project.canvas.elements.flatMap(
    (el) => (el.type === 'image' && isLoopId(el.loopId) ? [el.loopId] : [])
  )[0];
  const fmt = formatOfPage(project.canvas.page.width_mm, project.canvas.page.height_mm);
  const isDigital = !!loop || fmt?.medium === 'digital';
  const baseName = (project.name || 'עיצוב').replace(/[\\/:*?"<>|]/g, '_');

  const dir = await mkdtemp(path.join(tmpdir(), 'card-zip-'));
  const run = queue.then(async () => {
    const overlayPath = path.join(dir, 'overlay.png');
    await writeFile(overlayPath, overlay);
    const files: Record<string, Uint8Array> = {};

    // 1. Original PNG
    files[`${baseName}.png`] = new Uint8Array(overlay);

    // 2. WhatsApp-optimized JPEG (75% quality, max 1080px wide)
    const jpgOut = path.join(dir, 'whatsapp.jpg');
    await ffmpeg(['-y', '-i', overlayPath, '-vf', 'scale=min(1080\\,iw):-2:flags=lanczos', '-q:v', '4', jpgOut]);
    files[`${baseName}_whatsapp.jpg`] = new Uint8Array(await readFile(jpgOut));

    // 3. Video (MP4) for digital formats
    if (isDigital) {
      const mp4Out = path.join(dir, 'out.mp4');
      if (loop) {
        const size = pngSize(overlay)!;
        await ffmpeg([
          '-y', '-stream_loop', '-1', '-t', String(SECONDS),
          '-i', path.join(process.cwd(), 'public', 'shabbat', `${loop}.mp4`),
          '-i', overlayPath,
          '-filter_complex',
          `[0:v]scale=${VIDEO_WIDTH}:${VIDEO_HEIGHT}:force_original_aspect_ratio=increase,crop=${VIDEO_WIDTH}:${VIDEO_HEIGHT},setsar=1[bg];` +
          `[bg][1:v]overlay=0:0,format=yuv420p[v]`,
          '-map', '[v]', '-t', String(SECONDS), '-r', '30',
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-movflags', '+faststart', '-an', mp4Out,
        ]);
      } else {
        await ffmpeg([
          '-y', '-loop', '1', '-t', String(SECONDS), '-i', overlayPath,
          '-filter_complex',
          `[0:v]scale=${VIDEO_WIDTH}:${VIDEO_HEIGHT}:force_original_aspect_ratio=increase,crop=${VIDEO_WIDTH}:${VIDEO_HEIGHT},boxblur=35:35,setsar=1[bg];` +
          `[0:v]scale=${VIDEO_WIDTH}:-2:flags=lanczos[fg];` +
          `[bg][fg]overlay=(W-w)/2:(H-h)/2,format=yuv420p[v]`,
          '-map', '[v]', '-t', String(SECONDS), '-r', '30',
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-movflags', '+faststart', '-an', mp4Out,
        ]);
      }
      files[`${baseName}.mp4`] = new Uint8Array(await readFile(mp4Out));
    }

    return zipSync(files, { level: 0 });
  });
  queue = run.catch(() => undefined);
  try {
    const zip = await run;
    return new Response(zip, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(baseName)}_קמפיין.zip"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('zip failed', err);
    return NextResponse.json({ error: 'הכנת הקמפיין נכשלה. נסו שוב.' }, { status: 502 });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
