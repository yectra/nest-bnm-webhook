const MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

const CREATED_DATE_RE =
  /^(\d{1,2})-([A-Za-z]{3})-(\d{4})[ T](\d{1,2}):(\d{2})$/;

/**
 * Parse the WhatsAppContent "createdDate" format ("dd-MMM-yyyy HH:mm", e.g.
 * "05-Aug-2025 14:30") into an epoch timestamp. The format does NOT sort as
 * a string ("05-Aug-2025" < "28-Jul-2025" lexically), so all recency
 * ordering must go through this parser. Returns undefined for unparseable
 * input.
 */
export function parseCreatedDate(
  value: string | undefined,
): number | undefined {
  if (!value) {
    return undefined;
  }
  const match = CREATED_DATE_RE.exec(value.trim());
  if (!match) {
    return undefined;
  }
  const [, day, monthName, year, hour, minute] = match;
  const month = MONTHS[monthName.toLowerCase()];
  if (month === undefined) {
    return undefined;
  }
  const timestamp = Date.UTC(
    Number(year),
    month,
    Number(day),
    Number(hour),
    Number(minute),
  );
  return Number.isNaN(timestamp) ? undefined : timestamp;
}
