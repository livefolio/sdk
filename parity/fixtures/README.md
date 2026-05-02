# Parity Fixtures

Recorded yfinance OHLCV bars for the parity gate, copied verbatim from
`~/Documents/Personal/livefolio-2/yfinance/test/fixtures/`.

| File | Symbol | Range |
|---|---|---|
| `SPY-2020-2026.json` | SPY | 2020-01-02 → 2026-05-01 |
| `QQQ-2020-2026.json` | QQQ | 2020-01-02 → 2026-05-01 |
| `IEF-2020-2026.json` | IEF | 2020-01-02 → 2026-05-01 |

Each file is `Bar[]` (yfinance shape: ISO timestamps, OHLC + volume, `adjclose/close` ratio applied uniformly to OHL).

## Refreshing

The yfinance repo owns recording. From this repo's parent:

    cd ../yfinance
    npm run fixtures:record   # hits Yahoo once
    cd ../sdk
    cp ../yfinance/test/fixtures/{SPY,QQQ,IEF}-2020-2026.json parity/fixtures/

We copy instead of symlink so CI doesn't depend on the yfinance checkout being co-located.
