import { ExchangeCalendar } from './exchange-calendar';
import { NYSEExchangeCalendar } from './nyse';
import { LSEExchangeCalendar } from './lse';

/**
 * Union of supported exchange names accepted by {@link getCalendar}.
 *
 * - `'NYSE'` — New York Stock Exchange (and NYSE-equivalent venues).
 * - `'LSE'`  — London Stock Exchange.
 */
export type ExchangeName = 'NYSE' | 'LSE';

/**
 * Returns a new instance of the {@link ExchangeCalendar} registered under
 * `name`. Acts as a simple factory / registry for the two built-in calendar
 * implementations.
 *
 * Supported exchange names: `'NYSE'` ({@link NYSEExchangeCalendar}) and
 * `'LSE'` ({@link LSEExchangeCalendar}). TypeScript's exhaustive switch
 * prevents unknown names from compiling.
 *
 * @param name - One of the supported {@link ExchangeName} values.
 * @returns A fresh `ExchangeCalendar` instance for the named exchange.
 *
 * @example
 * ```ts
 * import { getCalendar } from '@livefolio/sdk';
 *
 * const nyse = getCalendar('NYSE');
 * console.log(nyse.isOpen(new Date('2024-07-04'))); // false — US Independence Day
 *
 * const lse = getCalendar('LSE');
 * console.log(lse.isOpen(new Date('2024-12-25'))); // false — Christmas Day
 * ```
 */
export function getCalendar(name: ExchangeName): ExchangeCalendar {
  switch (name) {
    case 'NYSE':
      return new NYSEExchangeCalendar();
    case 'LSE':
      return new LSEExchangeCalendar();
  }
}
