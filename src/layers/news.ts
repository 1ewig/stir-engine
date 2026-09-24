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
import {
  classifyArticlesWithAI,
  ArticleClassificationInput
} from '../ai';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// Top institutional financial domains
const INSTITUTIONAL_NEWS_DOMAINS = 'reuters.com,bloomberg.com,ft.com,forexlive.com,fxstreet.com,marketwatch.com,cnbc.com,investing.com,wsj.com';

// Enhanced Institutional sentiment dictionaries for USD and EUR
const HAWKISH_USD_KEYWORDS = [
  'bearish eur', 'fed outlook', 'fed hawkish', 'rate hike', 'dollar strength',
  'falls below', 'pressure', 'under pressure', 'strong us', 'dollar gains',
  'yields surge', 'us resilient', 'inflation high', 'fed hold', 'ecb cut',
  'rate cut bets fall', 'us outperformance', 'safe-haven', 'dollar rallies',
  'dollar index climbs', 'us labor market strong', 'higher for longer',
  'fed pause bets fade', 'williams warns', 'powell hawkish', 'sticky inflation',
  'us gdp beats', 'us pmi beats', 'fed hawkish stance', 'rate hikes likely'
];

const HAWKISH_EUR_KEYWORDS = [
  'bullish eur', 'ecb hawkish', 'euro gains', 'euro rally', 'dollar weakness',
  'fed cut', 'rate cuts', 'dollar slips', 'euro surges', 'ecb hike',
  'german recovery', 'europe rebounds', 'us slowing', 'euro resilience',
  'dollar slides', 'euro advances', 'euro holds recovery', 'dovish fed',
  'rate cut expected', 'us recession fears', 'lagarde hawkish', 'ecb hiking',
  'eurozone inflation sticky', 'ecb rate hike bets', 'euro area beats'
];

/**
 * Run Pillar 3: News Sentiment & Catalyst Calendar (Live TinyFish News & Economic Events)
 * Upgraded with:
 * 1. 48-Hour Freshness Window (recency_minutes: 2880)
 * 2. Institutional Domain Whitelisting (Reuters, Bloomberg, FT, FXStreet, etc.)
 * 3. English Language Pinning (language: 'en')
 * 4. Dual-Vector Macro Discovery (Fed/USD Vector & ECB/EUR Vector)
 * 5. Deep Article Content Extraction (client.fetch.getContents) for top articles
 */
