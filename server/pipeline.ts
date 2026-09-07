import {
  DEFAULT_PROMPTS,
  MODELS,
  type PromptSettings,
} from '../lib/prompts.ts';
import type { ChatEvent, Citation, HistoryMessage } from '../lib/chat-types.ts';
import { readSSE } from '../lib/sse.ts';

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
export type ChatInput = {
  message: string;
  history: HistoryMessage[];
  webSearch: boolean;
  prompts: PromptSettings;
};
export class ChatError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = 'ChatError';
    this.status = status;
  }
}

export function parseInput(value: unknown): ChatInput {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ChatError('Send a message to begin.', 400);
  const body = value as Record<string, unknown>;
  if (typeof body.message !== 'string' || !body.message.trim())
    throw new ChatError('Please enter a message.', 400);
  if (body.message.length > 20000)
    throw new ChatError(
      'Please keep your message under 20,000 characters.',
      400,
    );
  if (body.webSearch !== undefined && typeof body.webSearch !== 'boolean')
    throw new ChatError('The web search setting is invalid.', 400);
  if (body.history !== undefined && !Array.isArray(body.history))
    throw new ChatError('This chat history could not be read.', 400);
  const history: HistoryMessage[] = [];
  for (const entry of (body.history as unknown[] | undefined) ?? []) {
    if (!entry || typeof entry !== 'object')
      throw new ChatError('This chat history could not be read.', 400);
    const m = entry as Record<string, unknown>;
    if (
      (m.role !== 'user' && m.role !== 'assistant') ||
      typeof m.content !== 'string'
    )
      throw new ChatError(
        'This chat history contains an invalid message.',
        400,
      );
    // Deliberately construct clean messages; never forward UI metadata,
    // reasoning, annotations, tool messages, or a client-supplied system role.
    if (m.content.trim()) history.push({ role: m.role, content: m.content });
  }
  // Keep a bounded recent history, starting with a complete user turn.
  let size = 0;
  const recent: HistoryMessage[] = [];
  for (const message of history.slice(-24).reverse()) {
    if (size + message.content.length > 80000) break;
    recent.unshift(message);
    size += message.content.length;
  }
  while (recent[0]?.role === 'assistant') recent.shift();
  const prompts = { ...DEFAULT_PROMPTS };
  if (body.prompts !== undefined) {
    if (
      !body.prompts ||
      typeof body.prompts !== 'object' ||
      Array.isArray(body.prompts)
    )
      throw new ChatError('The system prompts are invalid.', 400);
    const overrides = body.prompts as Record<string, unknown>;
    for (const key of ['improver', 'answerer'] as const) {
      const text = overrides[key];
      if (text !== undefined) {
        if (typeof text !== 'string' || !text.trim() || text.length > 12000)
          throw new ChatError(
            'Each system prompt must contain 1–12,000 characters.',
            400,
          );
        prompts[key] = text.trim();
      }
    }
  }
  return {
    message: body.message.trim(),
    history: recent,
    webSearch: body.webSearch !== false,
    prompts,
  };
}

function searchTools(maxUses: number) {
  return [
    {
      type: 'openrouter:web_search',
      parameters: {
        engine: 'exa',
        max_results: 3,
        max_total_results: maxUses * 3,
        max_uses: maxUses,
      },
    },
  ];
}

export function buildRequests(
  input: ChatInput,
  improvedPrompt: string | null,
  date = new Date().toISOString().slice(0, 10),
) {
  const improving = improvedPrompt === null;
  const system = improving ? input.prompts.improver : input.prompts.answerer;
  return {
    model: improving ? MODELS.improver.id : MODELS.answerer.id,
    messages: [
      {
        role: 'system',
        content: `${system}\n\nCurrent date (UTC): ${date}.${input.webSearch ? '' : '\nWeb search is disabled for this turn. Do not claim to have searched or verified current facts.'}`,
      },
      ...input.history.map(({ role, content }) => ({ role, content })),
      { role: 'user', content: improving ? input.message : improvedPrompt },
    ],
    stream: !improving,
    ...(improving ? {} : { stream_options: { include_usage: true } }),
    reasoning: { effort: improving ? 'low' : 'medium', exclude: true },
    max_tokens: improving ? 4096 : 12288,
    ...(input.webSearch
      ? {
          tools: searchTools(improving ? 1 : 6),
          max_tool_calls: improving ? 1 : 6,
        }
      : {}),
  };
}

