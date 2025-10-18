# QuantLLM - Multi-Agent Quantitative Trading Analysis

A modular TypeScript-based multi-agent system for quantitative trading analysis featuring technical indicators, pattern recognition, trend analysis, and risk management.

## 🏗️ Modular Architecture

Each agent is now in its own dedicated file for better organization and reusability:

```
src/
├── agents/
│   ├── IndicatorAgent.ts    # RSI & market regime analysis
│   ├── PatternAgent.ts      # Candlestick pattern detection
│   ├── TrendAgent.ts        # EMA trend analysis
│   ├── RiskAgent.ts         # Risk management (ρ=0.0005)
│   └── index.ts            # Agent exports
├── utils/
OPENAI_API_KEY=your_openai_key_here
ALPHA_VANTAGE_API_KEY=your_alpha_vantage_key_here

# Optional: use external agents (quantllm-agents) via HTTP
# Enable endpoints /api/external/health and /api/external/run
EXTERNAL_AGENTS=1
EXTERNAL_AGENT_URL=http://localhost:1234
│   ├── technical.ts        # Technical analysis utilities
│   └── synthetic.ts        # Data generation
├── types.ts               # Shared type definitions
└── orchestrator.ts        # Main pipeline coordinator
```

### 🤖 Agent Specifications

- **IndicatorAgent**: Indicates Bullish or Bearish Market (Overbought/Oversold)

  - RSI(14) calculation and market regime classification
  - Confidence scoring based on RSI deviation from neutral (50)

- **PatternAgent**: Makes clear candlestick charts directly from raw price data

  - Detects: BullishEngulfing, BearishEngulfing, Doji, None
  - Calculates pattern strength based on body size ratios

- **TrendAgent**: Tracks trend of price over time

  - EMA12 vs EMA26 crossover analysis
  - Slope calculation for momentum assessment
  - Trend strength quantification

- **RiskAgent**: Uses fixed stop-loss value ρ = 0.0005 for short-term price movements
  - Dynamic risk multiplier r ∈ [1.2, 1.8]
  - Context-aware take-profit calculation (R = r × ρ)
  - Optional LLM-based intelligent risk tuning

## Quick Start

### Installation

```bash
npm install
```

### Run Complete Pipeline

```bash
npm run dev          # Watch mode
npx tsx quantllm.ts  # Single run
```

### Individual Agent Usage

```bash
npx tsx examples.ts  # See individual agent examples
```

### Build for Production

```bash
npm run build
npm start
```

## 🔧 Using Individual Agents

You can now use each agent independently:

```typescript
import {
  runIndicatorAgent,
  runPatternAgent,
  runTrendAgent,
  runRiskAgent,
  makeSyntheticSeries,
} from "./index.js";

// Generate or load your candle data
const candles = makeSyntheticSeries(100, 1.0);

// Use agents individually
const indicator = await runIndicatorAgent(candles);
const pattern = await runPatternAgent(candles);
const trend = await runTrendAgent(candles);
const risk = await runRiskAgent(indicator, pattern, trend);

// Or use the complete pipeline
import { runPipeline, runAnalysis } from "./index.js";
const { ctx, narrative } = await runPipeline(candles);
const jsonOutput = await runAnalysis(candles);
```

## Configuration

### Environment Variables

Create a `.env` file for optional LLM features:

```bash
# Optional: Enable LLM-based risk tuning
OPENAI_API_KEY=sk-your-key-here
```

## Example Output

```
=== QuantLLM Story ===
Time: 2025-10-17T18:09:38.000Z
📈 Indicator: RSI=75.0 (Bullish, Overbought); confidence=0.83
🕯️ Pattern: Doji (strength=0.40)
📊 Trend: Sideways (EMA12=1.00068, EMA26=1.00029, strength=0.00)
🛡️ Risk: ρ=0.00050, r=1.65 ⇒ take-profit R=0.00082 (Heuristic risk selection based on context.)
```

## Agent Specifications

### IndicatorAgent

- Computes RSI(14)
- Labels market regime: {Bullish, Bearish, Neutral}
- Flags overbought (RSI ≥ 70) and oversold (RSI ≤ 30)
- Confidence grows with |RSI-50|

### PatternAgent

- Detects: BullishEngulfing, BearishEngulfing, Doji, None
- Doji: body ≤ 0.1% of close price
- Engulfing: last candle body fully covers previous opposite-color body
- Strength based on body size ratio

### TrendAgent

- EMA12 vs EMA26 comparison
- Trend classification: {Uptrend, Downtrend, Sideways}
- Slope calculation over 12-period lookback
- Strength based on EMA divergence and slope magnitude

### RiskAgent

- Fixed stop-loss: ρ = 0.0005
- Dynamic multiplier: r ∈ [1.2, 1.8]
- Context-aware selection:
  - Strong bullish + uptrend → r ≈ 1.7-1.8
  - Sideways/uncertain → r ≈ 1.5
  - Bearish + downtrend → r ≈ 1.2-1.3

## Data Integration

Currently uses synthetic data. To integrate real market data:

1. Replace `makeSyntheticSeries()` with your data feed
2. Ensure data format matches:

```typescript
type Candle = {
  time: number; // epoch seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};
```

## Next Steps

1. **Real Data Integration**: Connect to Binance, Alpaca, Polygon, etc.
2. **HTTP API**: Expose endpoints for dashboard integration
3. **Visualization**: Add TradingView charts or Plotly integration
4. **LangGraph Migration**: Upgrade to LangGraph for advanced agent orchestration
5. **Additional Patterns**: Expand pattern recognition capabilities
6. **Backtesting**: Add historical analysis and strategy validation

## Architecture

The system uses a simple orchestrator that runs agents sequentially, building context as it progresses. Each agent has access to:

- Raw OHLCV candle data
- Previous agent outputs
- Shared context for decision making

This design makes it easy to:

- Add new agents
- Modify existing logic
- Integrate with LangGraph later
- Scale to more complex strategies

## License

ISC License
