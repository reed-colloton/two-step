# Two Step

A simple React chat interface that improves a request, then answers it through OpenRouter. The default models are Claude Opus 5 and Claude Sonnet 5.

![Two Step chat interface](docs/screenshot.jpg)

## Run locally

Requires Node.js 22.13+ (Node 22.18+ for the TypeScript tests) and an exported `OPENROUTER_API_KEY` in your shell's global environment.

```sh
npm install
npm run dev
```

The server inherits the key from the environment. It is never sent to the browser, stored in chat history, or included in build output. The local Cloudflare Worker receives the key only while running the development server. Production reads an independently configured Sites secret.

## Prompts and agent boundaries

Open **Settings** to choose a model and edit the system prompt for each step. Model choices and prompts are saved in this browser and apply to the next message. The text above the message box reflects the saved model choices. Closing settings without saving discards drafts; **Reset defaults** resets both models and prompts when saved. Existing saved prompts are preserved.

The searchable model list comes from OpenRouter's public catalog and includes text models that support tools and reasoning. Model names are cached in local storage so saved selections display without waiting for the network. Labels stay hidden until saved settings and their names are restored, avoiding a flash of default names on reload. If the catalog is unavailable, cached models (or the initial defaults and GPT-5.6 Sol) remain selectable, with a retry control to reload the list. The API key stays on the server. Model IDs are validated and sent separately for each step; an unavailable selected model produces an error without silently substituting another model.

The exact default prompts are in `lib/prompts.ts`. Each request also adds the current UTC date and, when applicable, the fact that web search is disabled. Defaults and step limits:

1. **Improve** — defaults to `anthropic/claude-opus-5`, low reasoning effort, a maximum of one search step. It sees its own system prompt, recent normal conversation history, and the latest original user message. It returns only an improved request.
2. **Answer** — defaults to `anthropic/claude-sonnet-5`, high reasoning effort, up to six search steps. It receives its own system prompt, normal conversation history, and the improved request as the latest user message. It receives no information about the improvement process: no original latest prompt, improver system instructions, reasoning, tool calls, or tool results. The improved request is shown separately in the interface for inspection.

There are two application-level LLM requests per turn. OpenRouter runs each model's reason–act–observe tool loop internally, so searches can entail additional provider inference steps. The improver's single permitted search is enforced with both `max_tool_calls: 1` and `max_uses: 1`, rather than only a prompt instruction. A specific number of internal reasoning passes cannot be guaranteed by model parameters.

Both agents use OpenRouter's hosted `openrouter:web_search` tool with Exa. It needs no separate search API key. Switching off **Search** removes tools from both requests. This tool is currently a beta OpenRouter feature.

The improver preserves intent, avoids invented preferences, keeps small tasks small, and delegates essential clarification to the answering agent. It improves instructions without trying to produce the answer first.

## Interface

Streaming Markdown answers, links and source citations, an expandable improved request, model selection, prompt editing, web search, stop, retry, copy, and responsive chat navigation. Conversations, models, and prompt settings are saved locally in this browser; they do not sync across devices. New chats and deletion are available in the sidebar. The header logo and name appear only when the sidebar is hidden. No chat database is used.

## Validation

```sh
npm test
npm run typecheck
npm run lint
npm run build
```

Tests cover model selection and validation, saved model settings, catalog compatibility, display names, context isolation, search limits, search-off behavior, malformed inputs, history limits, provider failures, cancellation, unsafe citations, and UTF-8 streaming. Lint covers application code; unmodified generated UI primitives and their generated mobile hook are excluded from the starter's incompatible lint rules.

A live Opus 5 → Sonnet 5 check exercised high reasoning and hosted web search with source links. The prompts are a starting point; integration checks do not establish a measured quality improvement over a single model. Compare representative user tasks before making quality claims.

Requests have a four-minute timeout, limits on request and history size, and bounded tools and output tokens. The history window retains up to 24 recent messages / 80,000 characters. A failed first step surfaces an error without silently changing models or skipping improvement. Partial answers are retained for follow-up questions. Stopping cancels the in-flight upstream request, though provider work already completed may still be billed. API and search charges use the configured OpenRouter account.

## Sources

- [Claude Opus 5 on OpenRouter](https://openrouter.ai/anthropic/claude-opus-5)
- [Claude Sonnet 5 on OpenRouter](https://openrouter.ai/anthropic/claude-sonnet-5)
- [OpenRouter reasoning effort](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens)
- [OpenRouter hosted web search and tool limits](https://openrouter.ai/docs/guides/features/server-tools/web-search)
