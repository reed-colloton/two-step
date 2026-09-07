import { getApiKey } from '@/server/config';
import { ChatError, parseInput, runPipeline } from '@/server/pipeline';
import type { ChatEvent } from '@/lib/chat-types';

async function readBody(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new ChatError('Please enter a message.', 400);
  const decoder = new TextDecoder();
  let bytes = 0,
    body = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 250000) {
        await reader.cancel();
        throw new ChatError(
          'This chat is too large. Please start a new chat.',
          413,
        );
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    return JSON.parse(body);
  } catch (error) {
    if (error instanceof ChatError) throw error;
    throw new ChatError('The chat request could not be read.', 400);
  } finally {
    reader.releaseLock();
  }
}

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  if (
    request.headers.get('sec-fetch-site') === 'cross-site' ||
    (origin && origin !== new URL(request.url).origin)
  ) {
    return Response.json(
      { error: 'Please send messages from the chat page.' },
      { status: 403 },
    );
  }
  const key = getApiKey();
  if (!key)
    return Response.json(
      { error: 'The server needs an OPENROUTER_API_KEY before you can chat.' },
      { status: 503 },
    );
  let input;
  try {
    input = parseInput(await readBody(request));
  } catch (error) {
    return Response.json(
      {
        error: error instanceof ChatError ? error.message : 'Invalid request.',
      },
      { status: error instanceof ChatError ? error.status : 400 },
    );
  }

  const controller = new AbortController();
  const signal = AbortSignal.any([
    request.signal,
    controller.signal,
    AbortSignal.timeout(240000),
  ]);
  const encoder = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    start(output) {
      const emit = (event: ChatEvent) => {
        if (!closed)
          output.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      const heartbeat = setInterval(() => {
        if (!closed) output.enqueue(encoder.encode(': heartbeat\n\n'));
      }, 15000);
      void runPipeline(input, key, signal, emit)
        .catch((error) => {
          if (!closed)
            emit({
              type: 'error',
              message: signal.aborted
                ? 'This response timed out or was stopped. Please try again.'
                : error instanceof ChatError
                  ? error.message
                  : 'The connection to OpenRouter failed. Please try again.',
            });
        })
        .finally(() => {
          clearInterval(heartbeat);
          if (!closed) {
            closed = true;
            output.close();
          }
        });
    },
    cancel() {
      closed = true;
      controller.abort();
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
