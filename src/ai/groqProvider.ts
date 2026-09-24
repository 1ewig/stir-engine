import {
  AIClassificationProvider,
  ArticleClassificationInput,
  ArticleSemanticOutput,
  PolicyBias,
  IntensityLevel
} from './types';

// ============================================================================
// GROQ AI PROVIDER IMPLEMENTATION (qwen/qwen3.8-27b)
// Ultra-fast (~500ms), zero math, strictly semantic qualitative extraction
// ============================================================================

export class GroqAIProvider implements AIClassificationProvider {
  public name = 'Groq_Qwen3.8_27B';
  private model: string;
  private timeoutMs: number;

  constructor(model = 'qwen/qwen3.8-27b', timeoutMs = 4000) {
    this.model = model;
    this.timeoutMs = timeoutMs;
  }

  async classifyArticles(
    articles: ArticleClassificationInput[]
  ): Promise<Map<number, ArticleSemanticOutput> | null> {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey || articles.length === 0) {
      return null;
    }

    const systemPrompt = `You are an elite FX macro policy analyst. Your role is strictly qualitative semantic classification.
DO NOT calculate scores, math, or arithmetic.
For each article, determine:
- policyBias: "HAWKISH_USD" | "DOVISH_USD" | "HAWKISH_EUR" | "DOVISH_EUR" | "NEUTRAL"
- intensity: "HIGH" | "MEDIUM" | "LOW"
- driver: Brief 3-8 word summary of the macro catalyst

Guidelines:
- Strong US data / sticky US inflation / delay of Fed cuts = HAWKISH_USD (Bearish EUR/USD)
- Weaker US data / rising Fed rate cut bets = DOVISH_USD (Bullish EUR/USD)
- Sticky Eurozone inflation / ECB hiking / ECB delaying rate cuts = HAWKISH_EUR (Bullish EUR/USD)
- Eurozone slowdown / ECB cutting rates = DOVISH_EUR (Bearish EUR/USD)
- Watch out for negations ("Fed not expected to hike" -> NEUTRAL)

Respond ONLY with valid JSON matching this schema:
{
  "classifications": [
    { "id": number, "policyBias": string, "intensity": string, "driver": string }
  ]
}`;

    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: JSON.stringify(articles) }
          ],
          response_format: { type: 'json_object' },
          temperature: 0.1,
          max_tokens: 700
        }),
        signal: AbortSignal.timeout(this.timeoutMs)
      });

      if (!res.ok) {
        console.warn(`[GroqAIProvider] API returned HTTP ${res.status}. Fallback activated.`);
        return null;
      }

      const data = await res.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) return null;

      const parsed = JSON.parse(content);
      if (!Array.isArray(parsed.classifications)) return null;

      const results = new Map<number, ArticleSemanticOutput>();
      for (const item of parsed.classifications) {
        if (typeof item.id === 'number' && item.policyBias) {
          const bias = (['HAWKISH_USD', 'DOVISH_USD', 'HAWKISH_EUR', 'DOVISH_EUR', 'NEUTRAL'].includes(item.policyBias)
            ? item.policyBias
            : 'NEUTRAL') as PolicyBias;

          const intensity = (['HIGH', 'MEDIUM', 'LOW'].includes(item.intensity)
            ? item.intensity
            : 'MEDIUM') as IntensityLevel;

          results.set(item.id, {
            id: item.id,
            policyBias: bias,
            intensity,
            driver: typeof item.driver === 'string' ? item.driver : ''
          });
        }
      }

      return results;
    } catch (err: any) {
      console.warn(`[GroqAIProvider] Semantic classification bypassed (${err?.message || 'timeout'}). Fallback activated.`);
      return null;
    }
  }
}
