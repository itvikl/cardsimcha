/** The prepared moving backgrounds of the Shabbat designs (public/shabbat/<id>.mp4). A design's picture names one with `loopId`. */
export const SHABBAT_LOOPS = ['candles', 'table', 'jerusalem', 'gold', 'stars', 'silk'] as const;

export const isLoopId = (v: unknown): v is (typeof SHABBAT_LOOPS)[number] => SHABBAT_LOOPS.includes(v as (typeof SHABBAT_LOOPS)[number]);

/** The video's size: a vertical status. */
export const VIDEO_WIDTH = 1080;
export const VIDEO_HEIGHT = 1920;
