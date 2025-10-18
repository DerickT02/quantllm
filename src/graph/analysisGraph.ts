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

  for (let i = 26; i < n; i++) {
    const time = candles[i].time;
    const r = rsiSeries[i];
    const up = ema12[i] > ema26[i] * 1.001;
    const down = ema12[i] < ema26[i] * 0.999;
    const pat = patternByIndex.get(i) || patternByIndex.get(i - 1);

    // BUY: Uptrend, RSI>55 and <70, bullish pattern (current or prev)
    if (up && r > 55 && r < 70 && pat && pat.pattern === 'BullishEngulfing') {
      const score = 0.5 + Math.min(0.5, pat.strength * 0.5);
      signals.push({ index: i, time, type: 'BUY', score, reason: 'Uptrend + RSI>55 + Bullish Engulfing' });
      continue;
    }

    // SELL: Downtrend, RSI<45 and >30, bearish pattern
    if (down && r < 45 && r > 30 && pat && pat.pattern === 'BearishEngulfing') {
      const score = 0.5 + Math.min(0.5, pat.strength * 0.5);
      signals.push({ index: i, time, type: 'SELL', score, reason: 'Downtrend + RSI<45 + Bearish Engulfing' });
      continue;
    }
  }
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
