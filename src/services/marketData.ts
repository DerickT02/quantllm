/**
 * ──────────────────────────────────────────────────────────────────────────────
 * MARKET DATA SERVICE - REAL OHLCV DATA INTEGRATION
 * ──────────────────────────────────────────────────────────────────────────────
 */

import { Candle } from '../types.js';
import AlphaVantageService from './alphaVantage.js';

export interface MarketDataOptions {
  symbol: string;
  interval?: 'daily' | '1min' | '5min' | '15min' | '30min' | '60min';
  outputSize?: 'compact' | 'full';
  market?: string; // For crypto
}

export interface MarketInfo {
  symbol: string;
  name: string;
  type: 'stock' | 'crypto' | 'forex';
  exchange?: string;
  currency?: string;
}

export class MarketDataService {
  private alphaVantage: AlphaVantageService;

  constructor() {
    this.alphaVantage = new AlphaVantageService();
  }

  /**
   * Fetch OHLCV data for any symbol (stocks, crypto, etc.)
   */
  async getOHLCVData(options: MarketDataOptions): Promise<Candle[]> {
    const { symbol, interval = 'daily', outputSize = 'compact', market = 'USD' } = options;

    try {
      // Determine if it's a crypto symbol
      const isCrypto = this.isCryptoSymbol(symbol);
      
      if (isCrypto) {
        return await this.alphaVantage.getCryptoDailyOHLCV(symbol, market);
      }

      if (interval === 'daily') {
        return await this.alphaVantage.getDailyOHLCV(symbol, outputSize);
      } else {
        return await this.alphaVantage.getIntradayOHLCV(symbol, interval, outputSize);
      }
    } catch (error) {
      console.error(`Error fetching OHLCV data for ${symbol}:`, error);
      throw error;
    }
  }

  /**
   * Get current market quote
   */
  async getCurrentQuote(symbol: string): Promise<any> {
    try {
      return await this.alphaVantage.getQuote(symbol);
    } catch (error) {
      console.error(`Error fetching quote for ${symbol}:`, error);
      throw error;
    }
  }

  /**
   * Search for symbols
   */
  async searchSymbols(keywords: string): Promise<MarketInfo[]> {
    try {
      const results = await this.alphaVantage.searchSymbols(keywords);
      
      return results.map((result: any): MarketInfo => {
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
      'BTC', 'ETH', 'ETC', 'LTC', 'XRP', 'ADA', 'DOT', 'DOGE', 'MATIC', 'SOL', 'AVAX',
      'BITCOIN', 'ETHEREUM', 'LITECOIN', 'RIPPLE', 'CARDANO', 'POLKADOT',
      'USDT', 'USDC', 'BNB', 'LUNA', 'ATOM', 'LINK', 'UNI', 'ALGO'
    ];
    
    return cryptoSymbols.includes(symbol.toUpperCase());
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