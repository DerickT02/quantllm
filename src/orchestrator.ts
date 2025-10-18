/**
 * ──────────────────────────────────────────────────────────────────────────────
 * QUANTLLM ORCHESTRATOR
 * ──────────────────────────────────────────────────────────────────────────────
 * Main pipeline that coordinates all agents and generates market narratives
 */

import { Candle, AgentContext } from './types.js';
import { runGraphPipeline } from './graph/analysisGraph.js';
import MarketDataService from './services/marketData.js';

const marketDataService = new MarketDataService();

/**
 * Run the complete QuantLLM pipeline
 * @param candles - Array of OHLCV candles
 * @returns Analysis context and narrative
 */
export async function runPipeline(candles: Candle[]) {
  // Use the LangGraph-style pipeline by default
  return runGraphPipeline(candles);

  // Legacy sequential path retained below (unreachable unless refactored)
  // const ctx: AgentContext = { candles };
  // ctx.indicator = await IndicatorAgent(ctx);
  // ctx.pattern   = await PatternAgent(ctx);
  // ctx.trend     = await TrendAgent(ctx);
  // ctx.risk      = await RiskAgent(ctx);
  // const narrative = generateNarrative(ctx);
  // const { visuals, signals } = computeVisualsAndSignals(candles);
  // return { ctx, narrative, visuals, signals };
}

/**
 * Generate a human-readable market story
 * @param ctx - Complete agent context
 * @returns Formatted narrative string
 */
function generateNarrative(ctx: AgentContext): string {
  if (!ctx.indicator || !ctx.pattern || !ctx.trend || !ctx.risk) {
    return 'Incomplete analysis - missing agent outputs';
  }

  const last = ctx.candles.at(-1);
  if (!last) return 'No candle data available';

  // Emoji indicators
  const dirEmoji =
    ctx.indicator.regime === 'Bullish' ? '📈' :
    ctx.indicator.regime === 'Bearish' ? '📉' : '➖';

  // Build narrative sections
  const timestamp = `Time: ${new Date(last.time * 1000).toISOString()}`;
  
  const indicatorLine = 
    `${dirEmoji} Indicator: RSI=${ctx.indicator.rsi?.toFixed(1)} ` +
    `(${ctx.indicator.regime}${ctx.indicator.overbought ? ', Overbought' : ''}${ctx.indicator.oversold ? ', Oversold' : ''}); ` +
    `confidence=${ctx.indicator.confidence.toFixed(2)}`;
  
  const patternLine = 
    `🕯️ Pattern: ${ctx.pattern.pattern} (strength=${ctx.pattern.strength.toFixed(2)})`;
  
  const trendLine = 
    `📊 Trend: ${ctx.trend.trend} (EMA12=${ctx.trend.emaFast.toFixed(5)}, EMA26=${ctx.trend.emaSlow.toFixed(5)}, strength=${ctx.trend.strength.toFixed(2)})`;
  
  const riskLine = 
    `🛡️ Risk: ρ=${ctx.risk.rho.toFixed(5)}, r=${ctx.risk.rMultiplier.toFixed(2)} ⇒ take-profit R=${ctx.risk.takeProfit.toFixed(5)} (${ctx.risk.commentary})`;

  return [timestamp, indicatorLine, patternLine, trendLine, riskLine].join('\n');
}

/**
 * Generate JSON output for API responses
 * @param candles - Array of OHLCV candles
 * @returns Complete analysis in JSON format
 */
export async function runAnalysis(candles: Candle[]) {
  const { ctx } = await runPipeline(candles);
  
  return {
    timestamp: new Date().toISOString(),
    indicator: ctx.indicator,
    pattern: ctx.pattern,
    trend: ctx.trend,
    risk: ctx.risk,
    summary: {
      bullishSignals: countBullishSignals(ctx),
      bearishSignals: countBearishSignals(ctx),
      overallSentiment: getOverallSentiment(ctx)
    }
  };
}

/**
 * Count bullish signals across all agents
 */
function countBullishSignals(ctx: AgentContext): number {
  let count = 0;
  if (ctx.indicator?.regime === 'Bullish') count++;
  if (ctx.pattern?.pattern === 'BullishEngulfing') count++;
  if (ctx.trend?.trend === 'Uptrend') count++;
  return count;
}