async function request(
  body: ReturnType<typeof buildRequests>,
  key: string,
  signal: AbortSignal,
  fetcher: typeof fetch,
) {
  signal.throwIfAborted();
  const result = await fetcher(ENDPOINT, {
    method: 'POST',
    signal,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'X-OpenRouter-Title': 'Two Step',
    },
    body: JSON.stringify(body),
  });
  if (!result.ok) {
    await result.body?.cancel();
    // Do not echo upstream bodies: they can contain prompt data or credentials.
    const messages: Record<number, string> = {
      400: 'OpenRouter rejected this request. Check the configured model and tool settings.',
      401: 'OpenRouter could not authenticate. Check the server API key.',
      402: 'The OpenRouter account needs credits before this chat can continue.',
      403: 'This model or request is not available to the OpenRouter account.',
      404: 'The requested model is unavailable on OpenRouter. No substitute was used.',
      429: 'OpenRouter is busy or the rate limit was reached. Please try again shortly.',
    };
    throw new ChatError(
      messages[result.status] ??
        'The model provider could not complete this request. Please try again.',
    );
  }
  return result;
}

function addCitations(annotations: unknown, citations: Map<string, Citation>) {
  if (!Array.isArray(annotations)) return;
  for (const annotation of annotations) {
    const citation = annotation?.url_citation ?? annotation;
    if (typeof citation?.url !== 'string') continue;
    try {
      const url = new URL(citation.url);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
      citations.set(url.href, {
        url: url.href,
        title:
          typeof citation.title === 'string' ? citation.title : url.hostname,
      });
    } catch {
      /* Ignore invalid or unsafe provider links. */
    }
  }
}

/** Two isolated model requests. OpenRouter owns each bounded tool-use loop. */
export async function runPipeline(
  input: ChatInput,
  key: string,
  signal: AbortSignal,
  emit: (event: ChatEvent) => void,
  fetcher: typeof fetch = fetch,
) {
  const started = Date.now();
  emit({ type: 'stage', stage: 'improving' });
  const improvedResponse = await request(
    buildRequests(input, null),
    key,
    signal,
    fetcher,
  );
  const improved = (await improvedResponse.json()) as {
    error?: unknown;
    choices?: { message?: { content?: string }; finish_reason?: string }[];
  };
  if (improved.error)
    throw new ChatError(
      'The first model could not clarify this request. Please try again.',
    );
  const choice = improved.choices?.[0];
  if (choice?.finish_reason === 'length')
    throw new ChatError(
      'The improved request exceeded its limit. Try a shorter message.',
    );
  const prompt = choice?.message?.content?.trim();
  if (!prompt || choice?.finish_reason === 'tool_calls')
    throw new ChatError(
      'The first model did not return a complete request. Please try again.',
    );
  signal.throwIfAborted();
  emit({ type: 'improved', prompt });
  emit({ type: 'stage', stage: 'answering' });
  // Only the rewritten text crosses the boundary. The original latest message,
  // improver system prompt, reasoning, tool trace, and search results do not.
  const answer = await request(
    buildRequests(input, prompt),
    key,
    signal,
    fetcher,
  );
  if (!answer.body)
    throw new ChatError('The answering model returned an empty stream.');
  const citations = new Map<string, Citation>();
  let textLength = 0,
    completed = false,
    finishReason: string | undefined,
    searchCount: number | undefined;
  for await (const data of readSSE(answer.body)) {
    signal.throwIfAborted();
    if (data === '[DONE]') {
      completed = true;
      break;
    }
    const chunk = JSON.parse(data) as {
      error?: unknown;
      choices?: {
        delta?: { content?: string; annotations?: unknown };
        message?: { annotations?: unknown };
        finish_reason?: string;
      }[];
      usage?: { server_tool_use?: { web_search_requests?: number } };
    };
    if (chunk.error)
      throw new ChatError(
        'The answering model stopped unexpectedly. Please try again.',
      );
    const item = chunk.choices?.[0];
    // Reasoning deltas and raw tool-call events are intentionally never emitted.
    if (typeof item?.delta?.content === 'string' && item.delta.content) {
      textLength += item.delta.content.length;
      emit({ type: 'delta', text: item.delta.content });
    }
    addCitations(
      item?.delta?.annotations ?? item?.message?.annotations,
      citations,
    );
    if (item?.finish_reason) finishReason = item.finish_reason;
    const searches = chunk.usage?.server_tool_use?.web_search_requests;
    if (typeof searches === 'number') searchCount = searches;
  }
  if (finishReason === 'length')
    throw new ChatError(
      'The answer reached its length limit. Ask the assistant to continue.',
    );
  if (finishReason === 'tool_calls')
    throw new ChatError(
      'The search loop could not complete. Please try again.',
    );
  if (!completed || !textLength)
    throw new ChatError(
      'The connection ended before a complete answer arrived. Please try again.',
    );
  emit({
    type: 'done',
    citations: [...citations.values()],
    searchCount,
    seconds: Math.round((Date.now() - started) / 100) / 10,
  });
}
