/**
 * ──────────────────────────────────────────────────────────────────────────────
 * MARKET DATA SERVICE - REAL OHLCV DATA INTEGRATION
 * ──────────────────────────────────────────────────────────────────────────────
 */

import { Candle } from "../types.js";
import AlphaVantageService from "./alphaVantage.js";
import PolygonService from "./polygon.js";
import CoinGeckoService from "./coingecko.js";

export interface MarketDataOptions {
  symbol: string;
  interval?: "daily" | "1min" | "5min" | "15min" | "30min" | "60min";
  outputSize?: "compact" | "full";
  market?: string; // For crypto
}

export interface MarketInfo {
  symbol: string;
  name: string;
  type: "stock" | "crypto" | "forex";
  exchange?: string;
  currency?: string;
}

export class MarketDataService {
  private alphaVantage: AlphaVantageService;
  private polygon: PolygonService;
  private coingecko: CoinGeckoService;
  private cache = new Map<string, { data: any; timestamp: number }>();
  private cacheTTL = 60 * 60 * 1000; // 60 minutes

  constructor() {
    this.alphaVantage = new AlphaVantageService();
    this.polygon = new PolygonService();
    this.coingecko = new CoinGeckoService();
  }

  /**
   * Fetch OHLCV data for any symbol (stocks, crypto, etc.)
   */
  async getOHLCVData(options: MarketDataOptions): Promise<Candle[]> {
    const {
      symbol,
      interval = "daily",
      outputSize = "compact",
      market = "USD",
    } = options;
  const cacheKey = `ohlcv:${symbol}-${interval}-${outputSize}-${market}`;

    // Check cache first
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      console.log(`[Cache] HIT for ${cacheKey}`);
      return cached.data;
    }
    console.log(`[Cache] MISS for ${cacheKey}`);

