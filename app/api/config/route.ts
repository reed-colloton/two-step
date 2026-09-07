import { getApiKey } from '@/server/config';

export function GET() {
  return Response.json(
    { configured: Boolean(getApiKey()) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
