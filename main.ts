// BTC Race Bot — trend-following cbBTC/USDC bot for make.fun
// btc-race-24h-20261123-0511 (agent-fun/bars-replay/v1).
//
// Strategy, written from scratch for this competition:
//   * Trend filter: EMA(12) above EMA(48) by more than 10 bps, the latest
//     close above EMA(12), and the trailing 60-minute return above 30 bps.
//     All three must agree before we buy — one noisy minute cannot trigger
//     an entry, and a flat or falling market keeps us in cash.
//   * One position at a time, full size (100% of cash) on entry.
//   * Exit on a 2.5% trailing stop below the peak since entry, or a 3%
//     stop-loss below the entry price. No take-profit: in a real uptrend
//     the trailing stop is what locks gains in, and cutting a winner short
//     costs more than the extra round trips save.
//   * 45-minute cooldown after an exit so a whipsaw cannot re-enter at once.
//   * Equity guard: once equity has fallen more than 8% below its peak,
//     no new entries for the rest of the window. The race window ranks an
//     entry below every entry that meets the bar if its max drawdown tops
//     25%; this guard stops the bleeding long before that, while the
//     trailing stop already protects any open position.
//   * Deterministic: every decision is a pure function of the closes seen
//     so far. No clock, no randomness, no network, no files.
//
// Costs: a full-size round trip pays ~26 bps (4 bps fee + 2 bps slippage
// + ~7 bps impact each way at the frozen pool depth), so entries need a
// real trend behind them, not a one-minute wiggle. Local grade on the kit
// dev window (`grade-local --driver process`): net PnL +$29.32 USDC on the
// $1,000 start, 1 trade, max drawdown 1.98%.

import { runBars } from './vendor/makefun-bars.ts';
import type { BarsState, Batch, OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';

// --- strategy parameters (minutes / basis points / percent) ---
const FAST_EMA = 12;
const SLOW_EMA = 48;
const ENTRY_GAP_BPS = 10; // EMA(12) must clear EMA(48) by this much
const MOMENTUM_MINUTES = 60; // trailing return window for the entry filter
const MOMENTUM_BPS = 30; // trailing 60-minute return must clear this
const TRAILING_STOP_PCT = 2.5; // exit when close falls this far below the peak
const STOP_LOSS_PCT = 3.0; // exit when close falls this far below entry
const COOLDOWN_BARS = 45; // bars to wait after an exit before re-entering
const EQUITY_HALT_PCT = 8.0; // halt new entries once equity is this far below peak
const MAX_SLIPPAGE_BPS = 100; // 1%: far above the ~13 bps a leg costs

// --- state, rebuilt from the bar stream on every run ---
let emaFast: number | null = null;
let emaSlow: number | null = null;
const closes: number[] = []; // closes in USDC, oldest first
let inPosition = false;
let entryPrice = 0;
let peakPrice = 0;
let lastExitBar = -1_000_000;
let peakEquity = 0n; // highest equity seen, in micro-USDC
let halted = false; // latched once equity falls EQUITY_HALT_PCT below peak

function emaAlpha(period: number): number {
  return 2 / (period + 1);
}

await runBars({
  onBatch(state: BarsState, _batch: Batch): OrderInput[] {
    // Warm-up batches are not tradeable: orders decided on them are
    // rejected, so sit them out and let the EMAs build.
    if (state.warmingUp) return [];

    const closeRaw = state.close(SYMBOL);
    if (closeRaw === null) return [];
    // Price scale is 5 (close is in units of 1e-5 USDC).
    const close = Number(closeRaw) / 100_000;

    // Equity guard: track the peak and latch a halt on new entries.
    if (state.equity > peakEquity) peakEquity = state.equity;
    if (!halted && peakEquity > 0n && state.equity * 100n < peakEquity * BigInt(Math.round(100 - EQUITY_HALT_PCT))) {
      halted = true;
    }

    if (emaFast === null || emaSlow === null) {
      emaFast = close;
      emaSlow = close;
    } else {
      emaFast += emaAlpha(FAST_EMA) * (close - emaFast);
      emaSlow += emaAlpha(SLOW_EMA) * (close - emaSlow);
    }
    closes.push(close);

    const held = state.positions.get(SYMBOL);
    const heldQty = held?.qty ?? 0n;

    if (inPosition && heldQty > 0n) {
      if (close > peakPrice) peakPrice = close;
      const belowTrail = close < peakPrice * (1 - TRAILING_STOP_PCT / 100);
      const belowStop = close < entryPrice * (1 - STOP_LOSS_PCT / 100);
      if (belowTrail || belowStop) {
        inPosition = false;
        lastExitBar = state.seq;
        return [
          {
            side: 'sell',
            symbol: SYMBOL,
            qty: heldQty,
            max_slippage_bps: MAX_SLIPPAGE_BPS,
          },
        ];
      }
      return [];
    }

    // Not in a position (or the position is gone): look for an entry.
    inPosition = false;
    if (halted) return []; // equity guard latched: sit out the rest
    if (state.seq < SLOW_EMA) return []; // EMAs need history first
    if (state.seq - lastExitBar < COOLDOWN_BARS) return [];
    if (closes.length <= MOMENTUM_MINUTES) return [];

    const gapBps = ((emaFast - emaSlow) / emaSlow) * 10_000;
    const momentumBps =
      ((close - closes[closes.length - 1 - MOMENTUM_MINUTES]) /
        closes[closes.length - 1 - MOMENTUM_MINUTES]) *
      10_000;
    const trendUp = gapBps > ENTRY_GAP_BPS && close > emaFast;
    const momentumUp = momentumBps > MOMENTUM_BPS;

    if (trendUp && momentumUp && state.cash > 0n) {
      inPosition = true;
      entryPrice = close;
      peakPrice = close;
      return [
        {
          side: 'buy',
          symbol: SYMBOL,
          notional_quote_units: state.cash,
          max_slippage_bps: MAX_SLIPPAGE_BPS,
        },
      ];
    }
    return [];
  },
});
