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
// Chat feature removed for presentation-only build

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

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
    const { interval = 'daily', periods = '100' } = req.query;
    
    const periodsNum = parseInt(periods as string, 10);
    if (isNaN(periodsNum) || periodsNum <= 0) {
      return res.status(400).json({ error: 'Periods must be a positive number' });
    }

    const analysis = await runRealTimeAnalysis(symbol, interval as any, periodsNum);
    res.json(analysis);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ 
      error: 'Failed to run market analysis', 
      details: errorMessage,
      symbol: req.params.symbol 
    });
  }
});

app.get('/api/market/search', async (req, res) => {
  try {
    const { keywords } = req.query;
    if (!keywords || typeof keywords !== 'string') {
      return res.status(400).json({ error: 'Keywords parameter is required' });
    }

    const results = await searchMarketSymbols(keywords);
    res.json({ keywords, results, timestamp: new Date().toISOString() });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ 
      error: 'Failed to fetch OHLCV data', 
      details: errorMessage,
      route: '/api/market/search'
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 QuantLLM Web Server running on http://localhost:${PORT}`);
  console.log(`📊 Dashboard: http://localhost:${PORT}`);
  console.log(`🔗 API: http://localhost:${PORT}/api/analysis`);
  console.log(`🤖 Individual agents: http://localhost:${PORT}/api/agents/{indicator|pattern|trend|risk}`);
  console.log(`🎯 Presentation: http://localhost:${PORT}/api/presentation/analysis`);
  
  // Generate initial analysis
  generateAnalysis().then(() => {
    console.log('✅ Initial analysis ready');
  }).catch(err => {
    console.error('❌ Failed to generate initial analysis:', err.message);
  });
});