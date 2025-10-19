/**
 * ──────────────────────────────────────────────────────────────────────────────
 * BINANCE DATA SERVICE
 * ──────────────────────────────────────────────────────────────────────────────
 * Connects to the public Binance API for market data.
 */

import axios from "axios";
import { Candle } from "../types.js";

const BINANCE_API_URL = "https://api.binance.com/api/v3";

export class BinanceService {
  /**
   * Fetches k-line (OHLCV) data from Binance.
   * @param symbol - The trading symbol (e.g., 'BTCUSDT').
   * @param interval - The k-line interval (e.g., '15m', '1h', '1d').
   * @param limit - The number of candles to retrieve (max 1000).
   * @returns A promise that resolves to an array of Candle objects.
   */
  async getKlines(
    symbol: string,
    interval: string,
    limit: number = 200
  ): Promise<Candle[]> {
    try {
      const response = await axios.get(`${BINANCE_API_URL}/klines`, {
        params: {
          symbol,
          interval,
          limit,
        },
      });

      // Binance returns an array of arrays. We need to map it to our Candle object structure.
      const candles: Candle[] = response.data.map((k: any) => ({
        time: Math.floor(k[0] / 1000), // Convert ms to seconds
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5]),
      }));

      return candles;
    } catch (error) {
      console.error(`Binance API error fetching klines for ${symbol}:`, error);
      throw new Error("Failed to fetch data from Binance API.");
    }
  }
}

export default BinanceService;
