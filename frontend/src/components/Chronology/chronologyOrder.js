/** Chronology dates are ISO-like (`2011-03-28`, `2014-02`, `2019`). */
export function compareChronologyDates(a, b) {
  const left = String(a?.date || a?.displayDate || '');
  const right = String(b?.date || b?.displayDate || '');
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export function datesFromStartToLast(dates) {
  return [...(dates || [])].sort(compareChronologyDates);
}
