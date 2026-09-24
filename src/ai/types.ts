// ============================================================================
// MODULAR AI LAYER INTERFACES & TYPES
// Strictly qualitative semantic classifications - zero arithmetic
// ============================================================================

export type PolicyBias =
  | 'HAWKISH_USD'
  | 'DOVISH_USD'
  | 'HAWKISH_EUR'
  | 'DOVISH_EUR'
  | 'NEUTRAL';

export type IntensityLevel = 'HIGH' | 'MEDIUM' | 'LOW';

export interface ArticleClassificationInput {
  id: number;
  title: string;
  source: string;
  content: string;
}

export interface ArticleSemanticOutput {
  id: number;
  policyBias: PolicyBias;
  intensity: IntensityLevel;
  driver: string;
}

export interface AIClassificationProvider {
  name: string;
  classifyArticles(
    articles: ArticleClassificationInput[]
  ): Promise<Map<number, ArticleSemanticOutput> | null>;
}