export async function runNewsAndCalendarEngine(): Promise<NewsAndCalendarResult> {
  console.log("Analyzing Pillar 3: News Sentiment & Catalyst Calendar (Live TinyFish News & Economic Events)...");

  const apiKey = process.env.tiny_fish_api || process.env.TINYFISH_API_KEY;
  const headlines: NewsItem[] = [];
  let newsSentimentScore = 0;

  // 1. Fetch & analyze live institutional news via TinyFish SDK
  if (apiKey) {
    const startTime = Date.now();
    try {
      const client = new TinyFish({ apiKey });

      // Run targeted Dual-Vector queries concurrently:
      // Vector A: Fed & US Interest Rate Expectations
      // Vector B: ECB & Eurozone Monetary & Growth Dynamics
      const [fedSearch, ecbSearch] = await Promise.all([
        client.search.query({
          query: 'Federal Reserve interest rates FOMC inflation US Dollar yields',
          domain_type: 'news',
          language: 'en',
          recency_minutes: 2880, // strictly last 48 hours
          include_domains: INSTITUTIONAL_NEWS_DOMAINS,
          purpose: 'Analyze Federal Reserve monetary policy, US rate expectations, and inflation momentum for EUR/USD swing trading'
        }).catch(() => null),
        client.search.query({
          query: 'European Central Bank ECB interest rates Eurozone economy Germany inflation',
          domain_type: 'news',
          language: 'en',
          recency_minutes: 2880, // strictly last 48 hours
          include_domains: INSTITUTIONAL_NEWS_DOMAINS,
          purpose: 'Analyze ECB monetary policy stance, Eurozone economic growth, and euro currency momentum'
        }).catch(() => null)
      ]);

      const candidateResults: any[] = [
        ...(fedSearch?.results || []),
        ...(ecbSearch?.results || [])
      ];

      // Fallback: If domain-restricted search yielded < 3 articles, run open news search
      if (candidateResults.length < 3) {
        const broadSearch = await client.search.query({
          query: 'EUR USD forex economic news Federal Reserve ECB interest rates',
          domain_type: 'news',
          language: 'en',
          recency_minutes: 2880,
          purpose: 'Analyze macroeconomic news sentiment and central bank policy for EUR/USD exchange rate'
        }).catch(() => null);

        if (broadSearch?.results) {
          candidateResults.push(...broadSearch.results);
        }
      }

      // Deduplicate results by URL
      const seenUrls = new Set<string>();
      const uniqueResults: any[] = [];
      for (const item of candidateResults) {
        if (item.url && !seenUrls.has(item.url)) {
          seenUrls.add(item.url);
          uniqueResults.push(item);
        }
      }

      const topCandidates = uniqueResults.slice(0, 8);

      // Deep Article Content Extraction:
      // Fetch full clean text for top 3 URLs using TinyFish fetch extraction
      const urlsToFetch = topCandidates.slice(0, 3).map(c => c.url).filter(Boolean);
      let fetchedArticleTexts: Record<string, string> = {};

      if (urlsToFetch.length > 0) {
        try {
          const fetchPromise = client.fetch.getContents({
            urls: urlsToFetch,
            format: 'markdown',
            purpose: 'Extract macroeconomic news article body for institutional FX sentiment analysis'
          });

          // Timeout guard: Allow max 4.5s for article body fetch
          const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 4500));
          const fetchRes = await Promise.race([fetchPromise, timeoutPromise]);

          if (fetchRes && fetchRes.results) {
            for (const r of fetchRes.results) {
              if (r.url && typeof r.text === 'string') {
                fetchedArticleTexts[r.url] = r.text;
              }
            }
          }
        } catch (fetchErr: any) {
          console.warn(`[News Engine] TinyFish body fetch skipped (${fetchErr?.message || 'timeout'}). Relying on snippets.`);
        }
      }

      // --- Modular Qualitative Semantic Classification via AI Layer ---
      const aiPayload: ArticleClassificationInput[] = topCandidates.map((item, idx) => {
        const body = fetchedArticleTexts[item.url] || '';
        const combinedContext = `${item.title}. ${item.snippet} ${body.slice(0, 500)}`.trim();
        return {
          id: idx + 1,
          title: item.title,
          source: item.publisher || item.site_name || 'Web',
          content: combinedContext
        };
      });

      const aiClassifications = await classifyArticlesWithAI(aiPayload);

      // --- Pure Deterministic TypeScript Math Engine ---
      const INTENSITY_WEIGHTS: Record<string, number> = {
        HIGH: 1.0,
        MEDIUM: 0.65,
        LOW: 0.35
      };

      const DIRECTION_SIGNS: Record<string, number> = {
        HAWKISH_USD: -1.0,  // USD advantage -> Bearish EUR/USD
        DOVISH_EUR: -1.0,   // EUR weakness -> Bearish EUR/USD
        HAWKISH_EUR: +1.0,  // EUR advantage -> Bullish EUR/USD
        DOVISH_USD: +1.0,   // USD weakness -> Bullish EUR/USD
        NEUTRAL: 0.0
      };

      let totalItemScore = 0;

      topCandidates.forEach((item, idx) => {
        const fullArticleText = fetchedArticleTexts[item.url] || '';
        const textToAnalyze = `${item.title} ${item.snippet} ${fullArticleText.slice(0, 2000)}`.toLowerCase();

        let itemScore = 0;
        let driverTag = '';

        const aiMatch = aiClassifications?.get(idx + 1);

        if (aiMatch) {
          // Deterministic mathematical calculation from qualitative classification
          const dir = DIRECTION_SIGNS[aiMatch.policyBias] ?? 0.0;
          const mag = INTENSITY_WEIGHTS[aiMatch.intensity] ?? 0.5;
          itemScore = parseFloat((dir * mag).toFixed(2));
          driverTag = aiMatch.driver ? ` [${aiMatch.driver}]` : '';
        } else {
          // Zero-downtime Keyword Dictionary Fallback
          let usdHits = 0;
          let eurHits = 0;
          for (const kw of HAWKISH_USD_KEYWORDS) {
            if (textToAnalyze.includes(kw)) usdHits++;
          }
          for (const kw of HAWKISH_EUR_KEYWORDS) {
            if (textToAnalyze.includes(kw)) eurHits++;
          }
          if (usdHits > eurHits) {
            itemScore = -Math.min(1.0, 0.4 + (usdHits * 0.15));
          } else if (eurHits > usdHits) {
            itemScore = Math.min(1.0, 0.4 + (eurHits * 0.15));
          }
        }

        headlines.push({
          title: item.title,
          source: item.publisher || item.site_name || 'Web',
          url: item.url,
          date: item.date,
          sentiment: itemScore < 0 ? 'USD_BULLISH' : itemScore > 0 ? 'EUR_BULLISH' : 'NEUTRAL',
          score: parseFloat(itemScore.toFixed(2)),
          snippet: `${item.snippet}${driverTag}`
        });

        totalItemScore += itemScore;
      });

      if (headlines.length > 0) {
        // Continuous deterministic aggregate score (-100 to +100)
        newsSentimentScore = parseFloat((Math.max(-100, Math.min(100, (totalItemScore / headlines.length) * 100))).toFixed(1));
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
