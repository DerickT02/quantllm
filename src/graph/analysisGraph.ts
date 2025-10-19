/**
 * LangGraph pipeline for QuantLLM agents (opt-in via USE_LANGGRAPH)
 * - Runs Indicator, Pattern, Trend in parallel
 * - Joins into Risk
 * - Adds per-agent visuals and combined BUY/SELL signals
 * - Returns same shape as orchestrator expects: { ctx, narrative }
 */

import { Candle, AgentContext } from '../types.js';
import { IndicatorAgent, PatternAgent, TrendAgent, RiskAgent } from '../agents/index.js';
import { rsi as rsiLast, ema as emaLast } from '../utils/technical.js';

export type GraphState = {
  candles: Candle[];
  indicator?: AgentContext['indicator'];
  pattern?: AgentContext['pattern'];
  trend?: AgentContext['trend'];
  risk?: AgentContext['risk'];
  visuals?: any;
  signals?: Array<{ index: number; time: number; type: 'BUY' | 'SELL'; score: number; reason: string }>;
  narrative?: string;
  errors?: string[];
};

// ---- Node implementations --------------------------------------------------
async function indicatorNode(state: GraphState): Promise<Partial<GraphState>> {
  try {
    const indicator = await IndicatorAgent({ candles: state.candles });
    return { indicator };
  } catch (e: any) {
    return { errors: [ ...(state.errors || []), `indicator:${e?.message || e}` ] };
  }
}

async function patternNode(state: GraphState): Promise<Partial<GraphState>> {
  try {
    const pattern = await PatternAgent({ candles: state.candles });
    return { pattern };
  } catch (e: any) {
    return { errors: [ ...(state.errors || []), `pattern:${e?.message || e}` ] };
  }
}

async function trendNode(state: GraphState): Promise<Partial<GraphState>> {
  try {
    const trend = await TrendAgent({ candles: state.candles });
    return { trend };
  } catch (e: any) {
    return { errors: [ ...(state.errors || []), `trend:${e?.message || e}` ] };
  }
}

async function riskNode(state: GraphState): Promise<Partial<GraphState>> {
  try {
    if (!state.indicator || !state.pattern || !state.trend) return {};
    const risk = await RiskAgent({
      candles: state.candles,
      indicator: state.indicator,
      pattern: state.pattern,
      trend: state.trend,
    });
    return { risk };
  } catch (e: any) {
    return { errors: [ ...(state.errors || []), `risk:${e?.message || e}` ] };
  }
}

// Compute visuals (RSI series, EMA series, pattern events) and combined signals
async function visualsAndSignalsNode(state: GraphState): Promise<Partial<GraphState>> {
  try {
    const { visuals, signals } = computeVisualsAndSignals(state.candles);
    return { visuals, signals };
  } catch (e: any) {
    return { errors: [ ...(state.errors || []), `visuals:${e?.message || e}` ] };
  }
}

async function narrativeNode(state: GraphState): Promise<Partial<GraphState>> {
  const ctx: AgentContext = {
    candles: state.candles,
    indicator: state.indicator,
    pattern: state.pattern,
    trend: state.trend,
    risk: state.risk,
  };
  return { narrative: generateNarrative(ctx) };
}

// ---- Graph assembly --------------------------------------------------------
export async function runGraphPipeline(candles: Candle[]): Promise<{ ctx: AgentContext; narrative: string; visuals?: any; signals?: any[] }>{
  // Run indicator/pattern/trend in parallel
  const base: GraphState = { candles, errors: [] };
  const [indRes, patRes, trRes] = await Promise.all([
    indicatorNode(base),
    patternNode(base),
    trendNode(base),
  ]);

  const merged1: GraphState = {
    ...base,
    indicator: indRes.indicator,
    pattern: patRes.pattern,
    trend: trRes.trend,
    errors: [ ...(base.errors || []), ...(indRes.errors || []), ...(patRes.errors || []), ...(trRes.errors || []) ],
  };

  const riskRes = await riskNode(merged1);
  const merged2: GraphState = {
    ...merged1,
    risk: riskRes.risk,
    errors: [ ...(merged1.errors || []), ...(riskRes.errors || []) ],
  };

  const vizRes = await visualsAndSignalsNode(merged2);
  const merged3: GraphState = {
    ...merged2,
    visuals: vizRes.visuals,
    signals: vizRes.signals,
    errors: [ ...(merged2.errors || []), ...(vizRes.errors || []) ],
  };

  const narRes = await narrativeNode(merged3);
  const finalState: GraphState = { ...merged3, narrative: narRes.narrative };

  const ctx: AgentContext = {
    candles,
    indicator: finalState.indicator,
    pattern: finalState.pattern,
    trend: finalState.trend,
    risk: finalState.risk,
  };

  return { ctx, narrative: finalState.narrative || generateNarrative(ctx), visuals: finalState.visuals, signals: finalState.signals };
}

