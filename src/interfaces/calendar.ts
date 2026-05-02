import type { DateRange } from './types';

export type TimeOfDay = { h: number; m: number };
export type Session = { date: Date; open: Date; close: Date };

export interface Calendar {
  isOpen(t: Date): boolean;
  next(t: Date): Date;
  previous(t: Date): Date;
  sessions(range: DateRange): ReadonlyArray<Date>;
  schedule(range: DateRange): ReadonlyArray<Session>;
  isEarlyClose(t: Date): boolean;
}
