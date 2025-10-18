/**
 * ──────────────────────────────────────────────────────────────────────────────
 * INDICATOR AGENT
 * ──────────────────────────────────────────────────────────────────────────────
 * Agent that indicates the Bullish or Bearish Market (Overbought/Oversold)
 * 
 * Features:
 * - Computes RSI(14) from OHLCV candles
 * - Labels market regime: {Bullish, Bearish, Neutral}
 * - Flags overbought (RSI ≥ 70) and oversold (RSI ≤ 30) conditions
 * - Confidence grows with |RSI-50| deviation from neutral
 */

import { AgentContext, IndicatorOut } from '../types.js';
import { GeminiService } from '../gemini.js';
import { rsi } from '../utils/technical.js';

/**
 * IndicatorAgent: RSI + simple regime labeling
 * 
 * Rules:
 * - regime ∈ {Bullish, Bearish, Neutral}
 * - overbought = RSI ≥ 70, oversold = RSI ≤ 30
 * - confidence ∈ [0,1], grows with |RSI-50|
 * 
 * @param ctx - Agent context containing candle data
 * @returns Promise<IndicatorOut> - JSON with RSI, regime, flags, and confidence
 */
export async function IndicatorAgent(ctx: AgentContext): Promise<IndicatorOut> {
  const closes = ctx.candles.map(c => c.close);
  const rsiVal = rsi(closes, 14);
  
  // Overbought/Oversold flags
  const overbought = rsiVal >= 70;
  const oversold = rsiVal <= 30;

  // Market regime classification
  let regime: IndicatorOut['regime'] = 'Neutral';
  if (rsiVal >= 60) regime = 'Bullish';
  else if (rsiVal <= 40) regime = 'Bearish';

  // Confidence grows as RSI departs from 50 (neutral)
  const confidence = Math.min(1, Math.abs(rsiVal - 50) / 30);

  const out: IndicatorOut = { rsi: rsiVal, overbought, oversold, regime, confidence };

  // Optional LLM commentary
  if (process.env.INDICATOR_AI === 'true' && process.env.GEMINI_API_KEY) {
    try {
      const gemini = new GeminiService();
      const summary = await gemini.generateResponse(
        'Summarize RSI/regime context briefly for a trader (1-2 sentences, no financial advice).',
        { recentAnalysis: { data: { indicator: out } } }
      );
      out.aiSummary = summary.slice(0, 280);
    } catch {}
  }

  return out;
}

/**
 * Standalone function to run IndicatorAgent with raw candle data
 * @param candles - Array of OHLCV candles
 * @returns Promise<IndicatorOut> - Indicator analysis results
 */
export async function runIndicatorAgent(candles: any[]): Promise<IndicatorOut> {
  return IndicatorAgent({ candles });
}