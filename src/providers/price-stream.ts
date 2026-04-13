export type StreamStatus = 'connected' | 'disconnected' | 'reconnecting';

export interface PriceStream {
  subscribe(...symbols: string[]): void;
  unsubscribe(...symbols: string[]): void;

  on(event: 'tick', cb: (symbol: string, price: number) => void): void;
  on(event: 'status', cb: (status: StreamStatus) => void): void;
  on(event: 'error', cb: (error: Error) => void): void;

  off(event: 'tick', cb: (symbol: string, price: number) => void): void;
  off(event: 'status', cb: (status: StreamStatus) => void): void;
  off(event: 'error', cb: (error: Error) => void): void;

  close(): void;
}
