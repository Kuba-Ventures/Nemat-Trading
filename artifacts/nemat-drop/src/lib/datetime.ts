function pad2(n: number) {
  return String(n).padStart(2, "0");
}

/**
 * Format a stored UTC instant as the local wall-clock string a datetime-local
 * input expects.
 *
 * This used to return `toISOString().slice(0, 16)`, which is UTC wall-clock.
 * The input renders that as if it were local, and on save `new Date(value)`
 * parses a zone-less string as local, so every save pushed the deadline by the
 * browser's UTC offset. It compounded: three saves from New York moved a
 * deadline 12 hours later, and from Tokyo it moved backwards, which would end a
 * drop early. It was invisible to anyone whose browser was already on UTC.
 */
export function toDatetimeLocal(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` +
    `T${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  );
}

/**
 * The save half of the round trip: a zone-less datetime-local value is parsed
 * as local time, which is what `toDatetimeLocal` produced. Empty means no
 * deadline.
 */
export function fromDatetimeLocal(value: string) {
  return value ? new Date(value).toISOString() : null;
}