/**
 * Count bearish signals across all agents
 */
function countBearishSignals(ctx: AgentContext): number {
  let count = 0;
  if (ctx.indicator?.regime === 'Bearish') count++;
  if (ctx.pattern?.pattern === 'BearishEngulfing') count++;
  if (ctx.trend?.trend === 'Downtrend') count++;
  return count;
}

/**
 * Determine overall market sentiment
 */
function getOverallSentiment(ctx: AgentContext): 'Bullish' | 'Bearish' | 'Neutral' {
  const bullish = countBullishSignals(ctx);
  const bearish = countBearishSignals(ctx);
  
  if (bullish > bearish) return 'Bullish';
  if (bearish > bullish) return 'Bearish';
  return 'Neutral';
}

/**
 * Run analysis on real market data for a given symbol
 * @param symbol - Stock/crypto symbol (e.g., 'AAPL', 'BTC')
 * @param interval - Time interval for data
 * @param periods - Number of periods to analyze
 * @returns Complete analysis with real market data
 */
export async function runRealTimeAnalysis(
  symbol: string,
  interval: 'daily' | '1min' | '5min' | '15min' | '30min' | '60min' = 'daily',
  periods: number = 100
) {
  try {
    // Fetch real market data
    const candles = await marketDataService.getOHLCVWithPeriods(symbol, periods, interval);
    
    if (candles.length === 0) {
      throw new Error(`No market data found for symbol: ${symbol}`);
    }

    // Run the complete analysis pipeline
  const { ctx, narrative, visuals, signals } = await runPipeline(candles) as any;
    
    // Get market summary
    const marketSummary = marketDataService.getMarketSummary(candles);
    marketSummary.symbol = symbol.toUpperCase();
    
    // Format OHLCV data for display
    const formattedData = marketDataService.formatOHLCVData(candles.slice(-10)); // Last 10 periods
    
    return {
      symbol: symbol.toUpperCase(),
      interval,
      periods,
      timestamp: new Date().toISOString(),
      marketSummary,
      analysis: ctx,
      narrative,
      visuals,
      signals,
      recentData: formattedData,
      dataPoints: candles.length
    };
  } catch (error) {
    console.error(`Error in real-time analysis for ${symbol}:`, error);
    throw error;
  }
}

/**
 * Get market data for a symbol without analysis
 * @param symbol - Stock/crypto symbol
 * @param interval - Time interval
 * @param periods - Number of periods
 * @returns Raw market data and summary
 */
export async function getMarketData(
  symbol: string,
  interval: 'daily' | '1min' | '5min' | '15min' | '30min' | '60min' = 'daily',
  periods: number = 100
) {
  try {
    const candles = await marketDataService.getOHLCVWithPeriods(symbol, periods, interval);
    
    if (candles.length === 0) {
      throw new Error(`No market data found for symbol: ${symbol}`);
    }

    const marketSummary = marketDataService.getMarketSummary(candles);
    marketSummary.symbol = symbol.toUpperCase();
    
    const formattedData = marketDataService.formatOHLCVData(candles);
    
    return {
      symbol: symbol.toUpperCase(),
      interval,
      periods,
      timestamp: new Date().toISOString(),
      marketSummary,
      data: formattedData,
      dataPoints: candles.length
    };
  } catch (error) {
    console.error(`Error fetching market data for ${symbol}:`, error);
    throw error;
  }
}

/**
 * Search for available symbols
 * @param keywords - Search keywords
 * @returns List of matching symbols
 */
export async function searchMarketSymbols(keywords: string) {
  try {
    return await marketDataService.searchSymbols(keywords);
  } catch (error) {
    console.error(`Error searching symbols for ${keywords}:`, error);
    throw error;
  }
}

/**
 * Get popular symbols by category
 * @param category - Market category
 * @returns List of popular symbols
 */
export function getPopularSymbols(category: 'stocks' | 'crypto' | 'forex' = 'stocks') {
  return marketDataService.getPopularSymbols(category);
}

/**
 * Validate if a symbol exists
 * @param symbol - Symbol to validate
 * @returns Symbol information or null
 */
export async function validateSymbol(symbol: string) {
  try {
    return await marketDataService.validateSymbol(symbol);
  } catch (error) {
    console.error(`Error validating symbol ${symbol}:`, error);
    return null;
  }
}