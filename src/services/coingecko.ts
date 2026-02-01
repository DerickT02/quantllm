/**
 * ──────────────────────────────────────────────────────────────────────────────
 * COINGECKO SERVICE
 * ──────────────────────────────────────────────────────────────────────────────
 * Service for fetching crypto market data from CoinGecko API
 */

import axios from 'axios';
import { Candle } from '../types.js';

const COINGECKO_API_URL = 'https://api.coingecko.com/api/v3';

/**
 * CoinGecko API Service
 * Provides real-time and historical cryptocurrency data
 */
export default class CoinGeckoService {
  private apiKey: string | undefined;

  constructor() {
    this.apiKey = process.env.COINGECKO_API_KEY; // Optional - works without API key
  }

  /**
   * Map symbol to CoinGecko coin ID
   */
  private getCoinId(symbol: string): string {
    const mapping: Record<string, string> = {
      'BTC': 'bitcoin',
      'ETH': 'ethereum',
      'ETC': 'ethereum-classic',
      'LTC': 'litecoin',
      'XRP': 'ripple',
      'ADA': 'cardano',
      'DOT': 'polkadot',
      'DOGE': 'dogecoin',
      'MATIC': 'matic-network',
      'SOL': 'solana',
      'AVAX': 'avalanche-2',
      'USDT': 'tether',
      'USDC': 'usd-coin',
    };
    return mapping[symbol.toUpperCase()] || symbol.toLowerCase();
  }

  /**
   * Get OHLC data (candles) from CoinGecko
   * @param symbol - Crypto symbol (e.g., 'BTC', 'ETH')
   * @param days - Number of days of data (1, 7, 14, 30, 90, 180, 365, max)
   * @returns Array of Candle objects
   */
  async getOHLC(symbol: string, days: number = 7): Promise<Candle[]> {
    const coinId = this.getCoinId(symbol);
    
    try {
      const params: any = {
        vs_currency: 'usd',
        days: days.toString(),
      };

      if (this.apiKey) {
        params.x_cg_demo_api_key = this.apiKey;
      }

      // CoinGecko OHLC endpoint returns data in intervals based on days:
      // 1 day = 30 min intervals
      // 7-90 days = 4 hour intervals  
      // 91+ days = 4 day intervals
      const response = await axios.get(
        `${COINGECKO_API_URL}/coins/${coinId}/ohlc`,
        { params }
      );

      if (!response.data || !Array.isArray(response.data)) {
        console.warn(`CoinGecko returned no OHLC data for ${symbol}`);
        return [];
      }

      // CoinGecko OHLC format: [timestamp_ms, open, high, low, close]
      const candles: Candle[] = response.data.map((ohlc: number[]) => ({
        time: Math.floor(ohlc[0] / 1000), // Convert ms to seconds
        open: ohlc[1],
        high: ohlc[2],
        low: ohlc[3],
        close: ohlc[4],
        volume: 0, // OHLC endpoint doesn't provide volume
      }));

      console.log(`[CoinGecko] Fetched ${candles.length} candles for ${symbol} (${days} days)`);
      if (candles.length > 0) {
        const firstDate = new Date(candles[0].time * 1000).toISOString();
        const lastDate = new Date(candles[candles.length - 1].time * 1000).toISOString();
        console.log(`[CoinGecko] Data range: ${firstDate} to ${lastDate}`);
      }

      return candles;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(`CoinGecko API error for ${symbol}:`, error.response?.data || error.message);
      } else {
        console.error(`CoinGecko error for ${symbol}:`, error);
      }
      throw new Error(`Failed to fetch OHLC data from CoinGecko for ${symbol}`);
    }
  }

  /**
   * Get current market data for a coin
   */
  async getCurrentPrice(symbol: string): Promise<{
    price: number;
    volume24h: number;
    change24h: number;
    high24h: number;
    low24h: number;
    marketCap: number;
  }> {
    const coinId = this.getCoinId(symbol);
    
    try {
      const params: any = {
        localization: false,
        tickers: false,
        community_data: false,
        developer_data: false,
        sparkline: false,
      };

      if (this.apiKey) {
        params.x_cg_demo_api_key = this.apiKey;
      }

      const response = await axios.get(
        `${COINGECKO_API_URL}/coins/${coinId}`,
        { params }
      );

      const data = response.data.market_data;
      
      return {
        price: data.current_price.usd,
        volume24h: data.total_volume.usd,
        change24h: data.price_change_percentage_24h,
        high24h: data.high_24h.usd,
        low24h: data.low_24h.usd,
        marketCap: data.market_cap.usd,
      };
    } catch (error) {
      console.error(`CoinGecko price error for ${symbol}:`, error);
      throw new Error(`Failed to fetch current price from CoinGecko for ${symbol}`);
    }
  }

  /**
   * Map days to appropriate interval for different time periods
   */
  getDaysForInterval(interval: string, periods: number): number {
    // CoinGecko provides different granularities based on days parameter:
    // 1 day = 30-minute intervals (48 data points)
    // 7-90 days = 4-hour intervals  
    // 91+ days = 4-day intervals
    
    switch (interval) {
      case '1min':
      case '5min':
      case '15min':
      case '30min':
        // For intraday, use 1 day (gives 30-min intervals)
        return 1;
      case '60min':
        // For hourly, use 7 days (gives 4-hour intervals, closest match)
        return 7;
      case 'daily':
      default:
        // For daily, calculate days needed
        const daysNeeded = Math.ceil(periods / 1); // 1 data point per day with max days
        return Math.min(daysNeeded, 365); // CoinGecko max is 365 days
    }
  }
}
