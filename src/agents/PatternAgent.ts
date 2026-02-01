/**
 * ──────────────────────────────────────────────────────────────────────────────
 * PATTERN AGENT
 * ──────────────────────────────────────────────────────────────────────────────
 * Makes clear candlestick charts directly from raw price data
 * 
 * Features:
 * - Detects dominant candlestick patterns from OHLCV data
 * - Supports: BullishEngulfing, BearishEngulfing, Doji, None
 * - Calculates pattern strength based on body size ratios
 * - Real-time pattern recognition for trading signals
 */

import { AgentContext, PatternOut, Candle } from '../types.js';
import { GeminiService } from '../gemini.js';

/**
 * PatternAgent: Basic candlestick patterns (2-candle engulfing + doji)
 * 
 * Rules:
 * - Doji if body is tiny relative to price (~0.1% of close)
 * - Engulfing if last body fully covers previous body with opposite color
 * - strength ∈ [0,1] ~ body-size-ratio or clarity
 * 
 * @param ctx - Agent context containing candle data
 * @returns Promise<PatternOut> - JSON with pattern type and strength
 */
export async function PatternAgent(ctx: AgentContext): Promise<PatternOut> {
  const cs = ctx.candles;
  if (cs.length < 2) return { pattern: 'None', strength: 0 };

  const prev = cs[cs.length - 2];
  const last = cs[cs.length - 1];

  // Calculate candle body sizes
  const prevBody = Math.abs(prev.close - prev.open);
  const lastBody = Math.abs(last.close - last.open);
  
  // Helper function to check if body is tiny (Doji condition)
  const isTinyBody = (bodySize: number, price: number) => 
    bodySize <= (0.001 * price);

  // Check for Doji pattern
  const isDoji = isTinyBody(lastBody, last.close);
  if (isDoji) {
    const out: PatternOut = { pattern: 'Doji', strength: 0.4 };
    if (process.env.PATTERN_AI === 'true' && process.env.GEMINI_API_KEY) {
      try {
        const gemini = new GeminiService();
        const summary = await gemini.generateResponse(
          'Explain what a Doji means succinctly for a trader (1 sentence).',
          {}
        );
        out.aiSummary = summary.slice(0, 200);
      } catch {}
    }
    return out;
  }

  // Determine candle colors (bullish/bearish)
  const lastBull = last.close > last.open;
  const lastBear = last.close < last.open;
  const prevBull = prev.close > prev.open;
  const prevBear = prev.close < prev.open;

  // Check for engulfing pattern
  // Engulfing: body of last candle fully engulfs previous body
  const engulfs =
    Math.min(last.open, last.close) <= Math.min(prev.open, prev.close) &&
    Math.max(last.open, last.close) >= Math.max(prev.open, prev.close);

  // Bullish Engulfing: bullish candle engulfs previous bearish candle
  if (lastBull && prevBear && engulfs) {
    const strength = Math.min(1, lastBody / (prevBody + 1e-9));
    const out: PatternOut = { pattern: 'BullishEngulfing', strength };
    if (process.env.PATTERN_AI === 'true' && process.env.GEMINI_API_KEY) {
      try {
        const gemini = new GeminiService();
        const summary = await gemini.generateResponse(
          'Explain the trade significance of a bullish engulfing pattern succinctly (1 sentence).',
          {}
        );
        out.aiSummary = summary.slice(0, 200);
      } catch {}
    }
    return out;
  }

  // Bearish Engulfing: bearish candle engulfs previous bullish candle
  if (lastBear && prevBull && engulfs) {
    const strength = Math.min(1, lastBody / (prevBody + 1e-9));
    const out: PatternOut = { pattern: 'BearishEngulfing', strength };
    if (process.env.PATTERN_AI === 'true' && process.env.GEMINI_API_KEY) {
      try {
        const gemini = new GeminiService();
        const summary = await gemini.generateResponse(
          'Explain the trade significance of a bearish engulfing pattern succinctly (1 sentence).',
          {}
        );
        out.aiSummary = summary.slice(0, 200);
      } catch {}
    }
    return out;
  }

  // No significant pattern detected
  return { pattern: 'None', strength: 0 };
}

/**
 * Standalone function to run PatternAgent with raw candle data
 * @param candles - Array of OHLCV candles
 * @returns Promise<PatternOut> - Pattern analysis results
 */
export async function runPatternAgent(candles: Candle[]): Promise<PatternOut> {
  return PatternAgent({ candles });
}

/**
 * Helper function to get pattern description
 * @param pattern - Pattern type
 * @returns Human-readable pattern description
 */
export function getPatternDescription(pattern: PatternOut['pattern']): string {
  switch (pattern) {
    case 'BullishEngulfing':
      return 'Bullish reversal signal: Large green candle engulfs previous red candle';
    case 'BearishEngulfing':
      return 'Bearish reversal signal: Large red candle engulfs previous green candle';
    case 'Doji':
      return 'Indecision signal: Open and close prices are nearly equal';
    case 'None':
    default:
      return 'No significant pattern detected';
  }
}