import { ExchangeCalendar } from './exchange-calendar';
import { NYSEExchangeCalendar } from './nyse';
import { LSEExchangeCalendar } from './lse';

export type ExchangeName = 'NYSE' | 'LSE';

export function getCalendar(name: ExchangeName): ExchangeCalendar {
  switch (name) {
    case 'NYSE':
      return new NYSEExchangeCalendar();
    case 'LSE':
      return new LSEExchangeCalendar();
  }
}
