/**
 * Business hours per organization. Used to fire the "away" auto-reply outside
 * working hours. Timezone-aware via Intl (no external deps).
 *
 * Shape: { enabled, timezone, days: { mon: { closed, open:'09:00', close:'18:00' }, ... } }
 */
export const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export function defaultBusinessHours() {
  const days = {};
  for (const k of DAY_KEYS) {
    days[k] = { closed: k === 'sat' || k === 'sun', open: '09:00', close: '18:00' };
  }
  return { enabled: true, timezone: 'Asia/Bangkok', days };
}

/** Current weekday key ('mon'..) and 'HH:MM' in the given timezone. */
function nowInZone(timezone) {
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone || 'Asia/Bangkok',
        weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
      }).formatToParts(new Date()).map((p) => [p.type, p.value]),
    );
    return { wd: parts.weekday.toLowerCase().slice(0, 3), hhmm: `${parts.hour}:${parts.minute}` };
  } catch {
    const d = new Date();
    return {
      wd: DAY_KEYS[(d.getDay() + 6) % 7],
      hhmm: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
    };
  }
}

export function isWithinBusinessHours(bh) {
  if (!bh || !bh.enabled) return true; // not configured → treat as always open
  const { wd, hhmm } = nowInZone(bh.timezone);
  const day = bh.days?.[wd];
  if (!day || day.closed) return false;
  return hhmm >= (day.open || '00:00') && hhmm < (day.close || '23:59');
}

export const isOutsideBusinessHours = (bh) => !isWithinBusinessHours(bh);

/** Coerce client input into a safe business-hours object. */
export function sanitizeBusinessHours(input = {}, current = defaultBusinessHours()) {
  const days = {};
  for (const k of DAY_KEYS) {
    const d = (input.days && input.days[k]) || current.days[k] || {};
    days[k] = {
      closed: !!d.closed,
      open: /^\d{2}:\d{2}$/.test(d.open) ? d.open : '09:00',
      close: /^\d{2}:\d{2}$/.test(d.close) ? d.close : '18:00',
    };
  }
  return {
    enabled: !!input.enabled,
    timezone: typeof input.timezone === 'string' && input.timezone ? input.timezone : current.timezone,
    days,
  };
}