// ---- Helpers ---------------------------------------------------------------
function generateNarrative(ctx: AgentContext): string {
  if (!ctx.indicator || !ctx.pattern || !ctx.trend || !ctx.risk) {
    return 'Incomplete analysis - missing agent outputs';
  }

  const last = ctx.candles.at(-1);
  if (!last) return 'No candle data available';

  const dirEmoji = ctx.indicator.regime === 'Bullish' ? '📈' : ctx.indicator.regime === 'Bearish' ? '📉' : '➖';
  const timestamp = `Time: ${new Date(last.time * 1000).toISOString()}`;
  const indicatorLine = `${dirEmoji} Indicator: RSI=${ctx.indicator.rsi?.toFixed(1)} (${ctx.indicator.regime}${ctx.indicator.overbought ? ', Overbought' : ''}${ctx.indicator.oversold ? ', Oversold' : ''}); confidence=${ctx.indicator.confidence.toFixed(2)}`;
  const patternLine = `🕯️ Pattern: ${ctx.pattern.pattern} (strength=${ctx.pattern.strength.toFixed(2)})`;
  const trendLine = `📊 Trend: ${ctx.trend.trend} (EMA12=${ctx.trend.emaFast.toFixed(5)}, EMA26=${ctx.trend.emaSlow.toFixed(5)}, strength=${ctx.trend.strength.toFixed(2)})`;
  const riskLine = `🛡️ Risk: ρ=${ctx.risk.rho.toFixed(5)}, r=${ctx.risk.rMultiplier.toFixed(2)} ⇒ take-profit R=${ctx.risk.takeProfit.toFixed(5)} (${ctx.risk.commentary})`;

  return [timestamp, indicatorLine, patternLine, trendLine, riskLine].join('\n');
}

function computeRsiSeries(closes: number[], period = 14): number[] {
  const series: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    const sub = closes.slice(0, i + 1);
    series.push(rsiLast(sub, period));
  }
  return series;
}

function computeEmaSeries(closes: number[], period: number): number[] {
  const series: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    const sub = closes.slice(0, i + 1);
    series.push(emaLast(sub, period));
  }
  return series;
}

function computePatternEvents(candles: Candle[]): Array<{ index: number; pattern: 'BullishEngulfing' | 'BearishEngulfing' | 'Doji'; strength: number }>{
  const events: Array<{ index: number; pattern: 'BullishEngulfing' | 'BearishEngulfing' | 'Doji'; strength: number }> = [];
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1];
    const last = candles[i];
    const prevBody = Math.abs(prev.close - prev.open);
    const lastBody = Math.abs(last.close - last.open);
    const isDoji = lastBody <= 0.001 * last.close;
    if (isDoji) {
      events.push({ index: i, pattern: 'Doji', strength: 0.4 });
      continue;
    }
    const lastBull = last.close > last.open;
    const lastBear = last.close < last.open;
    const prevBull = prev.close > prev.open;
    const prevBear = prev.close < prev.open;
    const engulfs = Math.min(last.open, last.close) <= Math.min(prev.open, prev.close) && Math.max(last.open, last.close) >= Math.max(prev.open, prev.close);
    if (lastBull && prevBear && engulfs) {
      const strength = Math.min(1, lastBody / (prevBody + 1e-9));
      events.push({ index: i, pattern: 'BullishEngulfing', strength });
    } else if (lastBear && prevBull && engulfs) {
      const strength = Math.min(1, lastBody / (prevBody + 1e-9));
      events.push({ index: i, pattern: 'BearishEngulfing', strength });
    }
  }
  return events;
}

