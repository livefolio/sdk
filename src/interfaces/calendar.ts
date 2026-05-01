import type { DateRange } from './types';

export interface Calendar {
  isOpen(t: Date): boolean;
  next(t: Date): Date;
  previous(t: Date): Date;
  sessions(range: DateRange): ReadonlyArray<Date>;
}
