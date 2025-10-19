/**
 * ──────────────────────────────────────────────────────────────────────────────
 * QUANTLLM WEB SERVER
 * ──────────────────────────────────────────────────────────────────────────────
 * Express server providing web interface for QuantLLM analysis
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { runPipeline, runAnalysis, runRealTimeAnalysis, getMarketData, searchMarketSymbols, getPopularSymbols, validateSymbol } from './src/orchestrator.js';
import { makeSyntheticSeries } from './src/utils/synthetic.js';
import { runIndicatorAgent, runPatternAgent, runTrendAgent, runRiskAgent } from './src/agents/index.js';
import { externalHealth, externalRun, isExternalEnabled } from './src/services/externalAgents.js';
// Chat feature removed for presentation-only build

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// In-memory cache for analysis results
const analysisCache = new Map<string, { data: any; timestamp: number }>();
const ANALYSIS_CACHE_TTL = 15 * 60 * 1000; // 15 minutes

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// Store latest analysis for dashboard
let latestAnalysis: any = null;
let isAnalyzing = false;

// Presentation: focus on BTC and ETH only
const PRESENTATION_ASSETS = ['BTC', 'ETH'] as const;
type PresentationAsset = typeof PRESENTATION_ASSETS[number];


/**
 * Generate fresh analysis data
 */
async function generateAnalysis() {
  if (isAnalyzing) return latestAnalysis;
  
  isAnalyzing = true;
  try {
    const candles = makeSyntheticSeries(120, 1.0000);
  const pipelineResult: any = await runPipeline(candles);
  const ctx = pipelineResult.ctx;
  const narrative = pipelineResult.narrative;
  const visuals = pipelineResult.visuals;
  const signals = pipelineResult.signals;
  const jsonOutput = await runAnalysis(candles);
    
    latestAnalysis = {
      timestamp: new Date().toISOString(),
      narrative,
      data: {
        indicator: ctx.indicator,
        pattern: ctx.pattern,
        trend: ctx.trend,
        risk: ctx.risk,
        summary: jsonOutput.summary,
        visuals,
        signals
      },
      candles: candles.slice(-20) // Last 20 candles for chart
    };
    
    return latestAnalysis;
  } finally {
    isAnalyzing = false;
  }
}

// Routes
app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

app.get('/api/analysis', async (req, res) => {
  try {
    const analysis = await generateAnalysis();
    res.json(analysis);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to generate analysis', details: errorMessage });
  }
});

app.get('/api/analysis/fresh', async (req, res) => {
  try {
    latestAnalysis = null; // Force fresh analysis
    const analysis = await generateAnalysis();
    res.json(analysis);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to generate fresh analysis', details: errorMessage });
  }
});

