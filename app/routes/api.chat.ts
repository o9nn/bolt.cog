import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { MAX_RESPONSE_SEGMENTS, MAX_TOKENS } from '~/lib/.server/llm/constants';
import { CONTINUE_PROMPT } from '~/lib/.server/llm/prompts';
import { streamText, type Messages, type StreamingOptions } from '~/lib/.server/llm/stream-text';
import { hasAPIKey } from '~/lib/.server/llm/api-key';
import SwitchableStream from '~/lib/.server/llm/switchable-stream';
import { cognitiveAgentIntegration } from '~/lib/cognitive/integration';

export async function action(args: ActionFunctionArgs) {
  return chatAction(args);
}

async function chatAction({ context, request }: ActionFunctionArgs) {
  const { messages } = await request.json<{ messages: Messages }>();

  const stream = new SwitchableStream();

  try {
    // check if API key is available
    if (!hasAPIKey(context.cloudflare.env)) {
      // return a helpful error message when API key is missing
      const errorMessage = `
# API Configuration Required

The Anthropic API key is missing. To use this chat feature, you need to:

1. **Set up your API key**: Add your Anthropic API key to the environment
   - For local development: Set \`ANTHROPIC_API_KEY\` in your environment variables
   - For production: Configure \`ANTHROPIC_API_KEY\` in your deployment environment

2. **Get an API key**: If you don't have one, visit [console.anthropic.com](https://console.anthropic.com) to get your API key

3. **Restart the application** after setting the environment variable

## Alternative Options

While the chat feature requires an API key, you can still:
- Explore the code editor and file management features
- Use the terminal and development tools
- Review the cognitive agent architecture (which is running locally)

The cognitive agent network is still operational and can enhance your requests even without the chat API.
      `.trim();

      // create a readable stream with the error message
      const encoder = new TextEncoder();
      const readable = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(errorMessage));
          controller.close();
        },
      });

      return new Response(readable, {
        status: 200,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
        },
      });
    }

    // enhance messages through cognitive agent network
    const enhancedMessages = await cognitiveAgentIntegration.enhanceMessages(messages);

    const options: StreamingOptions = {
      toolChoice: 'none',
      onFinish: async ({ text: content, finishReason }) => {
        if (finishReason !== 'length') {
          // share successful interaction knowledge with agents
          await cognitiveAgentIntegration.shareKnowledge(
            `Successful completion: ${content.slice(0, 100)}...`,
            'heuristic',
          );
          return stream.close();
        }

        if (stream.switches >= MAX_RESPONSE_SEGMENTS) {
          throw Error('Cannot continue message: Maximum segments reached');
        }

        const switchesLeft = MAX_RESPONSE_SEGMENTS - stream.switches;

        console.log(`Reached max token limit (${MAX_TOKENS}): Continuing message (${switchesLeft} switches left)`);

        enhancedMessages.push({ role: 'assistant', content });
        enhancedMessages.push({ role: 'user', content: CONTINUE_PROMPT });

        const result = await streamText(enhancedMessages, context.cloudflare.env, options);

        return stream.switchSource(result.toAIStream());
      },
    };

    const result = await streamText(enhancedMessages, context.cloudflare.env, options);

    stream.switchSource(result.toAIStream());

    return new Response(stream.readable, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
      },
    });
  } catch (error) {
    console.log(error);

    throw new Response(null, {
      status: 500,
      statusText: 'Internal Server Error',
    });
  }
}
