/**
 * ──────────────────────────────────────────────────────────────────────────────
 * POLYGON.IO DATA SERVICE
 * ──────────────────────────────────────────────────────────────────────────────
 * Connects to the Polygon.io API for market data.
 */

import axios from "axios";
import { Candle } from "../types.js";

const POLYGON_API_URL = "https://api.polygon.io";

export class PolygonService {
  private apiKey: string;

  constructor() {
    this.apiKey = process.env.POLYGON_API_KEY || "";
    if (!this.apiKey) {
      console.warn(
        "Polygon.io API key not found. Polygon service will be unavailable."
      );
    }
  }

  /**
   * Fetches aggregates (OHLCV) data from Polygon.io.
   * @param symbol - The trading symbol (e.g., 'BTC', 'AAPL').
   * @param interval - The timespan interval (e.g., 'minute', 'hour', 'day').
   * @param timespan - The multiplier for the interval (e.g., 15).
   * @param from - The start date (YYYY-MM-DD).
   * @param to - The end date (YYYY-MM-DD).
   * @returns A promise that resolves to an array of Candle objects.
   */
  async getAggregates(
    symbol: string,
    multiplier: number,
    timespan: string,
    from: string, // can be YYYY-MM-DD or epoch ms as string
    to: string    // can be YYYY-MM-DD or epoch ms as string
  ): Promise<Candle[]> {
    if (!this.apiKey) {
      throw new Error("Polygon.io API key is not configured.");
    }

    // Polygon uses a different ticker format for crypto, e.g., X:BTCUSD
    const ticker = `X:${symbol.toUpperCase()}USD`;

    const url = `${POLYGON_API_URL}/v2/aggs/ticker/${ticker}/range/${multiplier}/${timespan}/${from}/${to}`;
    console.log(`[POLYGON] Requesting: ${url}`);
    console.log(`[POLYGON] Date range: ${from} to ${to} (today should be around ${new Date().toISOString().split('T')[0]})`);

    try {
      const response = await axios.get(
        url,
        {
          params: {
            apiKey: this.apiKey,
            sort: "asc",
            limit: 5000, // Max limit
          },
        }
      );

      if (response.data.resultsCount === 0) {
        return [];
      }

      // Map Polygon.io response to our Candle object structure.
      const candles: Candle[] = response.data.results.map((r: any) => ({
        time: Math.floor(r.t / 1000), // Convert ms to seconds
        open: r.o,
        high: r.h,
        low: r.l,
        close: r.c,
        volume: r.v,
      }));

      if (candles.length > 0) {
        const firstDate = new Date(candles[0].time * 1000).toISOString();
        const lastDate = new Date(candles[candles.length - 1].time * 1000).toISOString();
        console.log(`[POLYGON] Received ${candles.length} candles. Data range: ${firstDate} to ${lastDate}`);
      }

      return candles;
    } catch (error) {
      console.error(
        `Polygon.io API error fetching aggregates for ${symbol}:`,
        error
      );
      throw new Error("Failed to fetch data from Polygon.io API.");
    }
  }
}

export default PolygonService;
