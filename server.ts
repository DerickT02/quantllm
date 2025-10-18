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
import { ChatService } from './src/chat.js';

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

// Chat service instance
const chatService = new ChatService();


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
    chat: 'enabled'
  });
});

// Chat API endpoints
app.get('/api/chat/messages', (req, res) => {
  try {
    const messages = chatService.getMessages();
    res.json({ messages, timestamp: new Date().toISOString() });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to get chat messages', details: errorMessage });
  }
});

app.post('/api/chat/message', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Message is required and must be a string' });
    }

    const response = await chatService.processUserMessage(message.trim());
    const allMessages = chatService.getMessages();
    
    res.json({ 
      response,
      messages: allMessages,
      currentCategory: chatService.getCurrentCategory(),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to process chat message', details: errorMessage });
  }
});

app.get('/api/chat/categories', (req, res) => {
  try {
    const categories = chatService.getCategories();
    res.json({ categories, timestamp: new Date().toISOString() });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to get categories', details: errorMessage });
  }
});

app.post('/api/chat/clear', (req, res) => {
  try {
    chatService.clearChat();
    const messages = chatService.getMessages();
    res.json({ messages, timestamp: new Date().toISOString() });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to clear chat', details: errorMessage });
  }
});

app.get('/api/chat/status', (req, res) => {
  try {
    res.json({ 
      geminiEnabled: chatService.isGeminiEnabled(),
      currentCategory: chatService.getCurrentCategory(),
      selectedAsset: chatService.getSelectedAsset(),
      chatState: chatService.getChatState(),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to get chat status', details: errorMessage });
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
  console.log(`� Chat Interface: http://localhost:${PORT} (integrated)`);
  console.log(`�🔗 API: http://localhost:${PORT}/api/analysis`);
  console.log(`🤖 Individual agents: http://localhost:${PORT}/api/agents/{indicator|pattern|trend|risk}`);
  console.log(`💭 Chat API: http://localhost:${PORT}/api/chat/messages`);
  
  // Generate initial analysis
  generateAnalysis().then(() => {
    console.log('✅ Initial analysis ready');
  }).catch(err => {
    console.error('❌ Failed to generate initial analysis:', err.message);
  });
});