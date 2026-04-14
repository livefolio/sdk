# PriceStream Interface Design

**Date:** 2026-04-13
**Package:** `@livefolio/sdk` (interface only — implementation in `@livefolio/market`)

## Purpose

Define a runtime-agnostic interface for real-time price streaming with dynamic symbol subscription. The SDK owns the type contract; implementations live in consumer packages like `@livefolio/market`.

## Interface

```ts
// src/providers/price-stream.ts

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
```

## Events

| Event | Callback signature | Description |
|-------|-------------------|-------------|
| `tick` | `(symbol: string, price: number) => void` | Raw market price for a symbol. No leverage scaling — that is `SimulationHandle.push()`'s responsibility. |
| `status` | `(status: StreamStatus) => void` | Connection state change. |
| `error` | `(error: Error) => void` | Stream error. |

## Behavioral Contract

1. **Dynamic subscriptions** — `subscribe()`/`unsubscribe()` can be called at any time, including before connection is established. The implementation manages the internal symbol set and updates the underlying source accordingly.

2. **Duplicate safety** — calling `subscribe('SPY')` twice does not produce duplicate ticks. Calling `unsubscribe('SPY')` once removes it regardless of how many times it was subscribed.

3. **No ticks for unsubscribed symbols** — after `unsubscribe('SPY')`, no more `tick` events fire for `SPY`, even if the underlying source still sends them.

4. **Status lifecycle** — status events fire in this order:
   - `connected` — stream is live, ticks are flowing
   - `disconnected` — connection lost (may be followed by `reconnecting`)
   - `reconnecting` — implementation is attempting to restore the connection
   - Back to `connected` on success, or `error` if exhausted

5. **Close is final** — after `close()`, no more events fire. Calling `subscribe()`/`unsubscribe()` after `close()` is a no-op.

6. **Multiple listeners** — multiple callbacks can be registered for the same event. They fire in registration order.

7. **Raw market prices** — ticks emit the actual market price for the symbol. No leverage scaling.

## SDK Integration

The interface is a standalone provider type. It is **not** added to `LivefolioClient` or `LivefolioClientOptions`. The consumer creates and manages the stream directly.

### Exports added to `src/index.ts`

```ts
export type { PriceStream, StreamStatus } from './providers/price-stream';
```

### Consumer wiring (app)

```ts
import type { PriceStream } from '@livefolio/sdk';
import { createYahooPriceStream } from '@livefolio/market';

const stream: PriceStream = createYahooPriceStream();

stream.on('tick', (symbol, price) => {
  const ticker = tickers[symbol];
  if (ticker) {
    const snapshot = sim.push([ticker, price]);
    // update UI
  }
});

stream.subscribe('SPY', 'TLT', 'GLD');

// strategy changes
stream.unsubscribe('TLT');
stream.subscribe('IEF');

// cleanup
stream.close();
```

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Interface location | SDK | Same pattern as `MarketProvider` — SDK defines contract, packages implement |
| Event style | Typed method overloads | Type-safe per event, minimal API, matches SDK conventions. Three events is too few for generic event map machinery. |
| Subscription API | Variadic `...symbols` | Matches SDK's existing spread patterns (e.g., `push()`), avoids N calls when loading a strategy |
| Tick payload | `(symbol, price)` single tick | Simpler than batch; consumer can batch if needed |
| Status payload | String union | Consumer only needs to know the state, not debug info |
| Runtime target | Agnostic | No DOM or Node-specific APIs — works in browser and CLI |

## Out of Scope

- Implementation (`createYahooPriceStream`) — belongs in `@livefolio/market`
- Reconnect strategy, heartbeats, protobuf encoding — implementation details
- React hooks (`usePriceStream`) — app-level concern
