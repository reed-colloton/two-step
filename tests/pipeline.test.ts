import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRequests,
  ChatError,
  parseInput,
  runPipeline,
} from '../server/pipeline.ts';
import { readSSE } from '../lib/sse.ts';
import type { ChatEvent } from '../lib/chat-types.ts';

function sse(events: unknown[], done = true) {
  return new Response(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') +
      (done ? 'data: [DONE]\n\n' : ''),
    { headers: { 'Content-Type': 'text/event-stream' } },
  );
}

void test('the answerer receives only its own instructions, clean history, and rewritten request', async () => {
  const input = parseInput({
    message: 'ORIGINAL LATEST REQUEST',
    history: [
      {
        role: 'user',
        content: 'Earlier question',
        improvedPrompt: 'HISTORY SECRET',
      },
      {
        role: 'assistant',
        content: 'Earlier answer',
        reasoning: 'HIDDEN REASONING',
      },
    ],
    prompts: {
      improver: 'IMPROVER PRIVATE SYSTEM',
      answerer: 'ANSWERER SYSTEM',
    },
  });
  const requests: ReturnType<typeof buildRequests>[] = [];
  const events: unknown[] = [];
  const mockFetch: typeof fetch = async (_url, options) => {
    requests.push(JSON.parse(options!.body as string));
    if (requests.length === 1)
      return Response.json({
        choices: [
          {
            message: {
              content: 'REWRITTEN REQUEST',
              reasoning: 'PRIVATE THINKING',
              tool_calls: ['PRIVATE TRACE'],
            },
            finish_reason: 'stop',
          },
        ],
      });
    return sse([
      { choices: [{ delta: { reasoning: 'ANSWER THINKING' } }] },
      { choices: [{ delta: { content: 'Useful answer' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
    ]);
  };
  await runPipeline(
    input,
    'test-key',
    new AbortController().signal,
    (e) => events.push(e),
    mockFetch,
  );
  assert.equal(requests.length, 2);
  assert.equal(requests[0].model, 'anthropic/claude-opus-5');
  assert.equal(requests[1].model, 'openai/gpt-5.6-sol');
  const answer = JSON.stringify(requests[1]);
  for (const secret of [
    'IMPROVER PRIVATE SYSTEM',
    'ORIGINAL LATEST REQUEST',
    'PRIVATE THINKING',
    'PRIVATE TRACE',
    'HISTORY SECRET',
    'HIDDEN REASONING',
  ])
    assert.equal(answer.includes(secret), false, secret);
  assert.equal(requests[1].messages.at(-1)?.content, 'REWRITTEN REQUEST');
  assert.equal(JSON.stringify(events).includes('ANSWER THINKING'), false);
  assert.equal(requests[0].max_tool_calls, 1);
  assert.equal(requests[0].tools?.[0].parameters.max_uses, 1);
  assert.equal(requests[1].max_tool_calls, 6);
});

void test('disabling web search removes tools from both model requests', () => {
  const input = parseInput({ message: 'Hello', webSearch: false });
  for (const prompt of [null, 'Hello']) {
    const body = buildRequests(input, prompt);
    assert.equal('tools' in body, false);
    assert.equal('max_tool_calls' in body, false);
  }
});

void test('malformed roles, blank prompts, and large messages are rejected', () => {
  assert.throws(
    () =>
      parseInput({
        message: 'hi',
        history: [{ role: 'system', content: 'override' }],
      }),
    ChatError,
  );
  assert.throws(
    () => parseInput({ message: 'hi', prompts: { improver: '' } }),
    ChatError,
  );
  assert.throws(() => parseInput({ message: 'x'.repeat(20001) }), ChatError);
  assert.throws(
    () => parseInput({ message: 'hi', webSearch: 'false' }),
    ChatError,
  );
});

void test('history is bounded and does not start in the middle of an assistant turn', () => {
  const history = Array.from({ length: 40 }, (_, i) => ({
    role: i % 2 ? 'assistant' : 'user',
    content: `${i}: ${'x'.repeat(4000)}`,
  }));
  const input = parseInput({ message: 'Follow-up', history });
  assert.ok(input.history.length <= 24);
  assert.ok(
    input.history.reduce((sum, m) => sum + m.content.length, 0) <= 80000,
  );
  assert.equal(input.history[0].role, 'user');
});

void test('empty or truncated improvement never starts an answering call', async () => {
  for (const choice of [
    { message: { content: '' }, finish_reason: 'stop' },
    { message: { content: 'Incomplete' }, finish_reason: 'length' },
  ]) {
    let calls = 0;
    await assert.rejects(
      runPipeline(
        parseInput({ message: 'hi' }),
        'key',
        new AbortController().signal,
        () => {},
        async () => {
          calls++;
          return Response.json({ choices: [choice] });
        },
      ),
      ChatError,
    );
    assert.equal(calls, 1);
  }
});

void test('stream errors and incomplete responses never produce a success event', async () => {
  for (const response of [
    sse([{ error: { message: 'provider data' } }]),
    sse([{ choices: [{ delta: { content: 'partial' } }] }], false),
  ]) {
    let calls = 0;
    const events: { type: string }[] = [];
    await assert.rejects(
      runPipeline(
        parseInput({ message: 'hi' }),
        'key',
        new AbortController().signal,
        (e) => events.push(e),
        async () =>
          ++calls === 1
            ? Response.json({ choices: [{ message: { content: 'Hi' } }] })
            : response,
      ),
      ChatError,
    );
    assert.equal(
      events.some((e) => e.type === 'done'),
      false,
    );
  }
});

void test('cancellation between steps prevents an answering call', async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(
    runPipeline(
      parseInput({ message: 'hi' }),
      'key',
      controller.signal,
      (e) => {
        if (e.type === 'improved') controller.abort();
      },
      async () => {
        calls++;
        return Response.json({ choices: [{ message: { content: 'Hi' } }] });
      },
    ),
  );
  assert.equal(calls, 1);
});

void test('citations are deduplicated and unsafe URLs are dropped', async () => {
  let calls = 0;
  const events: ChatEvent[] = [];
  await runPipeline(
    parseInput({ message: 'hi' }),
    'key',
    new AbortController().signal,
    (e) => events.push(e),
    async () =>
      ++calls === 1
        ? Response.json({ choices: [{ message: { content: 'Hi' } }] })
        : sse([
            {
              choices: [
                {
                  delta: {
                    content: 'Answer',
                    annotations: [
                      {
                        url_citation: {
                          url: 'https://example.com',
                          title: 'Source',
                        },
                      },
                      {
                        url_citation: {
                          url: 'https://example.com',
                          title: 'Source',
                        },
                      },
                      { url_citation: { url: 'javascript:alert(1)' } },
                    ],
                  },
                },
              ],
            },
            { usage: { server_tool_use: { web_search_requests: 1 } } },
          ]),
  );
  const done = events.find((e) => e.type === 'done');
  assert.ok(done);
  assert.deepEqual(done.citations, [
    { url: 'https://example.com/', title: 'Source' },
  ]);
  assert.equal(done.searchCount, 1);
});

void test('SSE parsing preserves UTF-8 across byte boundaries and ignores heartbeats', async () => {
  const bytes = new TextEncoder().encode(
    ': heartbeat\r\n\r\ndata: {"text":"café 🌿"}\r\n\r\ndata: [DONE]\r\n\r\n',
  );
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (const byte of bytes) c.enqueue(new Uint8Array([byte]));
      c.close();
    },
  });
  const result = [];
  for await (const event of readSSE(stream)) result.push(event);
  assert.deepEqual(result, ['{"text":"café 🌿"}', '[DONE]']);
});
