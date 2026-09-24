import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

/**
 * Pure TypeScript quantitative scoring function
 * Takes discrete semantic classifications from LLM and calculates 100% deterministic math
 */
export function calculateSentimentMath(classifications: Array<{
  id: number;
  policyBias: 'HAWKISH_USD' | 'DOVISH_USD' | 'HAWKISH_EUR' | 'DOVISH_EUR' | 'NEUTRAL';
  intensity: 'HIGH' | 'MEDIUM' | 'LOW';
  driver: string;
}>): {
  articleScores: Array<{ id: number; score: number; bias: string; driver: string }>;
  aggregateScore: number;
  bias: 'USD_BULLISH' | 'EUR_BULLISH' | 'NEUTRAL';
} {
  if (!classifications || classifications.length === 0) {
    return { articleScores: [], aggregateScore: 0, bias: 'NEUTRAL' };
  }

  // Pure deterministic mathematical coefficients
  const INTENSITY_WEIGHTS: Record<string, number> = {
    HIGH: 1.0,
    MEDIUM: 0.65,
    LOW: 0.35
  };

  // Directional signs: Negative = USD Advantage (Bearish EUR/USD), Positive = EUR Advantage (Bullish EUR/USD)
  const DIRECTION_SIGNS: Record<string, number> = {
    HAWKISH_USD: -1.0,  // Higher US rates/growth -> Dollar up -> EUR/USD down
    DOVISH_EUR: -1.0,   // Eurozone weakness/ECB cuts -> Euro down -> EUR/USD down
    HAWKISH_EUR: +1.0,  // Higher ECB rates/growth -> Euro up -> EUR/USD up
    DOVISH_USD: +1.0,   // Lower US rates/growth -> Dollar down -> EUR/USD up
    NEUTRAL: 0.0
  };

  let totalPoints = 0;
  const articleScores = classifications.map((c) => {
    const dir = DIRECTION_SIGNS[c.policyBias] ?? 0;
    const mag = INTENSITY_WEIGHTS[c.intensity] ?? 0.5;
    const rawScore = parseFloat((dir * mag).toFixed(2));
    totalPoints += rawScore;
    return {
      id: c.id,
      score: rawScore,
      bias: c.policyBias,
      driver: c.driver
    };
  });

  // Calculate arithmetic mean across articles
  const meanScore = totalPoints / classifications.length;
  // Scale to continuous -100 to +100 range with strict bounds
  const aggregateScore = parseFloat((Math.max(-100, Math.min(100, meanScore * 100))).toFixed(1));

  const bias: 'USD_BULLISH' | 'EUR_BULLISH' | 'NEUTRAL' =
    aggregateScore <= -20 ? 'USD_BULLISH' : aggregateScore >= 20 ? 'EUR_BULLISH' : 'NEUTRAL';

  return { articleScores, aggregateScore, bias };
}

// Test with our benchmark results
const mockQwenOutput = [
  { id: 5, policyBias: "DOVISH_EUR" as const, intensity: "HIGH" as const, driver: "German manufacturing collapse" },
  { id: 6, policyBias: "HAWKISH_USD" as const, intensity: "MEDIUM" as const, driver: "Fed delays cuts citing solid labor" },
  { id: 7, policyBias: "HAWKISH_USD" as const, intensity: "HIGH" as const, driver: "Hot core inflation beats forecasts" },
  { id: 8, policyBias: "HAWKISH_EUR" as const, intensity: "MEDIUM" as const, driver: "ECB warns against premature cuts" }
];

const result = calculateSentimentMath(mockQwenOutput);
console.log("\n=== DETERMINISTIC TYPESCRIPT MATHEMATICAL OUTPUT ===");
console.log(JSON.stringify(result, null, 2));
