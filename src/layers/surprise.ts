import dotenv from 'dotenv';
import { TinyFish } from '@tiny-fish/sdk';
import { HeadlineEvidence, SurpriseLayerResult } from '../types';

dotenv.config({ path: '.env.local' });

const apiKey = process.env.tiny_fish_api || process.env.TINYFISH_API_KEY;
const client = new TinyFish({ apiKey });

// ============================================================================
// LAYER 2: ADVANCED NLP SURPRISE ENGINE (20% Weight)
// ============================================================================

export async function runSurpriseEngine(): Promise<SurpriseLayerResult> {
  console.log("Analyzing Layer 2: Advanced NLP Economic Surprise Engine (Search + Fetch) (20% weight)...");

  // Dynamic news queries without hardcoded year
  const queries = [
    "US Nonfarm Payrolls NFP jobs report unemployment beat miss consensus",
    "US CPI Core PCE inflation report rate beat expected",
    "Eurozone flash PMI HCOB manufacturing services survey"
  ];

  const rawSearchResults: any[] = [];
  const seenUrls = new Set<string>();

  for (const q of queries) {
    try {
      // 1. Search with recency filter (7200 mins = 5 days)
      let res = await client.search.query({
        query: q,
        domain_type: "news",
        location: "US",
        language: "en",
        recency_minutes: 7200
      });

      // Graceful fallback to 14 days if fresh 5-day results are sparse
      if (!res.results || res.results.length === 0) {
        res = await client.search.query({
          query: q,
          domain_type: "news",
          location: "US",
          language: "en",
          recency_minutes: 20160 // 14 days
        });
      }

      if (res.results) {
        for (const item of res.results) {
          if (!seenUrls.has(item.url)) {
            seenUrls.add(item.url);
            rawSearchResults.push(item);
          }
        }
      }
    } catch (err: any) {
      console.warn(`[Surprise Engine] Search error for "${q}":`, err?.message);
    }
  }

  // 2. Select top 3-4 most relevant unique URLs for deep Fetch
  const targetUrls = rawSearchResults
    .filter(r => !r.url.includes('youtube.com') && !r.url.includes('linkedin.com'))
    .slice(0, 4)
    .map(r => r.url);

  const fetchedContentMap = new Map<string, string>();

  if (targetUrls.length > 0) {
    console.log(`[Surprise Engine] Fetching & extracting clean markdown from ${targetUrls.length} top news URLs...`);
    try {
      const fetchPromise = client.fetch.getContents({
        urls: targetUrls,
        format: "markdown",
        links: false,
        per_url_timeout_ms: 8000
      });
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Batch fetch timed out after 12s")), 12000)
      );

      const fetchResponse: any = await Promise.race([fetchPromise, timeoutPromise]);

      if (fetchResponse?.results) {
        for (const res of fetchResponse.results) {
          if (res.text && typeof res.text === 'string' && res.text.length > 100 && !res.text.includes('403 - Operations too frequent')) {
            fetchedContentMap.set(res.url, res.text);
          }
        }
      }
    } catch (fetchErr: any) {
      console.warn("[Surprise Engine] Batch fetch warning, falling back to snippets:", fetchErr?.message);
    }
  }

  // 3. Token lexicon with negation words and inverted metrics
  const usBullishTokens = ['beat', 'exceeded', 'surpassed', 'higher', 'hotter', 'acceleration', 'jumped', 'rose', 'resilient', 'stronger', 'grew'];
  const usBearishTokens = ['missed', 'cooler', 'slowed', 'slumped', 'below', 'contracted', 'declined', 'weakened', 'disappointed', 'softened'];
  const euBullishTokens = ['rebounded', 'expanded', 'upturn', 'accelerating', 'improved', 'surged'];
  const euBearishTokens = ['contraction', 'stagnant', 'slump', 'recession', 'subdued', 'struggling', 'deteriorated'];
  const negationTokens = ['not', 'no', 'never', "didn't", 'without', 'failed', 'barely', 'scarcely'];
  // Metrics where "rose/higher" indicates economic weakness and "declined/lower" indicates economic strength
  const invertedMetricTokens = ['unemployment', 'jobless', 'claims', 'layoffs', 'layoff'];

  const detectedTokens = {
    usBullish: [] as string[],
    usBearish: [] as string[],
    euBullish: [] as string[],
    euBearish: [] as string[]
  };

  const evidence: HeadlineEvidence[] = [];
  let aggregateSurpriseScore = 0;

  // 4. Score content (preferring full fetched text, with graceful fallback to snippet)
  for (const item of rawSearchResults.slice(0, 6)) {
    const fetchedFullText = fetchedContentMap.get(item.url);
    const contentSource: 'FETCHED_FULL_TEXT' | 'SNIPPET_FALLBACK' = fetchedFullText ? 'FETCHED_FULL_TEXT' : 'SNIPPET_FALLBACK';

    // Use full text (truncated to first 3000 chars for core body analysis) or snippet
    const rawContent = (fetchedFullText ? fetchedFullText.slice(0, 3000) : `${item.title} ${item.snippet}`).toLowerCase();
    // Normalize punctuation to spaces for accurate token boundary matching
    const cleanContent = rawContent.replace(/[^a-z0-9\s-]/g, ' ');
    const words = cleanContent.split(/\s+/).filter(Boolean);
    let itemScore = 0;
    const matchedDetails: { word: string; isNegated: boolean; isInverted: boolean }[] = [];

    // Check for negations in proximity (within 3 words prior to token)
    const isNegatedContext = (index: number) => {
      const start = Math.max(0, index - 3);
      const sub = words.slice(start, index);
      return sub.some(w => negationTokens.includes(w));
    };

    // Check for inverted metric context (e.g. unemployment, jobless claims, layoffs) within 4 words
    const isInvertedContext = (index: number) => {
      const start = Math.max(0, index - 4);
      const end = Math.min(words.length, index + 5);
      const sub = words.slice(start, end);
      return sub.some(w => invertedMetricTokens.some(im => w === im || w.startsWith(im)));
    };

    words.forEach((word, idx) => {
      const negated = isNegatedContext(idx);
      const inverted = isInvertedContext(idx);

      if (usBullishTokens.includes(word)) {
        if (inverted) {
          // Inverted metric rose (e.g. "unemployment rose" / "claims jumped") -> US weakness -> USD Bearish / EUR Bullish (+ score)
          matchedDetails.push({ word: `${word} [inverted: unemployment/claims]`, isNegated: negated, isInverted: true });
          detectedTokens.usBearish.push(`${word} [inverted]`);
          itemScore += negated ? -8 : +6;
        } else {
          matchedDetails.push({ word, isNegated: negated, isInverted: false });
          detectedTokens.usBullish.push(word);
          itemScore += negated ? +6 : -8; // US beat = USD Stronger (- score)
        }
      } else if (usBearishTokens.includes(word)) {
        if (inverted) {
          // Inverted metric fell (e.g. "jobless claims declined" / "unemployment slowed") -> US strength -> USD Bullish / EUR Bearish (- score)
          matchedDetails.push({ word: `${word} [inverted: unemployment/claims]`, isNegated: negated, isInverted: true });
          detectedTokens.usBullish.push(`${word} [inverted]`);
          itemScore += negated ? +6 : -8;
        } else {
          matchedDetails.push({ word, isNegated: negated, isInverted: false });
          detectedTokens.usBearish.push(word);
          itemScore += negated ? -8 : +6; // US miss = EUR Stronger (+ score)
        }
      } else if (euBullishTokens.includes(word)) {
        if (inverted) {
          matchedDetails.push({ word: `${word} [inverted]`, isNegated: negated, isInverted: true });
          detectedTokens.euBearish.push(`${word} [inverted]`);
          itemScore += negated ? +8 : -6;
        } else {
          matchedDetails.push({ word, isNegated: negated, isInverted: false });
          detectedTokens.euBullish.push(word);
          itemScore += negated ? -6 : +8; // EU beat = EUR Stronger (+ score)
        }
      } else if (euBearishTokens.includes(word)) {
        if (inverted) {
          matchedDetails.push({ word: `${word} [inverted]`, isNegated: negated, isInverted: true });
          detectedTokens.euBullish.push(`${word} [inverted]`);
          itemScore += negated ? -6 : +8;
        } else {
          matchedDetails.push({ word, isNegated: negated, isInverted: false });
          detectedTokens.euBearish.push(word);
          itemScore += negated ? +8 : -6; // EU miss = USD Stronger (- score)
        }
      }
    });

    // Recency weighting
    const isRecent = item.date?.includes('hour') || item.date?.includes('day');
    const recencyWeight = isRecent ? 1.2 : 1.0;

    // Cap contribution of any single article to max ±20 points
    const cappedScore = Math.max(-20, Math.min(20, itemScore * recencyWeight));
    aggregateSurpriseScore += cappedScore;

    evidence.push({
      headline: item.title,
      url: item.url,
      snippet: item.snippet,
      contentSource,
      charCount: rawContent.length,
      date: item.date,
      scoreContribution: parseFloat(cappedScore.toFixed(1)),
      matchedTokens: Array.from(new Set(matchedDetails.map(m => m.word))),
      isNegated: matchedDetails.some(m => m.isNegated),
      recencyWeight
    });
  }

  const finalSurpriseScore = Math.max(-100, Math.min(100, Number.isFinite(aggregateSurpriseScore) ? aggregateSurpriseScore : 0));

  return {
    score: finalSurpriseScore,
    status: finalSurpriseScore <= -20 ? "US_DATA_SURPASSING_EXPECTATIONS" : finalSurpriseScore >= 20 ? "EU_DATA_SURPASSING_EXPECTATIONS" : "CONSENSUS_BALANCED",
    evidence,
    tokensDetected: {
      usBullish: Array.from(new Set(detectedTokens.usBullish)),
      usBearish: Array.from(new Set(detectedTokens.usBearish)),
      euBullish: Array.from(new Set(detectedTokens.euBullish)),
      euBearish: Array.from(new Set(detectedTokens.euBearish))
    }
  };
}
