import { env } from 'cloudflare:workers';

export function getApiKey(): string {
  return (
    (
      (env as Record<string, unknown>).OPENROUTER_API_KEY as string | undefined
    )?.trim() ?? ''
  );
}
