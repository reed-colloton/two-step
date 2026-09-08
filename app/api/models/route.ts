import { parseModelCatalog, type ModelOption } from '@/lib/models';

let cached: { models: ModelOption[]; expires: number } | undefined;

export async function GET() {
  try {
    if (!cached || cached.expires < Date.now()) {
      const response = await fetch('https://openrouter.ai/api/v1/models', {
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error('Model catalog unavailable');
      const models = parseModelCatalog(await response.json());
      cached = { models, expires: Date.now() + 600000 };
    }
    return Response.json(
      { models: cached.models },
      { headers: { 'Cache-Control': 'public, max-age=300' } },
    );
  } catch {
    return Response.json(
      { error: 'The model list is unavailable. Please try again.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
