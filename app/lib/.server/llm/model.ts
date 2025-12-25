import { createAnthropic } from '@ai-sdk/anthropic';

export function getAnthropicModel(apiKey: string) {
  const anthropic = createAnthropic({
    apiKey,
  });

  // Use claude-3-haiku-20240307 - fast and efficient model
  return anthropic('claude-3-haiku-20240307');
}
