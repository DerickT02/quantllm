/**
 * ──────────────────────────────────────────────────────────────────────────────
 * SHARED TYPES FOR QUANTLLM AGENTS
 * ──────────────────────────────────────────────────────────────────────────────
 */

export type Candle = {
  time: number;   // epoch seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export type IndicatorOut = {
  rsi?: number;
  regime: 'Bullish' | 'Bearish' | 'Neutral';
  overbought: boolean;
  oversold: boolean;
  confidence: number; // 0..1
  aiSummary?: string; // optional LLM commentary
};

export type PatternOut = {
  pattern:
    | 'BullishEngulfing'
    | 'BearishEngulfing'
    | 'Doji'
    | 'None';
  strength: number; // 0..1
  aiSummary?: string; // optional LLM commentary
};

export type TrendOut = {
  trend: 'Uptrend' | 'Downtrend' | 'Sideways';
  emaFast: number;
  emaSlow: number;
  slope: number;        // simple slope of close
  strength: number;     // 0..1
  aiSummary?: string;   // optional LLM commentary
};

export type RiskOut = {
  rho: number;          // fixed stop-loss in price units
  rMultiplier: number;  // 1.2..1.8 (heuristic or LLM)
  takeProfit: number;   // R = r * rho
  commentary: string;
};

export type AgentContext = {
  candles: Candle[];
  indicator?: IndicatorOut;
  pattern?: PatternOut;
  trend?: TrendOut;
  risk?: RiskOut;
};