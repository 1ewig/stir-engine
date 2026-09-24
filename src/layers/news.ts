import path from 'path';
import dotenv from 'dotenv';
import { TinyFish } from '@tiny-fish/sdk';
import {
  CalendarEvent,
  NewsAndCalendarResult,
  NewsItem
} from '../types';
import {
  dataProvider,
  fetchLiveEconomicCalendar
} from '../dataProvider';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// Institutional sentiment dictionaries for USD and EUR
const HAWKISH_USD_KEYWORDS = [
  'bearish eur', 'fed outlook', 'fed hawkish', 'rate hike', 'dollar strength',
  'falls below', 'pressure', 'under pressure', 'strong us', 'dollar gains',
  'yields surge', 'us resilient', 'inflation high', 'fed hold', 'ecb cut',
  'rate cut bets fall', 'us outperformance', 'safe-haven'
];

const HAWKISH_EUR_KEYWORDS = [
  'bullish eur', 'ecb hawkish', 'euro gains', 'euro rally', 'dollar weakness',
  'fed cut', 'rate cuts', 'dollar slips', 'euro surges', 'ecb hike',
  'german recovery', 'europe rebounds', 'us slowing', 'euro resilience'
];

/**
 * Run Layer: Live News Sentiment & Economic Calendar Surprise / Event-Risk Engine
 */
export async function runNewsAndCalendarEngine(): Promise<NewsAndCalendarResult> {
  console.log("Analyzing News & Calendar Engine: Live TinyFish News Flow & Forex Calendar...");

  const apiKey = process.env.tiny_fish_api || process.env.TINYFISH_API_KEY;
  const headlines: NewsItem[] = [];
  let newsSentimentScore = 0;

  // 1. Fetch & analyze live news via TinyFish SDK
  if (apiKey) {
    const startTime = Date.now();
    try {
      const client = new TinyFish({ apiKey });
      const res = await client.search.query({
        query: 'EUR USD forex economic news Federal Reserve ECB interest rates',
        domain_type: 'news',
        purpose: 'Analyze macroeconomic news sentiment and central bank policy for EUR/USD exchange rate'
      });

      const rawResults = res.results || [];
      let totalItemScore = 0;

      for (const item of rawResults.slice(0, 10)) {
        const text = `${item.title} ${item.snippet}`.toLowerCase();
        let itemScore = 0;
        let usdHits = 0;
        let eurHits = 0;

        for (const kw of HAWKISH_USD_KEYWORDS) {
          if (text.includes(kw)) usdHits++;
        }
        for (const kw of HAWKISH_EUR_KEYWORDS) {
          if (text.includes(kw)) eurHits++;
        }

        if (usdHits > eurHits) {
          itemScore = -Math.min(1.0, 0.4 + (usdHits * 0.2));
        } else if (eurHits > usdHits) {
          itemScore = Math.min(1.0, 0.4 + (eurHits * 0.2));
        }

        headlines.push({
          title: item.title,
          source: item.publisher || item.site_name || 'Web',
          url: item.url,
          date: item.date,
          sentiment: itemScore < 0 ? 'USD_BULLISH' : itemScore > 0 ? 'EUR_BULLISH' : 'NEUTRAL',
          score: parseFloat(itemScore.toFixed(2)),
          snippet: item.snippet
        });

        totalItemScore += itemScore;
      }

      if (headlines.length > 0) {
        newsSentimentScore = parseFloat(((totalItemScore / headlines.length) * 100).toFixed(1));
      }

      dataProvider.healthLogs.push({
        source: 'TinyFish_News_Stream',
        status: 'OK',
        latencyMs: Date.now() - startTime
      });
    } catch (err: any) {
      console.warn(`[News Engine] TinyFish search failed (${err.message}). Using neutral baseline.`);
      dataProvider.healthLogs.push({
        source: 'TinyFish_News_Stream',
        status: 'FALLBACK',
        latencyMs: Date.now() - startTime,
        details: err.message
      });
    }
  } else {
    console.warn("[News Engine] No TinyFish API key detected in environment. Using neutral baseline.");
  }

  // 2. Fetch live Forex Calendar events
  const calendarEvents = await fetchLiveEconomicCalendar();
  const upcomingHighImpact: CalendarEvent[] = [];

  for (const ev of calendarEvents) {
    // Flag if High impact event within -1h to +6h (immediate event volatility window)
    if (ev.impact === 'High' && ev.hoursUntil >= -1 && ev.hoursUntil <= 6) {
      upcomingHighImpact.push(ev);
    }
  }

  const eventRiskActive = upcomingHighImpact.length > 0;
  const eventRiskReason = eventRiskActive
    ? `Imminent Tier-1 Event Risk: ${upcomingHighImpact.map(e => `${e.country} "${e.title}" (in ${e.hoursUntil}h)`).join('; ')}. Volatility risk elevated.`
    : undefined;

  const bias: 'USD_BULLISH' | 'EUR_BULLISH' | 'NEUTRAL' =
    newsSentimentScore <= -20 ? 'USD_BULLISH' : newsSentimentScore >= 20 ? 'EUR_BULLISH' : 'NEUTRAL';

  return {
    score: newsSentimentScore,
    bias,
    headlines,
    calendarEvents,
    upcomingHighImpact,
    eventRiskActive,
    eventRiskReason
  };
}
