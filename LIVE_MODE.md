# 🔴 LIVE MODE - Real-Time Trading Signals

## Overview
The QuantLLM dashboard now features a **LIVE MODE** that automatically refreshes market data and generates AI-powered buy/sell signals in real-time!

## Features Implemented ✅

### 1. **Auto-Refresh (Enabled by Default)**
- Automatically starts 1 second after page load
- Updates every **5 seconds** with fresh market data
- Can be toggled on/off with the button

### 2. **Live Indicator**
- 🔴 **LIVE** badge appears when auto-refresh is active
- Pulsing animation shows the system is actively monitoring
- Changes to show "Auto Refresh: Off" when disabled

### 3. **Countdown Timer**
- Shows "Next update in Xs" countdown
- Updates every second
- Shows "Updating..." during data fetch

### 4. **Price Change Animations**
- **Green flash** when price goes up 📈
- **Red flash** when price goes down 📉
- Smooth 1-second animation on price changes

### 5. **Real-Time Buy/Sell Signals**
- AI analyzes market conditions every 5 seconds
- Generates new signals based on:
  - Support/Resistance zones
  - RSI indicators
  - Momentum analysis
  - EMA crossovers
  - Price patterns
- Signals appear on graph with triangular markers:
  - 🟢 Green triangle ▲ = BUY signal
  - 🔴 Red triangle ▼ = SELL signal

### 6. **Interactive Tooltips**
- Hover over any signal to see:
  - Signal type (BUY/SELL)
  - Confidence score (50-100%)
  - Reason for signal

### 7. **Visual Legend**
- Shows at bottom of graph:
  - Blue line = Price
  - Green line = EMA12
  - Red line = EMA26
  - Buy/Sell markers explained

## How to Use

### Starting Live Mode
1. Open http://localhost:3000
2. Live mode starts automatically after 1 second
3. Look for the pulsing 🔴 **LIVE** indicator

### Manual Control
- Click the **Auto Refresh** button to toggle on/off
- Click **Refresh Analysis** for immediate update
- Click **🔄 Generate New** to clear cache and fetch fresh data

### Watching for Signals
1. Monitor the **Signals Graph** at the top
2. Watch for green triangles (BUY) and red triangles (SELL)
3. Hover over signals to see confidence and reasoning
4. Observe price changes with animated flashes

## Signal Types Generated

### BUY Signals
- **Support Zone Buy** - Price near support with favorable RSI
- **Bullish Momentum** - Positive momentum with good RSI range
- **Uptrend Continuation** - EMA confirms uptrend with bullish pattern
- **RSI Recovery** - Recovering from oversold conditions
- **Range Bottom Buy** - Price in lower range during sideways market
- **EMA Bullish Crossover** - EMA12 crosses above EMA26

### SELL Signals
- **Resistance Zone Sell** - Price near resistance with high RSI
- **Bearish Momentum** - Negative momentum with unfavorable RSI
- **Downtrend Continuation** - EMA confirms downtrend with bearish pattern
- **RSI Reversal** - Reversing from overbought conditions
- **Range Top Sell** - Price in upper range during sideways market
- **EMA Bearish Crossover** - EMA12 crosses below EMA26

## Technical Details

### Update Frequency
- **Data Refresh**: Every 5 seconds
- **Countdown Update**: Every 1 second
- **Price Animation**: 1 second duration

### Data Providers
1. **Primary**: Polygon.io (with staleness detection)
2. **Fallback 1**: CoinGecko (for crypto)
3. **Fallback 2**: Alpha Vantage

### Caching
- **Server Cache**: 15 minutes TTL
- **Service Cache**: 60 minutes TTL
- **Browser Cache**: Bypassed in live mode with timestamps

## Browser Requirements
- Modern browser with ES6+ support
- JavaScript enabled
- Canvas support for graph rendering

## Performance
- Lightweight updates (only fetches changed data)
- Efficient canvas rendering
- Minimal CPU usage with requestAnimationFrame
- Automatic cleanup on page unload

## Troubleshooting

### Live Mode Not Starting
- Check browser console for errors
- Ensure server is running on port 3000
- Wait 1-2 seconds for auto-enable

### No Signals Appearing
- Signals require 26+ candles for EMA calculation
- Market may not meet signal conditions
- Check RSI is not exactly neutral (50)

### Slow Updates
- Check network connection
- Verify API rate limits not exceeded
- Consider increasing refresh interval in code

## Future Enhancements
- [ ] WebSocket streaming for sub-second updates
- [ ] Audio alerts for new signals
- [ ] Signal history log
- [ ] Customizable refresh intervals
- [ ] Multi-asset monitoring
- [ ] Trade execution integration

---

**Enjoy trading with AI-powered live signals! 🚀📈**