function computeSignals(
  candles: Candle[],
  rsiSeries: number[],
  ema12: number[],
  ema26: number[],
  patternEvents: Array<{ index: number; pattern: 'BullishEngulfing' | 'BearishEngulfing' | 'Doji'; strength: number }>
): Array<{ index: number; time: number; type: 'BUY' | 'SELL'; score: number; reason: string }>{
  const signals: Array<{ index: number; time: number; type: 'BUY' | 'SELL'; score: number; reason: string }> = [];
  const n = candles.length;
  const patternByIndex = new Map<number, { pattern: string; strength: number }>();
  for (const ev of patternEvents) patternByIndex.set(ev.index, { pattern: ev.pattern, strength: ev.strength });

  // Calculate support and resistance levels from ALL candles for better accuracy
  const allHighs = candles.map(c => c.high);
  const allLows = candles.map(c => c.low);
  const allCloses = candles.map(c => c.close);
  
  // Find recent extremes (last 30 candles or all if fewer)
  const lookback = Math.min(30, n);
  const recentHighs = allHighs.slice(-lookback);
  const recentLows = allLows.slice(-lookback);
  
  const resistance = Math.max(...recentHighs);
  const support = Math.min(...recentLows);
  const priceRange = resistance - support;
  const midPoint = (resistance + support) / 2;

  // Track last signal to avoid duplicates
  let lastSignalIndex = -5;
  
  console.log(`[Signal Debug] Computing signals for ${n} candles, support: ${support.toFixed(0)}, resistance: ${resistance.toFixed(0)}, range: ${priceRange.toFixed(0)}`);

  for (let i = 26; i < n; i++) {
    // Skip if too close to last signal
    if (i - lastSignalIndex < 3) continue;

    const time = candles[i].time;
    const price = candles[i].close;
    const high = candles[i].high;
    const low = candles[i].low;
    const open = candles[i].open;
    const r = rsiSeries[i];
    
    // Trend detection
    const up = ema12[i] > ema26[i] * 1.0005;
    const down = ema12[i] < ema26[i] * 0.9995;
    const sideways = !up && !down;
    
    const pat = patternByIndex.get(i) || patternByIndex.get(i - 1);

    // Calculate distance from support/resistance as percentage
    const distanceFromSupport = ((price - support) / priceRange) * 100;
    const distanceFromResistance = ((resistance - price) / priceRange) * 100;
    
    // Candle direction
    const bullishCandle = candles[i].close > candles[i].open;
    const bearishCandle = candles[i].close < candles[i].open;
    
    // Price momentum (comparing with 3 candles ago)
    const prevPrice = i >= 3 ? candles[i - 3].close : price;
    const momentum = ((price - prevPrice) / prevPrice) * 100;
    
    // Debug last candle
    if (i === n - 1) {
      console.log(`[Signal Debug] Last candle (${i}): price=${price.toFixed(0)}, RSI=${r.toFixed(1)}, trend=${up?'UP':down?'DOWN':'SIDEWAYS'}`);
      console.log(`  distFromSupport=${distanceFromSupport.toFixed(1)}%, distFromResistance=${distanceFromResistance.toFixed(1)}%`);
      console.log(`  momentum=${momentum.toFixed(2)}%, bullish=${bullishCandle}, bearish=${bearishCandle}`);
    }

    // === BUY SIGNALS ===
    
    // 1. Strong BUY: Price at/near support with oversold or neutral RSI
    if (distanceFromSupport <= 30 && r < 52) {
      const score = 0.7 + (50 - r) / 150 + (25 - distanceFromSupport) / 100;
      signals.push({ index: i, time, type: 'BUY', score: Math.min(1, score), reason: `Support Zone ($${support.toFixed(0)}) + RSI ${r.toFixed(0)}` });
      lastSignalIndex = i;
      continue;
    }

    // 2. BUY: Bullish momentum with favorable RSI
    if (momentum > 0.05 && r > 40 && r < 70 && bullishCandle) {
      const score = 0.6 + momentum / 5;
      signals.push({ index: i, time, type: 'BUY', score: Math.min(1, score), reason: `Bullish Momentum +${momentum.toFixed(1)}%` });
      lastSignalIndex = i;
      continue;
    }

    // 3. BUY: Uptrend continuation with bullish pattern
    if (up && r > 45 && r < 70 && pat && pat.pattern === 'BullishEngulfing') {
      const score = 0.7 + Math.min(0.25, pat.strength * 0.25);
      signals.push({ index: i, time, type: 'BUY', score, reason: `Uptrend + ${pat.pattern}` });
      lastSignalIndex = i;
      continue;
    }

    // 4. BUY: RSI oversold recovery
    if (i > 0 && rsiSeries[i-1] < 35 && r >= 35 && r < 60) {
      const score = 0.65;
      signals.push({ index: i, time, type: 'BUY', score, reason: 'RSI Recovery from Oversold' });
      lastSignalIndex = i;
      continue;
    }

    // 5. BUY: Price in lower 40% of range in sideways market
    if (sideways && distanceFromSupport < 40 && bullishCandle && r < 60) {
      const score = 0.5 + (40 - distanceFromSupport) / 100;
      signals.push({ index: i, time, type: 'BUY', score: Math.min(0.75, score), reason: 'Range Bottom Buy' });
      lastSignalIndex = i;
      continue;
    }

    // 6. BUY: EMA crossover bullish
    if (i > 0 && ema12[i-1] <= ema26[i-1] && ema12[i] > ema26[i] && r < 70) {
      const score = 0.72;
      signals.push({ index: i, time, type: 'BUY', score, reason: 'EMA Bullish Crossover' });
      lastSignalIndex = i;
      continue;
    }

    // === SELL SIGNALS ===
    
    // 1. Strong SELL: Price at/near resistance with overbought or high RSI
    if (distanceFromResistance <= 30 && r > 48) {
      const score = 0.7 + (r - 50) / 150 + (25 - distanceFromResistance) / 100;
      signals.push({ index: i, time, type: 'SELL', score: Math.min(1, score), reason: `Resistance Zone ($${resistance.toFixed(0)}) + RSI ${r.toFixed(0)}` });
      lastSignalIndex = i;
      continue;
    }

    // 2. SELL: Bearish momentum with unfavorable RSI
    if (momentum < -0.05 && r < 60 && r > 30 && bearishCandle) {
      const score = 0.6 + Math.abs(momentum) / 5;
      signals.push({ index: i, time, type: 'SELL', score: Math.min(1, score), reason: `Bearish Momentum ${momentum.toFixed(1)}%` });
      lastSignalIndex = i;
      continue;
    }

    // 3. SELL: Downtrend continuation with bearish pattern
    if (down && r < 55 && r > 30 && pat && pat.pattern === 'BearishEngulfing') {
      const score = 0.7 + Math.min(0.25, pat.strength * 0.25);
      signals.push({ index: i, time, type: 'SELL', score, reason: `Downtrend + ${pat.pattern}` });
      lastSignalIndex = i;
      continue;
    }

    // 4. SELL: RSI overbought reversal
    if (i > 0 && rsiSeries[i-1] > 65 && r <= 65 && r > 40) {
      const score = 0.65;
      signals.push({ index: i, time, type: 'SELL', score, reason: 'RSI Reversal from Overbought' });
      lastSignalIndex = i;
      continue;
    }

    // 5. SELL: Price in upper 40% of range in sideways market
    if (sideways && distanceFromResistance < 40 && bearishCandle && r > 40) {
      const score = 0.5 + (40 - distanceFromResistance) / 100;
      signals.push({ index: i, time, type: 'SELL', score: Math.min(0.75, score), reason: 'Range Top Sell' });
      lastSignalIndex = i;
      continue;
    }

    // 6. SELL: EMA crossover bearish
    if (i > 0 && ema12[i-1] >= ema26[i-1] && ema12[i] < ema26[i] && r > 30) {
      const score = 0.72;
      signals.push({ index: i, time, type: 'SELL', score, reason: 'EMA Bearish Crossover' });
      lastSignalIndex = i;
      continue;
    }
  }
  
  console.log(`[Signal Debug] Generated ${signals.length} total signals (${signals.filter(s=>s.type==='BUY').length} BUY, ${signals.filter(s=>s.type==='SELL').length} SELL)`);
  
  return signals;
}

// Public helper to compute visuals/signals from only candles
export function computeVisualsAndSignals(candles: Candle[]): { visuals: any; signals: Array<{ index: number; time: number; type: 'BUY' | 'SELL'; score: number; reason: string }> } {
  const closes = candles.map(c => c.close);
  const times = candles.map(c => c.time);
  const rsiSeries = computeRsiSeries(closes, 14);
  const ema12 = computeEmaSeries(closes, 12);
  const ema26 = computeEmaSeries(closes, 26);
  const patternEvents = computePatternEvents(candles);
  const signals = computeSignals(candles, rsiSeries, ema12, ema26, patternEvents);
  return {
    visuals: {
      price: closes,
      indicator: { rsi: rsiSeries, overbought: 70, oversold: 30 },
      trend: { ema12, ema26 },
      pattern: { events: patternEvents },
      combined: { signals },
      times,
    },
    signals,
  };
}
