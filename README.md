# BTC Race Bot

[![bounty](https://make.fun/badge/btc-race-24h-20261123-0511.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511)
[![rank](https://make.fun/badge/btc-race-24h-20261123-0511/TUHIN729/btc-race-20261123/rank.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511/leaderboard)
[![reward](https://make.fun/badge/btc-race-24h-20261123-0511/TUHIN729/btc-race-20261123/reward.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511/leaderboard)

A trend-following trading bot for [Race a BTC trading bot live for 24 hours](https://make.fun/bounty/btc-race-24h-20261123-0511) on make.fun. It trades Coinbase Wrapped BTC (cbBTC) against USDC, minute by minute, on 1-minute on-chain bars from the Orca Whirlpool, starting with $1,000 of paper money. See the [leaderboard](https://make.fun/bounty/btc-race-24h-20261123-0511/leaderboard).

## Strategy

- **Entry — all three must agree:** EMA(12) clears EMA(48) by more than 10 bps, the latest close sits above EMA(12), and the trailing 60-minute return is above 30 bps. One noisy minute cannot trigger a trade, and a flat or falling market keeps the bot in cash.
- **One position at a time, full size** (100% of cash) on entry.
- **Exit:** a 2.5% trailing stop below the peak since entry, or a 3% stop-loss below the entry price. No take-profit — in a real uptrend the trailing stop is what locks gains in.
- **Cooldown:** 45 minutes after an exit before a new entry, so a whipsaw cannot re-enter at once.
- **Deterministic:** every decision is a pure function of the closes seen so far. No clock, no randomness, no network, no files outside the repo.

A full-size round trip pays about 26 bps (4 bps fee + 2 bps slippage + ~7 bps price impact each way at the frozen pool depth), so entries need a real trend behind them.

## Local result (kit dev window, `grade-local --driver process`)

- Net PnL: **+$29.32 USDC** on the $1,000 start (dev gate: above $0)
- Trades: 1 (buy at bar 56, held to the end of the window)
- Max drawdown: −1.98% (guardrail: 25%)
- Fees paid: $0.81 USDC; at 2x fees the net PnL is still +$28.50 USDC

## Run it

The bot speaks `agent-fun/bars-replay/v1` (NDJSON on stdin/stdout) via the kit SDK shim in `vendor/`:

```sh
node main.ts
```

Grade it on the dev window exactly as the server does:

```sh
node <kit>/cli/makefun.mjs grade-local --kit <kit> --bot . --driver process
```

## Files

- `main.ts` — the bot (Node 22, erasable TypeScript)
- `vendor/makefun-bars.ts` — the kit's SDK shim, copied verbatim (left out of authorship counts)
- `README.md`, `LICENSE` (MIT)