    try {
      // Prefer Polygon.io for crypto symbols
      if (this.isCryptoSymbol(symbol)) {
        const needsIntraday = interval !== "daily";
        try {
          if (!process.env.POLYGON_API_KEY) {
            console.warn("POLYGON_API_KEY not set; skipping Polygon.io fetch.");
            if (needsIntraday) {
              // Do not silently fall back to daily provider for intraday crypto
              throw new Error(
                "Polygon.io API key is required for intraday crypto intervals."
              );
            }
          } else {
            console.log(`Attempting to fetch ${symbol} from Polygon.io...`);
            const { multiplier, timespan } = this.mapIntervalToPolygon(interval);
            const { from, to } = this.getRangeFor(interval, outputSize);
            console.log(`[DEBUG] Requesting Polygon data from ${from} to ${to} (today should be ${new Date().toISOString().split('T')[0]})`);
            const data = await this.polygon.getAggregates(
              symbol,
              multiplier,
              timespan,
              from,
              to
            );
            if (data && data.length) {
              // Normalize order: ascending by time
              data.sort((a, b) => a.time - b.time);
              const firstDate = new Date(data[0].time * 1000).toISOString();
              const lastDate = new Date(data[data.length - 1].time * 1000).toISOString();
              
              // Check if data is recent (within last 12 hours for intraday)
              const latestDataTime = data[data.length - 1].time * 1000;
              const now = Date.now();
              const freshnessThreshold = needsIntraday 
                ? 12 * 60 * 60 * 1000  // 12 hours for intraday
                : 2 * 24 * 60 * 60 * 1000; // 2 days for daily
              
              if (latestDataTime < (now - freshnessThreshold)) {
                console.warn(
                  `⚠️  Polygon.io data for ${symbol} is STALE (latest: ${lastDate}, today: ${new Date().toISOString()}). Trying CoinGecko instead...`
                );
                
                // Try CoinGecko for fresh data
                try {
                  const days = this.coingecko.getDaysForInterval(interval, outputSize === 'full' ? 365 : 90);
                  const coinGeckoData = await this.coingecko.getOHLC(symbol, days);
                  
                  if (coinGeckoData && coinGeckoData.length > 0) {
                    coinGeckoData.sort((a, b) => a.time - b.time);
                    const cgFirstDate = new Date(coinGeckoData[0].time * 1000).toISOString();
                    const cgLastDate = new Date(coinGeckoData[coinGeckoData.length - 1].time * 1000).toISOString();
                    console.log(`✅ CoinGecko provided fresh data: ${cgFirstDate} to ${cgLastDate}`);
                    this.cache.set(cacheKey, { data: coinGeckoData, timestamp: Date.now() });
                    return coinGeckoData;
                  }
                } catch (cgError) {
                  console.warn(`CoinGecko also failed for ${symbol}:`, cgError);
                }
                
                if (needsIntraday) {
                  throw new Error(
                    `All data sources have stale data for ${symbol} (latest: ${lastDate}). Intraday crypto data unavailable.`
                  );
                }
                // Fall through to Alpha Vantage for daily data
              } else {
                console.log(
                  `Successfully fetched ${data.length} candles from Polygon.io. Range: ${firstDate} to ${lastDate}`
                );
                this.cache.set(cacheKey, { data, timestamp: Date.now() });
                return data;
              }
            }
            console.warn(
              `Polygon.io returned no data for ${symbol} (${interval}).${needsIntraday ? ' Not falling back for intraday crypto.' : ' Falling back.'}`
            );
            if (needsIntraday) {
              throw new Error(
                `No intraday data from Polygon.io for ${symbol} and interval ${interval}.`
              );
            }
          }
        } catch (polyError) {
          if (needsIntraday) {
            console.error(
              `Polygon.io fetch failed for ${symbol} (${interval}). Intraday crypto requires Polygon.`,
              polyError
            );
            throw polyError;
          } else {
            console.warn(
              `Polygon.io fetch failed for ${symbol}. Falling back to Alpha Vantage daily.`,
              polyError
            );
          }
        }
      }

      // Fallback to Alpha Vantage (crypto or stocks)
      console.log(`Fetching ${symbol} from Alpha Vantage...`);
      const isCrypto = this.isCryptoSymbol(symbol);

      let data: Candle[];
      if (isCrypto) {
        data = await this.alphaVantage.getCryptoDailyOHLCV(symbol, market);
      } else if (interval === "daily") {
        data = await this.alphaVantage.getDailyOHLCV(symbol, outputSize);
      } else {
        data = await this.alphaVantage.getIntradayOHLCV(symbol, interval, outputSize);
      }

      // Normalize order: ascending by time
      if (data && data.length) {
        data.sort((a, b) => a.time - b.time);
      }
      // Store in cache
      this.cache.set(cacheKey, { data, timestamp: Date.now() });
      return data;
    } catch (error) {
      console.error(`Error fetching OHLCV data for ${symbol}:`, error);
      throw error;
    }
  }

  /**
   * Get current market quote
   */
  async getCurrentQuote(symbol: string): Promise<any> {
    const cacheKey = `quote:${symbol}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      console.log(`[Cache] HIT for ${cacheKey}`);
      return cached.data;
    }
    console.log(`[Cache] MISS for ${cacheKey}`);

    try {
      const data = await this.alphaVantage.getQuote(symbol);
      this.cache.set(cacheKey, { data, timestamp: Date.now() });
      return data;
    } catch (error) {
      console.error(`Error fetching quote for ${symbol}:`, error);
      throw error;
    }
  }

  /**
   * Search for symbols
   */
  async searchSymbols(keywords: string): Promise<MarketInfo[]> {
    const cacheKey = `search:${keywords}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      console.log(`[Cache] HIT for ${cacheKey}`);
      return cached.data;
    }
    console.log(`[Cache] MISS for ${cacheKey}`);

    try {
      const results = await this.alphaVantage.searchSymbols(keywords);
      
      const mappedResults = results.map((result: any): MarketInfo => {
        const type = result['3. type']?.toLowerCase();
        let marketType: 'stock' | 'crypto' | 'forex' = 'stock';
        
        if (type === 'cryptocurrency') {
          marketType = 'crypto';
        } else if (type === 'physical currency') {
          marketType = 'forex';
        }

        return {
          symbol: result['1. symbol'],
          name: result['2. name'],
          type: marketType,
          exchange: result['4. region'],
          currency: result['8. currency'],
        };
      });

      this.cache.set(cacheKey, { data: mappedResults, timestamp: Date.now() });
      return mappedResults;

    } catch (error) {
      console.error(`Error searching symbols for ${keywords}:`, error);
      throw error;
    }
  }

  /**
   * Get OHLCV data with specified number of periods
   */
  async getOHLCVWithPeriods(
    symbol: string, 
    periods: number = 100, 
    interval: 'daily' | '1min' | '5min' | '15min' | '30min' | '60min' = 'daily'
  ): Promise<Candle[]> {
    try {
      const data = await this.getOHLCVData({ 
        symbol, 
        interval, 
        outputSize: periods > 100 ? 'full' : 'compact'
      });
      
      // Return the last N periods
      return data.slice(-periods);
    } catch (error) {
      console.error(`Error fetching ${periods} periods for ${symbol}:`, error);
      throw error;
    }
  }

  /**
   * Validate if symbol exists and get basic info
   */
  async validateSymbol(symbol: string): Promise<MarketInfo | null> {
    try {
      // Try to get a quote first
      const quote = await this.getCurrentQuote(symbol);
      
      if (quote && Object.keys(quote).length > 0) {
        return {
          symbol: symbol.toUpperCase(),
          name: quote['01. symbol'] || symbol,
          type: this.isCryptoSymbol(symbol) ? 'crypto' : 'stock',
        };
      }

      // If quote fails, try searching
      const searchResults = await this.searchSymbols(symbol);
      return searchResults.find(result => 
        result.symbol.toUpperCase() === symbol.toUpperCase()
      ) || null;
    } catch (error) {
      console.error(`Error validating symbol ${symbol}:`, error);
      return null;
    }
  }

  /**
   * Get popular symbols by category
   */
  getPopularSymbols(category: 'stocks' | 'crypto' | 'forex' = 'stocks'): string[] {
    switch (category) {
      case 'stocks':
        return ['AAPL', 'GOOGL', 'MSFT', 'AMZN', 'TSLA', 'NVDA', 'META', 'NFLX', 'AMD', 'INTC'];
      case 'crypto':
        return ['BTC', 'ETH', 'ADA', 'DOT', 'LTC', 'XRP', 'DOGE', 'MATIC', 'SOL', 'AVAX'];
      case 'forex':
        return ['EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD', 'CNY'];
      default:
        return ['AAPL', 'GOOGL', 'MSFT'];
    }
  }

  /**
   * Check if symbol is likely a cryptocurrency
   */
  private isCryptoSymbol(symbol: string): boolean {
    const cryptoSymbols = [
      "BTC",
      "ETH",
      "ETC",
      "LTC",
      "XRP",
      "ADA",
      "DOT",
      "DOGE",
      "MATIC",
      "SOL",
      "AVAX",
      "BITCOIN",
      "ETHEREUM",
      "LITECOIN",
      "RIPPLE",
      "CARDANO",
      "POLKADOT",
      "USDT",
      "USDC",
      "BNB",
      "LUNA",
      "ATOM",
      "LINK",
      "UNI",
      "ALGO",
    ];

    return cryptoSymbols.includes(symbol.toUpperCase());
  }

  private mapIntervalToPolygon(
    interval: "daily" | "1min" | "5min" | "15min" | "30min" | "60min"
  ): { multiplier: number; timespan: "minute" | "day" } {
    switch (interval) {
      case "daily":
        return { multiplier: 1, timespan: "day" };
      case "60min":
        return { multiplier: 60, timespan: "minute" };
      case "30min":
        return { multiplier: 30, timespan: "minute" };
      case "15min":
        return { multiplier: 15, timespan: "minute" };
      case "5min":
        return { multiplier: 5, timespan: "minute" };
      case "1min":
        return { multiplier: 1, timespan: "minute" };
      default:
        return { multiplier: 15, timespan: "minute" };
    }
  }

  private getRangeFor(
    interval: "daily" | "1min" | "5min" | "15min" | "30min" | "60min",
    outputSize: "compact" | "full"
  ): { from: string; to: string } {
    const now = new Date();
    const days = (() => {
      if (interval === "daily") return outputSize === "full" ? 720 : 180; // ~2 years or 6 months
      // minute intervals: choose enough days to cover typical compact/full
      return outputSize === "full" ? 30 : 7; // 30 days or 7 days
    })();
    const fromMs = now.getTime() - days * 24 * 60 * 60 * 1000;
    if (interval === "daily") {
      // Polygon accepts simple dates for daily bars
      const to = this.formatDate(now);
      const from = this.formatDate(new Date(fromMs));
      return { from, to };
    }
    // For minute bars, also use YYYY-MM-DD format
    const to = this.formatDate(now);
    const from = this.formatDate(new Date(fromMs));
    return { from, to };
  }

  private formatDate(d: Date): string {
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  /**
   * Format OHLCV data for display
   */
  formatOHLCVData(candles: Candle[]): any[] {
    return candles.map(candle => ({
      date: new Date(candle.time * 1000).toISOString().split('T')[0],
      time: candle.time,
      open: candle.open.toFixed(4),
      high: candle.high.toFixed(4),
      low: candle.low.toFixed(4),
      close: candle.close.toFixed(4),
      volume: candle.volume ? candle.volume.toLocaleString() : 'N/A',
      change: candles.indexOf(candle) > 0 
        ? ((candle.close - candles[candles.indexOf(candle) - 1].close) / candles[candles.indexOf(candle) - 1].close * 100).toFixed(2) + '%'
        : '0.00%'
    }));
  }

  /**
   * Get market summary statistics
   */
  getMarketSummary(candles: Candle[]): any {
    if (candles.length === 0) return null;

    const latest = candles[candles.length - 1];
    const previous = candles.length > 1 ? candles[candles.length - 2] : latest;
    
    const high52w = Math.max(...candles.slice(-252).map(c => c.high));
    const low52w = Math.min(...candles.slice(-252).map(c => c.low));
    
    const volumes = candles.filter(c => c.volume).map(c => c.volume!);
    const avgVolume = volumes.length > 0 ? volumes.reduce((a, b) => a + b, 0) / volumes.length : 0;

    return {
      symbol: 'N/A', // Will be set by caller
      currentPrice: latest.close,
      change: latest.close - previous.close,
      changePercent: ((latest.close - previous.close) / previous.close * 100),
      volume: latest.volume || 0,
      avgVolume: Math.round(avgVolume),
      high52w,
      low52w,
      marketCap: 'N/A', // Would need additional API call
      lastUpdate: new Date(latest.time * 1000).toISOString(),
    };
  }
}

export default MarketDataService;