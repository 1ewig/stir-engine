import {
  AIClassificationProvider,
  ArticleClassificationInput,
  ArticleSemanticOutput
} from './types';
import { GroqAIProvider } from './groqProvider';

export * from './types';
export * from './groqProvider';

// ============================================================================
// MODULAR AI ENGINE FACADE
// Pluggable provider architecture: defaults to Groq Qwen, effortlessly swappable
// ============================================================================

let activeProvider: AIClassificationProvider = new GroqAIProvider();

/**
 * Configure or swap the active AI classification provider (e.g. OpenAI, Anthropic, Local LLM)
 */
export function setAIProvider(provider: AIClassificationProvider) {
  activeProvider = provider;
}

/**
 * Get the currently active AI provider instance
 */
export function getActiveAIProvider(): AIClassificationProvider {
  return activeProvider;
}

/**
 * Perform qualitative semantic classification on a batch of macro news articles.
 * Strictly returns qualitative labels (bias, intensity, driver).
 * Math & scoring are left to the consuming quantitative engine.
 */
export async function classifyArticlesWithAI(
  articles: ArticleClassificationInput[]
): Promise<Map<number, ArticleSemanticOutput> | null> {
  if (!articles || articles.length === 0) return null;
  return await activeProvider.classifyArticles(articles);
}
