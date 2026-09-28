// Calendar helpers for the history tree. Sessions carry local "YYYY-MM-DD"
// dates; everything here parses manually to avoid UTC drift.

export function parseLocalDate(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** "YYYY-MM-DD" of the Monday starting the week the date falls in. */
export function mondayOf(date: string): string {
  const d = parseLocalDate(date);
  const shift = (d.getDay() + 6) % 7; // Mon=0 … Sun=6
  d.setDate(d.getDate() - shift);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function monthName(month: number): string {
  return MONTH_NAMES[month - 1];
}

/** "Mon 4 Aug – Sun 10 Aug" for a week given its Monday. */
export function weekLabel(monday: string): string {
  const start = parseLocalDate(monday);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const fmt = (d: Date) => `${d.getDate()} ${MONTH_NAMES[d.getMonth()].slice(0, 3)}`;
  return `Mon ${fmt(start)} – Sun ${fmt(end)}`;
}

/** "Tue 5 Aug" for a session row. */
export function dayLabel(date: string): string {
  const d = parseLocalDate(date);
  return `${DAY_NAMES[d.getDay()]} ${d.getDate()} ${MONTH_NAMES[d.getMonth()].slice(0, 3)}`;
}
