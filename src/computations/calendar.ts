import type { DailyBar } from '../handles/indicator';

type CalendarPeriod = 'Month' | 'Day of Week' | 'Day of Month' | 'Day of Year';

function dayOfYear(d: Date): number {
  const start = new Date(d.getFullYear(), 0, 0);
  const diff = d.getTime() - start.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

export function computeCalendar(bars: DailyBar[], period: CalendarPeriod): DailyBar[] {
  return bars.map((bar) => {
    const parts = bar.date.split('-').map(Number);
    const [y, m, d] = [parts[0]!, parts[1]!, parts[2]!];
    const date = new Date(y, m - 1, d);
    let value: number;
    switch (period) {
      case 'Month':
        value = date.getMonth() + 1;
        break;
      case 'Day of Week':
        value = date.getDay();
        break;
      case 'Day of Month':
        value = date.getDate();
        break;
      case 'Day of Year':
        value = dayOfYear(date);
        break;
    }
    return { date: bar.date, value };
  });
}
