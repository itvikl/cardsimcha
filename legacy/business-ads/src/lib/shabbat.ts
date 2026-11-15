import { CandleLightingEvent, HavdalahEvent, HDate, HebrewCalendar, Location, ParshaEvent, flags } from '@hebcal/core';
import { cityById, type ShabbatTimes } from './shabbatDoc';

/**
 * The coming Shabbat's times for a city. Server only: @hebcal/core is GPL-2.0, and it stays out of the browser bundle.
 * The table of cities and their customs (shabbatDoc.ts) must be approved by the client's halachic authority before launch.
 */

const pad = (n: number) => String(n).padStart(2, '0');
const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const TZ = 'Asia/Jerusalem';

/** the calendar day in Israel of a moment, at local midnight of a plain Date (hebcal reads a Date's local fields) */
function israelDay(at: Date): Date {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at).split('-').map(Number);
  return new Date(p[0], p[1] - 1, p[2]);
}

const clock = (at: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);

function timesFor(cityId: string, friday: Date) {
  const city = cityById(cityId);
  if (!city) return null;
  const saturday = new Date(friday.getFullYear(), friday.getMonth(), friday.getDate() + 1);
  const location = new Location(city.lat, city.lon, true, TZ, city.name, 'IL');
  const events = HebrewCalendar.calendar({
    start: friday,
    end: saturday,
    location,
    il: true,
    candlelighting: true,
    sedrot: true,
    candleLightingMins: city.candleMins,
    havdalahMins: city.havdalahMins,
    noHolidays: false,
  });
  const candle = events.find((e) => e instanceof CandleLightingEvent && isoDay(e.eventTime) === isoDay(friday)) as CandleLightingEvent | undefined;
  // when a festival begins as Shabbat ends there is no havdalah on the calendar: Shabbat's end is that evening's lighting time
  const end = (events.find((e) => e instanceof HavdalahEvent) ??
    events.find((e) => e instanceof CandleLightingEvent && isoDay(e.eventTime) === isoDay(saturday))) as HavdalahEvent | CandleLightingEvent | undefined;
  if (!candle || !end) return null;
  const parsha = events.find((e) => e instanceof ParshaEvent);
  // on a Shabbat that is also a festival the week's reading gives way to the festival's name
  const festival = events.find((e) => (e.getFlags() & (flags.CHAG | flags.CHOL_HAMOED)) !== 0 && e.getDate().getDay() === 6);
  const out: ShabbatTimes = {
    cityId: city.id,
    city: city.name,
    friday: isoDay(friday),
    parsha: parsha ? parsha.render('he-x-NoNikud') : festival ? festival.render('he-x-NoNikud').replace(/\s*\d+$/, '') : '',
    candles: clock(candle.eventTime),
    havdalah: clock(end.eventTime),
    hebrewDate: new HDate(saturday).renderGematriya(true),
    candlesAt: candle.eventTime.toISOString(),
  };
  return out;
}

/** the Shabbat a business is preparing for: this week's until candle-lighting has passed, then next week's */
export function comingShabbat(cityId: string, now = new Date()): ShabbatTimes | null {
  const today = israelDay(now);
  const friday = new Date(today.getFullYear(), today.getMonth(), today.getDate() + ((5 - today.getDay() + 7) % 7));
  // Shabbat itself: last Friday's candle-lighting has passed, so this Friday is the one to prepare
  const times = timesFor(cityId, friday);
  if (!times) return null;
  if (now.getTime() < new Date(times.candlesAt).getTime()) return times;
  return timesFor(cityId, new Date(friday.getFullYear(), friday.getMonth(), friday.getDate() + 7));
}
