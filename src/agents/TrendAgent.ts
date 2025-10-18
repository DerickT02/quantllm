/**
 * ──────────────────────────────────────────────────────────────────────────────
 * TREND AGENT
 * ──────────────────────────────────────────────────────────────────────────────
 * Tracks trend of price over time using technical analysis
 * 
 * Features:
 * - EMA12 vs EMA26 crossover analysis for trend direction
 * - Recent slope calculation to measure momentum
 * - Trend strength quantification based on EMA divergence
 * - Real-time trend classification: Uptrend, Downtrend, Sideways
 */

import { AgentContext, TrendOut, Candle } from '../types.js';
import { GeminiService } from '../gemini.js';
import { ema, simpleSlope } from '../utils/technical.js';

/**
 * TrendAgent: EMA cross + slope strength analysis
 * 
 * Rules:
 * - trend ∈ {Uptrend, Downtrend, Sideways}
 * - strength ∈ [0,1], grows with |EMA12-EMA26|/EMA26 and slope magnitude
 * - Include emaFast (EMA12), emaSlow (EMA26), slope
 * 
 * @param ctx - Agent context containing candle data
 * @returns Promise<TrendOut> - JSON with trend, EMAs, slope, and strength
 */
export async function TrendAgent(ctx: AgentContext): Promise<TrendOut> {
  const closes = ctx.candles.map(c => c.close);
  
  // EMA periods for trend analysis
  const fastPeriod = 12;
  const slowPeriod = 26;
  
  // Calculate EMAs using sufficient data
  const dataSlice = closes.slice(-Math.max(slowPeriod, fastPeriod));
  const emaFast = ema(dataSlice, fastPeriod);
  const emaSlow = ema(dataSlice, slowPeriod);
  
  // Calculate recent price momentum
  const slopeVal = simpleSlope(closes, 12);

  // Determine trend direction based on EMA crossover
  let trend: TrendOut['trend'] = 'Sideways';
  if (emaFast > emaSlow * 1.001) trend = 'Uptrend';
  else if (emaFast < emaSlow * 0.999) trend = 'Downtrend';

  // Calculate trend strength based on EMA divergence
  const emaDivergence = Math.abs((emaFast - emaSlow) / Math.max(emaSlow, 1e-9));
  const strength = Math.min(1, emaDivergence * 10);

  const out: TrendOut = { trend, emaFast, emaSlow, slope: slopeVal, strength };

  if (process.env.TREND_AI === 'true' && process.env.GEMINI_API_KEY) {
    try {
      const gemini = new GeminiService();
      const summary = await gemini.generateResponse(
        'Explain what this trend context means briefly (1-2 sentences).',
        { recentAnalysis: { data: { trend: out } } }
      );
      out.aiSummary = summary.slice(0, 250);
    } catch {}
  }

  return out;
}

/**
 * Standalone function to run TrendAgent with raw candle data
 * @param candles - Array of OHLCV candles
 * @returns Promise<TrendOut> - Trend analysis results
 */
export async function runTrendAgent(candles: Candle[]): Promise<TrendOut> {
  return TrendAgent({ candles });
}

/**
 * Helper function to get trend description
 * @param trendOut - Trend analysis output
 * @returns Human-readable trend description
 */
export function getTrendDescription(trendOut: TrendOut): string {
  const { trend, strength, slope } = trendOut;
  const strengthDesc = strength > 0.7 ? 'Strong' : 
                      strength > 0.4 ? 'Moderate' : 'Weak';
  const momentumDesc = slope > 0.001 ? 'accelerating' :
                      slope < -0.001 ? 'decelerating' : 'stable';
  
  return `${strengthDesc} ${trend.toLowerCase()} with ${momentumDesc} momentum`;
}

/**
 * Check if trend is bullish (uptrend with positive momentum)
 * @param trendOut - Trend analysis output
 * @returns boolean indicating bullish trend
 */
export function isBullishTrend(trendOut: TrendOut): boolean {
  return trendOut.trend === 'Uptrend' && trendOut.slope > 0;
}

/**
 * Check if trend is bearish (downtrend with negative momentum)
 * @param trendOut - Trend analysis output
 * @returns boolean indicating bearish trend
 */
export function isBearishTrend(trendOut: TrendOut): boolean {
  return trendOut.trend === 'Downtrend' && trendOut.slope < 0;
}