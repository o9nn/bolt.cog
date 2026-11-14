import { streamText as _streamText, convertToCoreMessages } from 'ai';
import { getModel } from '~/lib/.server/llm/model';
import { MAX_TOKENS } from './constants';
import { getSystemPrompt } from './prompts';

interface ToolResult<Name extends string, Args, Result> {
  state: 'result';
  toolCallId: string;
  toolName: Name;
  args: Args;
  result: Result;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  toolInvocations?: ToolResult<string, unknown, unknown>[];
}

export type Messages = Message[];
export type StreamTextOptions = Omit<Parameters<typeof _streamText>[0], 'model'>;
export type StreamingOptions = StreamTextOptions;

export function streamText(messages: Messages, env: Env, options?: StreamTextOptions) {
  return _streamText({
    system: getSystemPrompt(),
    maxTokens: MAX_TOKENS,
    messages: convertToCoreMessages(messages),
    ...options,

    // the provider/model always comes from trusted server configuration, not request options
    model: getModel(env),
  });
}
