const ET_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  hourCycle: 'h23',
});

export function utcToET(date: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} {
  const parts = ET_FORMATTER.formatToParts(date);
  return {
    year: parseInt(parts.find((p) => p.type === 'year')?.value || '0', 10),
    month: parseInt(parts.find((p) => p.type === 'month')?.value || '0', 10),
    day: parseInt(parts.find((p) => p.type === 'day')?.value || '0', 10),
    hour: parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10),
    minute: parseInt(parts.find((p) => p.type === 'minute')?.value || '0', 10),
  };
}

export function isAtMarketClose(timestamp: Date): boolean {
  const et = utcToET(timestamp);
  return (et.hour === 16 && et.minute === 0) || (et.hour === 13 && et.minute === 0);
}
