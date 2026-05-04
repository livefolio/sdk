---
layout: home

hero:
  name: '@livefolio/sdk'
  text: TypeScript SDK for tactical allocation strategies
  tagline: Declarative TacticalSpec, pluggable runtime layers, content-addressed feature cache.
  actions:
    - theme: brand
      text: Get started
      link: /getting-started/install
    - theme: alt
      text: Quick start
      link: /getting-started/first-strategy
    - theme: alt
      text: API reference
      link: /api/

features:
  - title: Spec-driven strategies
    details: Author strategies as plain JSON-shaped TacticalSpecs. Same spec drives backtests today and live execution tomorrow — no rewrites.
  - title: Pluggable runtime
    details: DataFeed, Executor, Calendar, and FeatureCache are interfaces. Reference impls ship in the box. Swap any layer without touching strategy code.
  - title: Content-addressed features
    details: Indicators are keyed by (spec, asset, date). Cache hits across runs. MemoryFeatureCache for in-process; bring your own for cross-process.
  - title: Faithful exchange calendars
    details: NYSE (1885+) and LSE (1801+) calendars ported from pandas_market_calendars — era-varying weekmasks, special closes, royal events, the lot.
  - title: Parity-tested
    details: A 5.5-year regression gate proves the v0.4 dialect emits identical target weights to the v0.3 fluent API on the canonical SPY/QQQ/IEF strategy.
  - title: Type-safe end to end
    details: Strict TypeScript, ES modules, no untyped escape hatches. Strategies, features, and orders all carry their generic shape through the runtime.
---
