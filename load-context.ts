import { type PlatformProxy } from 'wrangler';
import type { createAgentZeroTools } from './app/lib/.server/agent-zero-tools';

type Cloudflare = Omit<PlatformProxy<Env>, 'dispose'>;

declare module '@remix-run/cloudflare' {
  interface AppLoadContext {
    cloudflare: Cloudflare;
    desktop?: {
      workspaceId: 'desktop';
      createTools(requestId: string, signal: AbortSignal): ReturnType<typeof createAgentZeroTools>;
    };
  }
}