app.get('/api/agents/:agent', async (req, res) => {
  try {
    const { agent } = req.params;
    const candles = makeSyntheticSeries(100, 1.0000);
    
    let result;
    switch (agent) {
      case 'indicator':
        result = await runIndicatorAgent(candles);
        break;
      case 'pattern':
        result = await runPatternAgent(candles);
        break;
      case 'trend':
        result = await runTrendAgent(candles);
        break;
      case 'risk':
        const indicator = await runIndicatorAgent(candles);
        const pattern = await runPatternAgent(candles);
        const trend = await runTrendAgent(candles);
        result = await runRiskAgent(indicator, pattern, trend);
        break;
      default:
        return res.status(404).json({ error: 'Agent not found' });
    }
    
    res.json({
      agent,
      timestamp: new Date().toISOString(),
      result,
      candles: candles.slice(-10) // Last 10 candles
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Failed to run ${req.params.agent} agent`, details: errorMessage });
  }
});

// External agents (Derik's) test endpoints
app.get('/api/external/health', async (req, res) => {
  if (!isExternalEnabled()) return res.status(404).json({ error: 'External agents disabled' });
  const result = await externalHealth();
  if (result.ok) return res.json(result.data);
  return res.status(502).json({ error: result.error });
});

app.get('/api/external/run', async (req, res) => {
  if (!isExternalEnabled()) return res.status(404).json({ error: 'External agents disabled' });
  const result = await externalRun();
  if (result.ok) return res.json(result.data);
  return res.status(502).json({ error: result.error });
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    agents: ['indicator', 'pattern', 'trend', 'risk'],
    chat: 'disabled',
    presentation: {
      assets: PRESENTATION_ASSETS,
      interval: 'daily'
    },
    pipeline: 'langgraph'
  });
});

// Presentation endpoints (BTC and ETC only)
app.get('/api/presentation/analysis', async (req, res) => {
  try {
    const interval = 'daily' as const;
    const periods = 120;
    const [btc, eth] = await Promise.all([
      runRealTimeAnalysis('BTC', interval, periods),
      runRealTimeAnalysis('ETH', interval, periods),
    ]);
    res.json({ assets: { BTC: btc, ETH: eth }, timestamp: new Date().toISOString() });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to fetch presentation analysis', details: errorMessage });
  }
});

app.get('/api/presentation/data', async (req, res) => {
  try {
    const interval = 'daily' as const;
    const periods = 120;
    const [btc, eth] = await Promise.all([
      getMarketData('BTC', interval, periods),
      getMarketData('ETH', interval, periods),
    ]);
    res.json({ assets: { BTC: btc, ETH: eth }, timestamp: new Date().toISOString() });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to fetch presentation data', details: errorMessage });
  }
});

// OHLCV Market Data API endpoints
app.get('/api/market/data/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { interval = 'daily', periods = '100' } = req.query;
    
    const periodsNum = parseInt(periods as string, 10);
    if (isNaN(periodsNum) || periodsNum <= 0) {
      return res.status(400).json({ error: 'Periods must be a positive number' });
    }

    const data = await getMarketData(symbol, interval as any, periodsNum);
    res.json(data);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ 
      error: 'Failed to fetch market data', 
      details: errorMessage,
      symbol: req.params.symbol 
    });
  }
});

app.get('/api/market/analysis/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    if (!PRESENTATION_ASSETS.includes(symbol as any)) {
      return res.status(404).json({ error: "Asset not supported" });
    }

    const useCache = req.query.useCache !== "false";
    const interval = (req.query.interval as any) || "15min";
    const periods = parseInt((req.query.periods as string) || "120");
    const cacheKey = `analysis:${symbol}:${interval}:${periods}`;

    if (useCache && analysisCache.has(cacheKey)) {
      const cached = analysisCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < ANALYSIS_CACHE_TTL) {
        console.log(`[Server Cache] HIT for ${cacheKey}`);
        return res.json(cached.data);
      }
    }
    console.log(`[Server Cache] MISS for ${cacheKey}`);

    const result = await runRealTimeAnalysis(symbol, interval, periods);

    analysisCache.set(cacheKey, {
      data: result,
      timestamp: Date.now(),
    });

    res.json(result);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error(`Error in /api/market/analysis/${req.params.symbol}:`, error);
    res
      .status(500)
      .json({ error: "Failed to get market analysis", details: errorMessage });
  }
});

// This endpoint is now deprecated in favor of the one above, but kept for compatibility
app.get("/api/presentation/analysis", async (req, res) => {
  try {
    const interval = 'daily' as const;
    const periods = 120;
    const [btc, eth] = await Promise.all([
      runRealTimeAnalysis('BTC', interval, periods),
      runRealTimeAnalysis('ETH', interval, periods),
    ]);
    res.json({ assets: { BTC: btc, ETH: eth }, timestamp: new Date().toISOString() });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to fetch presentation analysis', details: errorMessage });
  }
});

app.get('/api/presentation/data', async (req, res) => {
  try {
    const interval = 'daily' as const;
    const periods = 120;
    const [btc, eth] = await Promise.all([
      getMarketData('BTC', interval, periods),
      getMarketData('ETH', interval, periods),
    ]);
    res.json({ assets: { BTC: btc, ETH: eth }, timestamp: new Date().toISOString() });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to fetch presentation data', details: errorMessage });
  }
});

// OHLCV Market Data API endpoints
app.get('/api/market/data/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { interval = 'daily', periods = '100' } = req.query;
    
    const periodsNum = parseInt(periods as string, 10);
    if (isNaN(periodsNum) || periodsNum <= 0) {
      return res.status(400).json({ error: 'Periods must be a positive number' });
    }

    const data = await getMarketData(symbol, interval as any, periodsNum);
    res.json(data);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ 
      error: 'Failed to fetch market data', 
      details: errorMessage,
      symbol: req.params.symbol 
    });
  }
});

app.get('/api/market/analysis/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    if (!PRESENTATION_ASSETS.includes(symbol as any)) {
      return res.status(404).json({ error: "Asset not supported" });
    }

    const useCache = req.query.useCache !== "false";
    const interval = (req.query.interval as any) || "15min";
    const periods = parseInt((req.query.periods as string) || "120");
    const cacheKey = `analysis:${symbol}:${interval}:${periods}`;

    if (useCache && analysisCache.has(cacheKey)) {
      const cached = analysisCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < ANALYSIS_CACHE_TTL) {
        console.log(`[Server Cache] HIT for ${cacheKey}`);
        return res.json(cached.data);
      }
    }
    console.log(`[Server Cache] MISS for ${cacheKey}`);

  const result = await runRealTimeAnalysis(symbol, interval, periods);

    analysisCache.set(cacheKey, {
      data: result,
      timestamp: Date.now(),
    });

    res.json(result);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error(`Error in /api/market/analysis/${req.params.symbol}:`, error);
    res
      .status(500)
      .json({ error: "Failed to get market analysis", details: errorMessage });
  }
});

// This endpoint is now deprecated in favor of the one above, but kept for compatibility
app.get("/api/presentation/analysis", async (req, res) => {
  try {
    const interval = 'daily' as const;
    const periods = 120;
    const [btc, eth] = await Promise.all([
      runRealTimeAnalysis('BTC', interval, periods),
      runRealTimeAnalysis('ETH', interval, periods),
    ]);
    res.json({ assets: { BTC: btc, ETH: eth }, timestamp: new Date().toISOString() });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to fetch presentation analysis', details: errorMessage });
  }
});

app.get('/api/presentation/data', async (req, res) => {
  try {
    const interval = 'daily' as const;
    const periods = 120;
    const [btc, eth] = await Promise.all([
      getMarketData('BTC', interval, periods),
      getMarketData('ETH', interval, periods),
    ]);
    res.json({ assets: { BTC: btc, ETH: eth }, timestamp: new Date().toISOString() });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to fetch presentation data', details: errorMessage });
  }
});

// OHLCV Market Data API endpoints
app.get('/api/market/data/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { interval = 'daily', periods = '100' } = req.query;
    
    const periodsNum = parseInt(periods as string, 10);
    if (isNaN(periodsNum) || periodsNum <= 0) {
      return res.status(400).json({ error: 'Periods must be a positive number' });
    }

    const data = await getMarketData(symbol, interval as any, periodsNum);
    res.json(data);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ 
      error: 'Failed to fetch market data', 
      details: errorMessage,
      symbol: req.params.symbol 
    });
  }
});

app.get('/api/market/analysis/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    if (!PRESENTATION_ASSETS.includes(symbol as any)) {
      return res.status(404).json({ error: "Asset not supported" });
    }

    const useCache = req.query.useCache !== "false";
    const interval = (req.query.interval as any) || "15min";
    const periods = parseInt((req.query.periods as string) || "120");
    const cacheKey = `analysis:${symbol}:${interval}:${periods}`;

    if (useCache && analysisCache.has(cacheKey)) {
      const cached = analysisCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < ANALYSIS_CACHE_TTL) {
        console.log(`[Server Cache] HIT for ${cacheKey}`);
        return res.json(cached.data);
      }
    }
    console.log(`[Server Cache] MISS for ${cacheKey}`);

  const result = await runRealTimeAnalysis(symbol, interval, periods);

    analysisCache.set(cacheKey, {
      data: result,
      timestamp: Date.now(),
    });

    res.json(result);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error(`Error in /api/market/analysis/${req.params.symbol}:`, error);
    res
      .status(500)
      .json({ error: "Failed to get market analysis", details: errorMessage });
  }
});

// This endpoint is now deprecated in favor of the one above, but kept for compatibility
app.get("/api/presentation/analysis", async (req, res) => {
  try {
    const interval = 'daily' as const;
    const periods = 120;
    const [btc, eth] = await Promise.all([
      runRealTimeAnalysis('BTC', interval, periods),
      runRealTimeAnalysis('ETH', interval, periods),
    ]);
    res.json({ assets: { BTC: btc, ETH: eth }, timestamp: new Date().toISOString() });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to fetch presentation analysis', details: errorMessage });
  }
});

app.get('/api/presentation/data', async (req, res) => {
  try {
    const interval = 'daily' as const;
    const periods = 120;
    const [btc, eth] = await Promise.all([
      getMarketData('BTC', interval, periods),
      getMarketData('ETH', interval, periods),
    ]);
    res.json({ assets: { BTC: btc, ETH: eth }, timestamp: new Date().toISOString() });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to fetch presentation data', details: errorMessage });
  }
});

// OHLCV Market Data API endpoints
app.get('/api/market/data/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { interval = 'daily', periods = '100' } = req.query;
    
    const periodsNum = parseInt(periods as string, 10);
    if (isNaN(periodsNum) || periodsNum <= 0) {
      return res.status(400).json({ error: 'Periods must be a positive number' });
    }

    const data = await getMarketData(symbol, interval as any, periodsNum);
    res.json(data);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ 
      error: 'Failed to fetch market data', 
      details: errorMessage,
      symbol: req.params.symbol 
    });
  }
});

app.get('/api/market/analysis/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    if (!PRESENTATION_ASSETS.includes(symbol as any)) {
      return res.status(404).json({ error: "Asset not supported" });
    }

    const useCache = req.query.useCache !== "false";
    const interval = (req.query.interval as any) || "15min";
    const periods = parseInt((req.query.periods as string) || "120");
    const cacheKey = `analysis:${symbol}:${interval}:${periods}`;

    if (useCache && analysisCache.has(cacheKey)) {
      const cached = analysisCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < ANALYSIS_CACHE_TTL) {
        console.log(`[Server Cache] HIT for ${cacheKey}`);
        return res.json(cached.data);
      }
    }
    console.log(`[Server Cache] MISS for ${cacheKey}`);

  const result = await runRealTimeAnalysis(symbol, interval, periods);

    analysisCache.set(cacheKey, {
      data: result,
      timestamp: Date.now(),
    });

    res.json(result);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error(`Error in /api/market/analysis/${req.params.symbol}:`, error);
    res
      .status(500)
      .json({ error: "Failed to get market analysis", details: errorMessage });
  }
});

// This endpoint is now deprecated in favor of the one above, but kept for compatibility
app.get("/api/presentation/analysis", async (req, res) => {
  try {
    const interval = 'daily' as const;
    const periods = 120;
    const [btc, eth] = await Promise.all([
      runRealTimeAnalysis('BTC', interval, periods),
      runRealTimeAnalysis('ETH', interval, periods),
    ]);
    res.json({ assets: { BTC: btc, ETH: eth }, timestamp: new Date().toISOString() });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to fetch presentation analysis', details: errorMessage });
  }
});

app.get('/api/presentation/data', async (req, res) => {
  try {
    const interval = 'daily' as const;
    const periods = 120;
    const [btc, eth] = await Promise.all([
      getMarketData('BTC', interval, periods),
      getMarketData('ETH', interval, periods),
    ]);
    res.json({ assets: { BTC: btc, ETH: eth }, timestamp: new Date().toISOString() });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to fetch presentation data', details: errorMessage });
  }
});

// OHLCV Market Data API endpoints
app.get('/api/market/data/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { interval = 'daily', periods = '100' } = req.query;
    
    const periodsNum = parseInt(periods as string, 10);
    if (isNaN(periodsNum) || periodsNum <= 0) {
      return res.status(400).json({ error: 'Periods must be a positive number' });
    }

    const data = await getMarketData(symbol, interval as any, periodsNum);
    res.json(data);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ 
      error: 'Failed to fetch market data', 
      details: errorMessage,
      symbol: req.params.symbol 
    });
  }
});

app.get('/api/market/analysis/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    if (!PRESENTATION_ASSETS.includes(symbol as any)) {
      return res.status(404).json({ error: "Asset not supported" });
    }

    const useCache = req.query.useCache !== "false";
    const interval = (req.query.interval as any) || "15min";
    const periods = parseInt((req.query.periods as string) || "120");
    const cacheKey = `analysis:${symbol}:${interval}:${periods}`;

    if (useCache && analysisCache.has(cacheKey)) {
      const cached = analysisCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < ANALYSIS_CACHE_TTL) {
        console.log(`[Server Cache] HIT for ${cacheKey}`);
        return res.json(cached.data);
      }
    }
    console.log(`[Server Cache] MISS for ${cacheKey}`);

  const result = await runRealTimeAnalysis(symbol, interval, periods);

    analysisCache.set(cacheKey, {
      data: result,
      timestamp: Date.now(),
    });

    res.json(result);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error(`Error in /api/market/analysis/${req.params.symbol}:`, error);
    res
      .status(500)
      .json({ error: "Failed to get market analysis", details: errorMessage });
  }
});

// This endpoint is now deprecated in favor of the one above, but kept for compatibility
app.get("/api/presentation/analysis", async (req, res) => {
  try {
    const interval = 'daily' as const;
    const periods = 120;
    const [btc, eth] = await Promise.all([
      runRealTimeAnalysis('BTC', interval, periods),
      runRealTimeAnalysis('ETH', interval, periods),
    ]);
    res.json({ assets: { BTC: btc, ETH: eth }, timestamp: new Date().toISOString() });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to fetch presentation analysis', details: errorMessage });
  }
});

app.get('/api/presentation/data', async (req, res) => {
  try {
    const interval = 'daily' as const;
    const periods = 120;
    const [btc, eth] = await Promise.all([
      getMarketData('BTC', interval, periods),
      getMarketData('ETH', interval, periods),
    ]);
    res.json({ assets: { BTC: btc, ETH: eth }, timestamp: new Date().toISOString() });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to fetch presentation data', details: errorMessage });
  }
});

// OHLCV Market Data API endpoints
app.get('/api/market/data/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { interval = 'daily', periods = '100' } = req.query;
    
    const periodsNum = parseInt(periods as string, 10);
    if (isNaN(periodsNum) || periodsNum <= 0) {
      return res.status(400).json({ error: 'Periods must be a positive number' });
    }

    const data = await getMarketData(symbol, interval as any, periodsNum);
    res.json(data);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ 
      error: 'Failed to fetch market data', 
      details: errorMessage,
      symbol: req.params.symbol 
    });
  }
});

app.get('/api/market/analysis/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    if (!PRESENTATION_ASSETS.includes(symbol as any)) {
      return res.status(404).json({ error: "Asset not supported" });
    }

    const useCache = req.query.useCache !== "false";
    const interval = (req.query.interval as any) || "15min";
    const periods = parseInt((req.query.periods as string) || "120");
    const cacheKey = `analysis:${symbol}:${interval}:${periods}`;

    if (useCache && analysisCache.has(cacheKey)) {
      const cached = analysisCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < ANALYSIS_CACHE_TTL) {
        console.log(`[Server Cache] HIT for ${cacheKey}`);
        return res.json(cached.data);
      }
    }
    console.log(`[Server Cache] MISS for ${cacheKey}`);

  const result = await runRealTimeAnalysis(symbol, interval, periods);

    analysisCache.set(cacheKey, {
      data: result,
      timestamp: Date.now(),
    });

    res.json(result);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error(`Error in /api/market/analysis/${req.params.symbol}:`, error);
    res
      .status(500)
      .json({ error: "Failed to get market analysis", details: errorMessage });
  }
});

// This endpoint is now deprecated in favor of the one above, but kept for compatibility
app.get("/api/presentation/analysis", async (req, res) => {
  try {
    const interval = 'daily' as const;
    const periods = 120;
    const [btc, eth] = await Promise.all([
      runRealTimeAnalysis('BTC', interval, periods),
      runRealTimeAnalysis('ETH', interval, periods),
    ]);
    res.json({ assets: { BTC: btc, ETH: eth }, timestamp: new Date().toISOString() });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to fetch presentation analysis', details: errorMessage });
  }
});

app.get('/api/presentation/data', async (req, res) => {
  try {
    const interval = 'daily' as const;
    const periods = 120;
    const [btc, eth] = await Promise.all([
      getMarketData('BTC', interval, periods),
      getMarketData('ETH', interval, periods),
    ]);
    res.json({ assets: { BTC: btc, ETH: eth }, timestamp: new Date().toISOString() });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to fetch presentation data', details: errorMessage });
  }
});

// OHLCV Market Data API endpoints
app.get('/api/market/data/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { interval = 'daily', periods = '100' } = req.query;
    
    const periodsNum = parseInt(periods as string, 10);
    if (isNaN(periodsNum) || periodsNum <= 0) {
      return res.status(400).json({ error: 'Periods must be a positive number' });
    }

    const data = await getMarketData(symbol, interval as any, periodsNum);
    res.json(data);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ 
      error: 'Failed to fetch market data', 
      details: errorMessage,
      symbol: req.params.symbol 
    });
  }
});

app.get('/api/market/analysis/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    if (!PRESENTATION_ASSETS.includes(symbol as any)) {
      return res.status(404).json({ error: "Asset not supported" });
    }

    const useCache = req.query.useCache !== "false";
    const interval = (req.query.interval as any) || "15min";
    const periods = parseInt((req.query.periods as string) || "120");
    const cacheKey = `analysis:${symbol}:${interval}:${periods}`;

    if (useCache && analysisCache.has(cacheKey)) {
      const cached = analysisCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < ANALYSIS_CACHE_TTL) {
        console.log(`[Server Cache] HIT for ${cacheKey}`);
        return res.json(cached.data);
      }
    }
    console.log(`[Server Cache] MISS for ${cacheKey}`);

    const result = await runRealTimeAnalysis(symbol, interval, periods);

    analysisCache.set(cacheKey, {
      data: result,
      timestamp: Date.now(),
    });

    res.json(result);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error(`Error in /api/market/analysis/${req.params.symbol}:`, error);
    res
      .status(500)
      .json({ error: "Failed to get market analysis", details: errorMessage });
  }
});

// This endpoint is now deprecated in favor of the one above, but kept for compatibility
app.get("/api/presentation/analysis", async (req, res) => {
  try {
    const interval = 'daily' as const;
    const periods = 120;
    const [btc, eth] = await Promise.all([
      runRealTimeAnalysis('BTC', interval, periods),
      runRealTimeAnalysis('ETH', interval, periods),
    ]);
    res.json({ assets: { BTC: btc, ETH: eth }, timestamp: new Date().toISOString() });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to fetch presentation analysis', details: errorMessage });
  }
});

app.get('/api/presentation/data', async (req, res) => {
  try {
    const interval = 'daily' as const;
    const periods = 120;
    const [btc, eth] = await Promise.all([
      getMarketData('BTC', interval, periods),
      getMarketData('ETH', interval, periods),
    ]);
    res.json({ assets: { BTC: btc, ETH: eth }, timestamp: new Date().toISOString() });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to fetch presentation data', details: errorMessage });
  }
});

// OHLCV Market Data API endpoints
app.get('/api/market/data/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { interval = 'daily', periods = '100' } = req.query;
    
    const periodsNum = parseInt(periods as string, 10);
    if (isNaN(periodsNum) || periodsNum <= 0) {
      return res.status(400).json({ error: 'Periods must be a positive number' });
    }

    const data = await getMarketData(symbol, interval as any, periodsNum);
    res.json(data);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ 
      error: 'Failed to fetch market data', 
      details: errorMessage,
      symbol: req.params.symbol 
    });
  }
});

app.get('/api/market/analysis/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    if (!PRESENTATION_ASSETS.includes(symbol as any)) {
      return res.status(404).json({ error: "Asset not supported" });
    }

    const useCache = req.query.useCache !== "false";
    const interval = (req.query.interval as any) || "15min";
    const periods = parseInt((req.query.periods as string) || "120");
    const cacheKey = `analysis:${symbol}:${interval}:${periods}`;

    if (useCache && analysisCache.has(cacheKey)) {
      const cached = analysisCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < ANALYSIS_CACHE_TTL) {
        console.log(`[Server Cache] HIT for ${cacheKey}`);
        return res.json(cached.data);
      }
    }
    console.log(`[Server Cache] MISS for ${cacheKey}`);

    const result = await runRealTimeAnalysis(symbol, interval, periods);

    analysisCache.set(cacheKey, {
      data: result,
      timestamp: Date.now(),
    });

    res.json(result);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error(`Error in /api/market/analysis/${req.params.symbol}:`, error);
    res
      .status(500)
      .json({ error: "Failed to get market analysis", details: errorMessage });
  }
});

// This endpoint is now deprecated in favor of the one above, but kept for compatibility
app.get("/api/presentation/analysis", async (req, res) => {
  try {
    const interval = 'daily' as const;
    const periods = 120;
    const [btc, eth] = await Promise.all([
      runRealTimeAnalysis('BTC', interval, periods),
      runRealTimeAnalysis('ETH', interval, periods),
    ]);
    res.json({ assets: { BTC: btc, ETH: eth }, timestamp: new Date().toISOString() });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to fetch presentation analysis', details: errorMessage });
  }
});

app.get('/api/presentation/data', async (req, res) => {
  try {
    const interval = 'daily' as const;
    const periods = 120;
    const [btc, eth] = await Promise.all([
      getMarketData('BTC', interval, periods),
      getMarketData('ETH', interval, periods),
    ]);
    res.json({ assets: { BTC: btc, ETH: eth }, timestamp: new Date().toISOString() });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to fetch presentation data', details: errorMessage });
  }
});

// OHLCV Market Data API endpoints
app.get('/api/market/data/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { interval = 'daily', periods = '100' } = req.query;
    
    const periodsNum = parseInt(periods as string, 10);
    if (isNaN(periodsNum) || periodsNum <= 0) {
      return res.status(400).json({ error: 'Periods must be a positive number' });
    }

    const data = await getMarketData(symbol, interval as any, periodsNum);
    res.json(data);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ 
      error: 'Failed to fetch market data', 
      details: errorMessage,
      symbol: req.params.symbol 
    });
  }
});

app.get('/api/market/analysis/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    if (!PRESENTATION_ASSETS.includes(symbol as any)) {
      return res.status(404).json({ error: "Asset not supported" });
    }

    const useCache = req.query.useCache !== "false";
    const interval = (req.query.interval as any) || "15min";
    const periods = parseInt((req.query.periods as string) || "120");
    const cacheKey = `analysis:${symbol}:${interval}:${periods}`;

    if (useCache && analysisCache.has(cacheKey)) {
      const cached = analysisCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < ANALYSIS_CACHE_TTL) {
        console.log(`[Server Cache] HIT for ${cacheKey}`);
        return res.json(cached.data);
      }
    }
    console.log(`[Server Cache] MISS for ${cacheKey}`);

    const result = await runRealTimeAnalysis(symbol, interval, periods);

    analysisCache.set(cacheKey, {
      data: result,
      timestamp: Date.now(),
    });

    res.json(result);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error(`Error in /api/market/analysis/${req.params.symbol}:`, error);
    res
      .status(500)
      .json({ error: "Failed to get market analysis", details: errorMessage });
  }
});

// This endpoint is now deprecated in favor of the one above, but kept for compatibility
app.get("/api/presentation/analysis", async (req, res) => {
  try {
    const interval = 'daily' as const;
    const periods = 120;
    const [btc, eth] = await Promise.all([
      runRealTimeAnalysis('BTC', interval, periods),
      runRealTimeAnalysis('ETH', interval, periods),
    ]);
    res.json({ assets: { BTC: btc, ETH: eth }, timestamp: new Date().toISOString() });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to fetch presentation analysis', details: errorMessage });
  }
});

app.get('/api/presentation/data', async (req, res) => {
  try {
    const interval = 'daily' as const;
    const periods = 120;
    const [btc, eth] = await Promise.all([
      getMarketData('BTC', interval, periods),
      getMarketData('ETH', interval, periods),
    ]);
    res.json({ assets: { BTC: btc, ETH: eth }, timestamp: new Date().toISOString() });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to fetch presentation data', details: errorMessage });
  }
});

// OHLCV Market Data API endpoints
app.get('/api/market/data/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { interval = 'daily', periods = '100' } = req.query;
    
    const periodsNum = parseInt(periods as string, 10);
    if (isNaN(periodsNum) || periodsNum <= 0) {
      return res.status(400).json({ error: 'Periods must be a positive number' });
    }

    const data = await getMarketData(symbol, interval as any, periodsNum);
    res.json(data);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ 
      error: 'Failed to fetch market data', 
      details: errorMessage,
      symbol: req.params.symbol 
    });
  }
});

app.get('/api/market/analysis/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    if (!PRESENTATION_ASSETS.includes(symbol as any)) {
      return res.status(404).json({ error: "Asset not supported" });
    }

    const useCache = req.query.useCache !== "false";
    const interval = (req.query.interval as any) || "15min";
    const periods = parseInt((req.query.periods as string) || "120");
    const cacheKey = `analysis:${symbol}:${interval}:${periods}`;

    if (useCache && analysisCache.has(cacheKey)) {
      const cached = analysisCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < ANALYSIS_CACHE_TTL) {
        console.log(`[Server Cache] HIT for ${cacheKey}`);
        return res.json(cached.data);
      }
    }
    console.log(`[Server Cache] MISS for ${cacheKey}`);

    const result = await runRealTimeAnalysis(symbol, interval, periods);

    analysisCache.set(cacheKey, {
      data: result,
      timestamp: Date.now(),
    });

    res.json(result);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error(`Error in /api/market/analysis/${req.params.symbol}:`, error);
    res
      .status(500)
      .json({ error: "Failed to get market analysis", details: errorMessage });
  }
});

// This endpoint is now deprecated in favor of the one above, but kept for compatibility
app.get("/api/presentation/analysis", async (req, res) => {
  try {
    const interval = 'daily' as const;
    const periods = 120;
    const [btc, eth] = await Promise.all([
      runRealTimeAnalysis('BTC', interval, periods),
      runRealTimeAnalysis('ETH', interval, periods),
    ]);
    res.json({ assets: { BTC: btc, ETH: eth }, timestamp: new Date().toISOString() });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to fetch presentation analysis', details: errorMessage });
  }
});

app.get('/api/presentation/data', async (req, res) => {
  try {
    const interval = 'daily' as const;
    const periods = 120;
    const [btc, eth] = await Promise.all([
      getMarketData('BTC', interval, periods),
      getMarketData('ETH', interval, periods),
    ]);
    res.json({ assets: { BTC: btc, ETH: eth }, timestamp: new Date().toISOString() });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to fetch presentation data', details: errorMessage });
  }
});

// OHLCV Market Data API endpoints
app.get('/api/market/data/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { interval = 'daily', periods = '100' } = req.query;
    
    const periodsNum = parseInt(periods as string, 10);
    if (isNaN(periodsNum) || periodsNum <= 0) {
      return res.status(400).json({ error: 'Periods must be a positive number' });
    }

    const data = await getMarketData(symbol, interval as any, periodsNum);
    res.json(data);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ 
      error: 'Failed to fetch market data', 
      details: errorMessage,
      symbol: req.params.symbol 
    });
  }
});

app.get('/api/market/analysis/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    if (!PRESENTATION_ASSETS.includes(symbol as any)) {
      return res.status(404).json({ error: "Asset not supported" });
    }

    const useCache = req.query.useCache !== "false";
    const interval = (req.query.interval as any) || "15min";
    const periods = parseInt((req.query.periods as string) || "120");
    const cacheKey = `analysis:${symbol}:${interval}:${periods}`;

    if (useCache && analysisCache.has(cacheKey)) {
      const cached = analysisCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < ANALYSIS_CACHE_TTL) {
        console.log(`[Server Cache] HIT for ${cacheKey}`);
        return res.json(cached.data);
      }
    }
    console.log(`[Server Cache] MISS for ${cacheKey}`);

    const result = await runRealTimeAnalysis(symbol, interval, periods);

    analysisCache.set(cacheKey, {
      data: result,
      timestamp: Date.now(),
    });

    res.json(result);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error(`Error in /api/market/analysis/${req.params.symbol}:`, error);
    res
      .status(500)
      .json({ error: "Failed to get market analysis", details: errorMessage });
  }
});

// This endpoint is now deprecated in favor of the one above, but kept for compatibility
app.get("/api/presentation/analysis", async (req, res) => {
  try {
    const interval = 'daily' as const;
    const periods = 120;
    const [btc, eth] = await Promise.all([
      runRealTimeAnalysis('BTC', interval, periods),
      runRealTimeAnalysis('ETH', interval, periods),
    ]);
    res.json({ assets: { BTC: btc, ETH: eth }, timestamp: new Date().toISOString() });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to fetch presentation analysis', details: errorMessage });
  }
});

app.get('/api/presentation/data', async (req, res) => {
  try {
    const interval = 'daily' as const;
    const periods = 120;
    const [btc, eth] = await Promise.all([
      getMarketData('BTC', interval, periods),
      getMarketData('ETH', interval, periods),
    ]);
    res.json({ assets: { BTC: btc, ETH: eth }, timestamp: new Date().toISOString() });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to fetch presentation data', details: errorMessage });
  }
});

// OHLCV Market Data API endpoints
app.get('/api/market/data/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { interval = 'daily', periods = '100' } = req.query;
    
    const periodsNum = parseInt(periods as string, 10);
    if (isNaN(periodsNum) || periodsNum <= 0) {
      return res.status(400).json({ error: 'Periods must be a positive number' });
    }

    const data = await getMarketData(symbol, interval as any, periodsNum);
    res.json(data);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ 
      error: 'Failed to fetch market data', 
      details: errorMessage,
      symbol: req.params.symbol 
    });
  }
});

app.get('/api/market/analysis/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    if (!PRESENTATION_ASSETS.includes(symbol as any)) {
      return res.status(404).json({ error: "Asset not supported" });
    }

    const useCache = req.query.useCache !== "false";
    const interval = (req.query.interval as any) || "15min";
    const periods = parseInt((req.query.periods as string) || "120");
    const cacheKey = `analysis:${symbol}:${interval}:${periods}`;

    if (useCache && analysisCache.has(cacheKey)) {
      const cached = analysisCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < ANALYSIS_CACHE_TTL) {
        console.log(`[Server Cache] HIT for ${cacheKey}`);
        return res.json(cached.data);
      }
    }
    console.log(`[Server Cache] MISS for ${cacheKey}`);

    const result = await runRealTimeAnalysis(symbol, interval, periods);

    analysisCache.set(cacheKey, {
      data: result,
      timestamp: Date.now(),
    });

    res.json(result);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error(`Error in /api/market/analysis/${req.params.symbol}:`, error);
    res
      .status(500)
      .json({ error: "Failed to get market analysis", details: errorMessage });
  }
});

// This endpoint is now deprecated in favor of the one above, but kept for compatibility
app.get("/api/presentation/analysis", async (req, res) => {
  try {
    const interval = 'daily' as const;
    const periods = 120;
    const [btc, eth] = await Promise.all([
      runRealTimeAnalysis('BTC', interval, periods),
      runRealTimeAnalysis('ETH', interval, periods),
    ]);
    res.json({ assets: { BTC: btc, ETH: eth }, timestamp: new Date().toISOString() });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to fetch presentation analysis', details: errorMessage });
  }
});

app.get('/api/presentation/data', async (req, res) => {
  try {
    const interval = 'daily' as const;
    const periods = 120;
    const [btc, eth] = await Promise.all([
      getMarketData('BTC', interval, periods),
      getMarketData('ETH', interval, periods),
    ]);
    res.json({ assets: { BTC: btc, ETH: eth }, timestamp: new Date().toISOString() });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to fetch presentation data', details: errorMessage });
  }
});

// OHLCV Market Data API endpoints
app.get('/api/market/data/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { interval = 'daily', periods = '100' } = req.query;
    
    const periodsNum = parseInt(periods as string, 10);
    if (isNaN(periodsNum) || periodsNum <= 0) {
      return res.status(400).json({ error: 'Periods must be a positive number' });
    }

    const data = await getMarketData(symbol, interval as any, periodsNum);
    res.json(data);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ 
      error: 'Failed to fetch market data', 
      details: errorMessage,
      symbol: req.params.symbol 
    });
  }
});

app.get('/api/market/analysis/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    if (!PRESENTATION_ASSETS.includes(symbol as any)) {
      return res.status(404).json({ error: "Asset not supported" });
    }

    const useCache = req.query.useCache !== "false";
    const interval = (req.query.interval as any) || "15min";
    const periods = parseInt((req.query.periods as string) || "120");
    const cacheKey = `analysis:${symbol}:${interval}:${periods}`;

    if (useCache && analysisCache.has(cacheKey)) {
      const cached = analysisCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < ANALYSIS_CACHE_TTL) {
        console.log(`[Server Cache] HIT for ${cacheKey}`);
        return res.json(cached.data);
      }
    }
    console.log(`[Server Cache] MISS for ${cacheKey}`);

    const result = await runRealTimeAnalysis(symbol, interval, periods);

    analysisCache.set(cacheKey, {
      data: result,
      timestamp: Date.now(),
    });

    res.json(result);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error(`Error in /api/market/analysis/${req.params.symbol}:`, error);
    res
      .status(500)
      .json({ error: "Failed to get market analysis", details: errorMessage });
  }
});

// This endpoint is now deprecated in favor of the one above, but kept for compatibility
app.get("/api/presentation/analysis", async (req, res) => {
  try {
    const interval = 'daily' as const;
    const periods = 120;
    const [btc, eth] = await Promise.all([
      runRealTimeAnalysis('BTC', interval, periods),
      runRealTimeAnalysis('ETH', interval, periods),
    ]);
    res.json({ assets: { BTC: btc, ETH: eth }, timestamp: new Date().toISOString() });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to fetch presentation analysis', details: errorMessage });
  }
});

app.get('/api/presentation/data', async (req, res) => {
  try {
    const interval = 'daily' as const;
    const periods = 120;
    const [btc, eth] = await Promise.all([
      getMarketData('BTC', interval, periods),
      getMarketData('ETH', interval, periods),
    ]);
    res.json({ assets: { BTC: btc, ETH: eth }, timestamp: new Date().toISOString() });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to fetch presentation data', details: errorMessage });
  }
});

// OHLCV Market Data API endpoints
app.get('/api/market/data/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { interval = 'daily', periods = '100' } = req.query;
    
    const periodsNum = parseInt(periods as string, 10);
    if (isNaN(periodsNum) || periodsNum <= 0) {
      return res.status(400).json({ error: 'Periods must be a positive number' });
    }

    const data = await getMarketData(symbol, interval as any, periodsNum);
    res.json(data);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ 
      error: 'Failed to fetch market data', 
      details: errorMessage,
      symbol: req.params.symbol 
    });
  }
});

app.get('/api/market/analysis/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    if (!PRESENTATION_ASSETS.includes(symbol as any)) {
      return res.status(404).json({ error: "Asset not supported" });
    }

    const useCache = req.query.useCache !== "false";
    const interval = (req.query.interval as any) || "15min";
    const periods = parseInt((req.query.periods as string) || "120");
    const cacheKey = `analysis:${symbol}:${interval}:${periods}`;

    if (useCache && analysisCache.has(cacheKey)) {
      const cached = analysisCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < ANALYSIS_CACHE_TTL) {
        console.log(`[Server Cache] HIT for ${cacheKey}`);
        return res.json(cached.data);
      }
    }
    console.log(`[Server Cache] MISS for ${cacheKey}`);

    const result = await runRealTimeAnalysis(symbol, interval, periods);

    analysisCache.set(cacheKey, {
      data: result,
      timestamp: Date.now(),
    });

    res.json(result);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error(`Error in /api/market/analysis/${req.params.symbol}:`, error);
    res
      .status(500)
      .json({ error: "Failed to get market analysis", details: errorMessage });
  }
});

// This endpoint is now deprecated in favor of the one above, but kept for compatibility
app.get("/api/presentation/analysis", async (req, res) => {
  try {
    const interval = 'daily' as const;
    const periods = 120;
    const [btc, eth] = await Promise.all([
      runRealTimeAnalysis('BTC', interval, periods),
      runRealTimeAnalysis('ETH', interval, periods),
    ]);
    res.json({ assets: { BTC: btc, ETH: eth }, timestamp: new Date().toISOString() });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to fetch presentation analysis', details: errorMessage });
  }
});

app.get('/api/presentation/data', async (req, res) => {
  try {
    const interval = 'daily' as const;
    const periods = 120;
    const [btc, eth] = await Promise.all([
      getMarketData('BTC', interval, periods),
      getMarketData('ETH', interval, periods),
    ]);
    res.json({ assets: { BTC: btc, ETH: eth }, timestamp: new Date().toISOString() });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to fetch presentation data', details: errorMessage });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});