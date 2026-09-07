# Two Step

A simple React chat interface that improves a request with Claude Opus 5, then answers it with GPT-5.6 Sol through OpenRouter.

## Run locally

Requires Node.js 22.13+ (Node 22.18+ for the TypeScript tests) and an exported `OPENROUTER_API_KEY` in your shell's global environment.

```sh
npm install
npm run dev
```

The server inherits the key from the environment. It is never sent to the browser, stored in chat history, or included in build output. The local Cloudflare Worker receives the key only while running the development server. Production reads an independently configured Sites secret.

## Prompts and agent boundaries

The exact editable default prompts are in `lib/prompts.ts`. Open **System prompts** in the sidebar to read, edit, save, or reset both prompts. Changes are local to your browser and take effect on the next message. Each request also adds the current UTC date and, when applicable, the fact that web search is disabled.

1. **Improve** — `anthropic/claude-opus-5`, low reasoning effort, a maximum of one search step. It sees its own system prompt, recent normal conversation history, and the latest original user message. It returns only an improved request.
2. **Answer** — `openai/gpt-5.6-sol`, medium reasoning effort, up to six search steps. It receives its own system prompt, normal conversation history, and the improved request as the latest user message. It receives no information about the improvement process: no original latest prompt, improver system instructions, reasoning, tool calls, or tool results. The improved request is shown separately in the interface for inspection.

There are two application-level LLM requests per turn. OpenRouter runs each model's reason–act–observe tool loop internally, so searches can entail additional provider inference steps. The improver's single permitted search is enforced with both `max_tool_calls: 1` and `max_uses: 1`, rather than only a prompt instruction. A specific number of internal reasoning passes cannot be guaranteed by model parameters.

Both agents use OpenRouter's hosted `openrouter:web_search` tool with Exa. It needs no separate search API key. Switching off **Web search** removes tools from both requests. This tool is currently a beta OpenRouter feature.

The improver preserves intent, avoids invented preferences, keeps small tasks small, and delegates essential clarification to the answering agent. It improves instructions without trying to produce the answer first.

## Interface

Streaming Markdown answers, links and source citations, an expandable improved request, prompt editing, web search, stop, retry, copy, and responsive chat navigation. Conversations and prompt settings are saved locally in this browser; they do not sync across devices. New chats and deletion are available in the sidebar. No chat database is used.

## Validation

```sh
npm test
npm run typecheck
npm run lint
npm run build
```

Tests cover context isolation, search limits, search-off behavior, malformed inputs, history limits, provider failures, cancellation, unsafe citations, and UTF-8 streaming. Lint covers application code; unmodified generated UI primitives and their generated mobile hook are excluded from the starter's incompatible lint rules.

Live checks exercised the actual Opus → Sol path both with search disabled and with hosted web search producing source links. The prompts are a starting point; these checks establish integration behavior, not a measured quality improvement over a single model. Compare representative user tasks before making quality claims.

Requests have a four-minute timeout, limits on request and history size, and bounded tools and output tokens. The history window retains up to 24 recent messages / 80,000 characters. A failed first step surfaces an error without silently changing models or skipping improvement. Partial answers are retained for follow-up questions. Stopping cancels the in-flight upstream request, though provider work already completed may still be billed. API and search charges use the configured OpenRouter account.

## Sources

- [Claude Opus 5 on OpenRouter](https://openrouter.ai/anthropic/claude-opus-5)
- [GPT-5.6 Sol on OpenRouter](https://openrouter.ai/openai/gpt-5.6-sol)
- [OpenAI's GPT-5.6 Sol documentation](https://developers.openai.com/api/docs/models/gpt-5.6-sol)
- [OpenRouter hosted web search and tool limits](https://openrouter.ai/docs/guides/features/server-tools/web-search)
