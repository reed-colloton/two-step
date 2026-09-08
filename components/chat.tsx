'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  ArrowUp,
  ArrowUpRight,
  Check,
  ChevronRight,
  ChevronsRight,
  Copy,
  Globe2,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Square,
  Trash2,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { DEFAULT_PROMPTS, type PromptSettings } from '@/lib/prompts';
import {
  DEFAULT_MODELS,
  FALLBACK_MODELS,
  modelLabels,
  parseCachedModels,
  parseModelSettings,
  type ModelOption,
  type ModelSettings,
} from '@/lib/models';
import { ModelPicker } from '@/components/model-picker';
import { readSSE } from '@/lib/sse';
import type { ChatEvent, Citation } from '@/lib/chat-types';

type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  improvedPrompt?: string;
  citations?: Citation[];
  searchCount?: number;
  seconds?: number;
  interrupted?: boolean;
  error?: string;
};
type Conversation = { id: string; title: string; messages: Message[] };
type Stage = 'idle' | 'improving' | 'answering';
const STORAGE_KEY = 'two-step.chats.v1';
const SETTINGS_KEY = 'two-step.prompts.v1';
const MODELS_KEY = 'two-step.models.v1';
const MODEL_NAMES_KEY = 'two-step.model-names.v1';
const EMPTY_MESSAGES: Message[] = [];
const uid = () => crypto.randomUUID();
const makeChat = (): Conversation => ({
  id: uid(),
  title: 'New chat',
  messages: [],
});

function Mark({ small = false }: { small?: boolean }) {
  return (
    <span className={`brand-mark ${small ? 'small' : ''}`} aria-hidden="true">
      <ChevronsRight />
    </span>
  );
}

function HeaderBrand() {
  const { isMobile, open, openMobile } = useSidebar();
  if (isMobile ? openMobile : open) return null;
  return (
    <span className="header-title">
      <Mark small />
      Two Step
    </span>
  );
}

function Navigation({
  chats,
  activeId,
  select,
  create,
  remove,
  settings,
}: {
  chats: Conversation[];
  activeId: string;
  select: (id: string) => void;
  create: () => void;
  remove: (id: string) => void;
  settings: () => void;
}) {
  const { setOpenMobile } = useSidebar();
  const close = (action: () => void) => {
    action();
    setOpenMobile(false);
  };
  return (
    <Sidebar className="chat-sidebar">
      <SidebarHeader className="nav-header">
        <div className="brand">
          <Mark small />
          <span>Two Step</span>
        </div>
      </SidebarHeader>
      <SidebarContent className="nav-content">
        <button className="new-chat" onClick={() => close(create)}>
          <Plus size={18} />
          New chat
        </button>
        <div className="nav-label">Chats</div>
        {chats.filter((c) => c.messages.length > 0).length === 0 && (
          <p className="nav-empty">No chats yet.</p>
        )}
        {chats
          .filter((c) => c.messages.length > 0)
          .map((c) => (
            <div
              className={`history-row ${activeId === c.id ? 'active' : ''}`}
              key={c.id}
            >
              <button
                className="history-link"
                onClick={() => close(() => select(c.id))}
              >
                <span>{c.title}</span>
              </button>
              <button
                className="delete-chat"
                aria-label={`Delete ${c.title}`}
                onClick={() => remove(c.id)}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
      </SidebarContent>
      <SidebarFooter className="nav-footer">
        <button className="settings-button" onClick={() => close(settings)}>
          <SlidersHorizontal size={17} />
          Settings
          <ChevronRight size={16} className="ml-auto" />
        </button>
        <div className="local-note">
          <span className="status-dot" />
          Chats saved in this browser
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}

export function Chat() {
  const [chats, setChats] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState('');
  const [ready, setReady] = useState(false);
  const [input, setInput] = useState('');
  const [stage, setStage] = useState<Stage>('idle');
  const [search, setSearch] = useState(true);
  const [prompts, setPrompts] = useState<PromptSettings>(DEFAULT_PROMPTS);
  const [drafts, setDrafts] = useState<PromptSettings>(DEFAULT_PROMPTS);
  const [models, setModels] = useState<ModelSettings>(DEFAULT_MODELS);
  const [modelDrafts, setModelDrafts] = useState<ModelSettings>(DEFAULT_MODELS);
  const [modelOptions, setModelOptions] =
    useState<ModelOption[]>(FALLBACK_MODELS);
  const [catalogStatus, setCatalogStatus] = useState<
    'loading' | 'ready' | 'error'
  >('loading');
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [copied, setCopied] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const requestId = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const active = chats.find((c) => c.id === activeId);
  const messages = active?.messages ?? EMPTY_MESSAGES;
  const busy = stage !== 'idle';
  const labels = modelLabels(models, modelOptions, ready);

  useEffect(() => {
    // One browser-storage hydration after SSR; server rendering cannot read it.
    let restored: Conversation[] = [];
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
      if (Array.isArray(saved))
        restored = saved
          .filter(
            (c: Conversation) =>
              typeof c?.id === 'string' &&
              typeof c.title === 'string' &&
              Array.isArray(c.messages) &&
              c.messages.every(
                (m) =>
                  ['user', 'assistant'].includes(m.role) &&
                  typeof m.content === 'string',
              ),
          )
          .slice(0, 30);
      const settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null');
      if (
        typeof settings?.improver === 'string' &&
        typeof settings?.answerer === 'string' &&
        settings.improver.trim() &&
        settings.answerer.trim()
      ) {
        // eslint-disable-next-line react/react-compiler -- One-time hydration of browser storage after SSR.
        setPrompts(settings);
      }
      const savedModels = localStorage.getItem(MODELS_KEY);
      if (savedModels) {
        try {
          // eslint-disable-next-line react/react-compiler -- One-time hydration of saved model choices after SSR.
          setModels(parseModelSettings(JSON.parse(savedModels)));
        } catch {
          // Invalid saved model choices use defaults without discarding chats or prompts.
        }
      }
      try {
        const cached = parseCachedModels(
          JSON.parse(localStorage.getItem(MODEL_NAMES_KEY) ?? 'null'),
        );
        if (cached.length) {
          // eslint-disable-next-line react/react-compiler -- Restore cached model names with the saved IDs before revealing labels.
          setModelOptions(cached);
        }
      } catch {
        // Names stay hidden until the catalog resolves any uncached selections.
      }
    } catch {
      setNotice(
        'Browser storage is unavailable. This chat will still work for this session.',
      );
    }
    if (!restored.length) restored = [makeChat()];
    setChats(restored);
    setActiveId(restored[0].id);
    setReady(true);
    fetch('/api/config')
      .then((r) =>
        r.ok ? (r.json() as Promise<{ configured: boolean }>) : null,
      )
      .then((d) => setConfigured(d?.configured ?? null))
      .catch(() => setConfigured(null));
    return () => abortRef.current?.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/models', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Model list unavailable');
        const data = (await response.json()) as { models: ModelOption[] };
        if (!Array.isArray(data.models) || !data.models.length)
          throw new Error('Model list unavailable');
        if (controller.signal.aborted) return;
        setModelOptions(data.models);
        setCatalogStatus('ready');
        try {
          localStorage.setItem(MODEL_NAMES_KEY, JSON.stringify(data.models));
        } catch {
          // Caching names is optional when browser storage is unavailable.
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setCatalogStatus('error');
      });
    return () => controller.abort();
  }, [catalogAttempt]);

  useEffect(() => {
    if (!ready || busy) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(chats.slice(0, 30)));
    } catch {
      // eslint-disable-next-line react/react-compiler -- Report a real browser-storage write failure.
      setNotice('This conversation could not be saved in your browser.');
    }
  }, [chats, ready, busy]);

  useEffect(() => {
    if (stickToBottom.current && scrollRef.current)
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, stage]);

  useEffect(() => {
    if (textarea.current) {
      textarea.current.style.height = 'auto';
      textarea.current.style.height = `${Math.min(textarea.current.scrollHeight, 220)}px`;
    }
  }, [input]);

  function updateMessage(
    chatId: string,
    messageId: string,
    changes: Partial<Message>,
  ) {
    setChats((prev) =>
      prev.map((c) =>
        c.id === chatId
          ? {
              ...c,
              messages: c.messages.map((m) =>
                m.id === messageId ? { ...m, ...changes } : m,
              ),
            }
          : c,
      ),
    );
  }

  function stop() {
    abortRef.current?.abort();
  }
  function create() {
    stop();
    requestId.current++;
    setStage('idle');
    setInput('');
    const c = makeChat();
    setChats((prev) =>
      [c, ...prev.filter((p) => p.messages.length > 0)].slice(0, 30),
    );
    setActiveId(c.id);
    textarea.current?.focus();
  }
  function select(id: string) {
    stop();
    requestId.current++;
    setStage('idle');
    setActiveId(id);
    setInput('');
    stickToBottom.current = true;
  }
  function remove(id: string) {
    if (id === activeId) {
      stop();
      requestId.current++;
      setStage('idle');
    }
    const remaining = chats.filter((c) => c.id !== id);
    if (!remaining.length) remaining.push(makeChat());
    setChats(remaining);
    if (id === activeId) setActiveId(remaining[0].id);
  }

  async function send(retry = false) {
    if (
      busy ||
      (abortRef.current && !abortRef.current.signal.aborted) ||
      !ready ||
      !active ||
      (!retry && !input.trim())
    )
      return;
    let history = active.messages;
    let content = input.trim();
    if (retry) {
      const userIndex = history.findLastIndex((m) => m.role === 'user');
      if (userIndex < 0) return;
      content = history[userIndex].content;
      history = history.slice(0, userIndex);
    }
    const chatId = active.id,
      userId = uid(),
      assistantId = uid();
    const controller = new AbortController();
    abortRef.current = controller;
    const currentRequest = ++requestId.current;
    setInput('');
    setNotice('');
    setStage('improving');
    stickToBottom.current = true;
    setChats((prev) =>
      prev.map((c) =>
        c.id === chatId
          ? {
              ...c,
              title: c.messages.length ? c.title : content.slice(0, 45),
              messages: [
                ...history,
                { id: userId, role: 'user', content },
                { id: assistantId, role: 'assistant', content: '' },
              ],
            }
          : c,
      ),
    );
    let fullText = '',
      completed = false;
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          message: content,
          history: history
            .filter((m) => m.content.trim())
            .map(({ role, content: text }) => ({ role, content: text })),
          webSearch: search,
          prompts,
          models,
        }),
      });
      if (!response.ok) {
        const error = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(
          error.error ?? 'Could not start this response. Please try again.',
        );
      }
      if (!response.body)
        throw new Error(
          'The response stream is unavailable. Please try again.',
        );
      for await (const raw of readSSE(response.body)) {
        const event = JSON.parse(raw) as ChatEvent;
        if (event.type === 'error') throw new Error(event.message);
        if (event.type === 'stage' && requestId.current === currentRequest)
          setStage(event.stage);
        if (event.type === 'improved')
          updateMessage(chatId, assistantId, { improvedPrompt: event.prompt });
        if (event.type === 'delta') {
          fullText += event.text;
          updateMessage(chatId, assistantId, { content: fullText });
        }
        if (event.type === 'done') {
          completed = true;
          updateMessage(chatId, assistantId, {
            citations: event.citations,
            searchCount: event.searchCount,
            seconds: event.seconds,
          });
        }
      }
      if (!completed)
        throw new Error(
          'The connection ended before the answer finished. Please try again.',
        );
    } catch (error) {
      if (controller.signal.aborted)
        updateMessage(chatId, assistantId, { interrupted: true });
      else
        updateMessage(chatId, assistantId, {
          error:
            error instanceof Error
              ? error.message
              : 'Something went wrong. Please try again.',
        });
    } finally {
      if (requestId.current === currentRequest) {
        setStage('idle');
        abortRef.current = null;
        textarea.current?.focus();
      }
    }
  }

  function openSettings() {
    setDrafts(prompts);
    setModelDrafts(models);
    setSettingsOpen(true);
  }
  function saveSettings() {
    const next = {
      improver: drafts.improver.trim(),
      answerer: drafts.answerer.trim(),
    };
    if (!next.improver || !next.answerer) return;
    setPrompts(next);
    setModels({ ...modelDrafts });
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      localStorage.setItem(MODELS_KEY, JSON.stringify(modelDrafts));
      localStorage.setItem(MODEL_NAMES_KEY, JSON.stringify(modelOptions));
    } catch {
      setNotice(
        'Settings apply for this session; browser storage is unavailable.',
      );
    }
    setSettingsOpen(false);
  }
  async function copy(text: string, id: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied(''), 1800);
    } catch {
      setNotice(
        'Copy was unavailable. You can select and copy the text directly.',
      );
    }
  }

  const composer = (
    <div className="composer-area">
      {configured === false && (
        <div role="alert" className="notice">
          Add OPENROUTER_API_KEY to the server environment to start chatting.
        </div>
      )}
      {notice && (
        <output className="notice">
          {notice}
          <button onClick={() => setNotice('')} aria-label="Dismiss notice">
            ×
          </button>
        </output>
      )}
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          ref={textarea}
          aria-label="Message Two Step"
          placeholder="Ask about something complicated..."
          rows={2}
          maxLength={20000}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (
              e.key === 'Enter' &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <div className="composer-toolbar">
          <div className="search-control">
            <label htmlFor="web-search">Search</label>
            <Switch
              id="web-search"
              size="sm"
              checked={search}
              onCheckedChange={setSearch}
              disabled={busy}
            />
          </div>
          {busy ? (
            <button
              type="button"
              className="send-button stop"
              onClick={stop}
              aria-label="Stop response"
            >
              <Square size={12} fill="currentColor" />
            </button>
          ) : (
            <button
              className="send-button"
              type="submit"
              disabled={!input.trim() || !ready || configured === false}
              aria-label="Send message"
            >
              <ArrowUp size={18} />
            </button>
          )}
        </div>
      </form>
    </div>
  );

  return (
    <SidebarProvider style={{ '--sidebar-width': '248px' } as CSSProperties}>
      <Navigation
        chats={chats}
        activeId={activeId}
        select={select}
        create={create}
        remove={remove}
        settings={openSettings}
      />
      <main className="chat-main">
        <header className="chat-header">
          <div className="header-left">
            <SidebarTrigger aria-label="Toggle sidebar" />
            <HeaderBrand />
          </div>
          <button
            className="header-settings"
            onClick={openSettings}
            aria-label="Settings"
            title="Settings"
            disabled={!ready}
          >
            <SlidersHorizontal size={18} />
          </button>
        </header>
        <div
          className={`chat-scroll ${messages.length ? 'has-messages' : ''}`}
          ref={scrollRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            stickToBottom.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < 120;
          }}
        >
          {!messages.length ? (
            <div className="welcome">
              <h1>Two Step</h1>
              <p aria-hidden={!labels}>
                {labels
                  ? `${labels.improver} improves your prompt. ${labels.answerer} answers it.`
                  : '\u00a0'}
              </p>
              {composer}
            </div>
          ) : (
            <div className="messages">
              {messages.map((message, index) =>
                message.role === 'user' ? (
                  <div className="user-message" key={message.id}>
                    <div>{message.content}</div>
                  </div>
                ) : (
                  <article
                    className="assistant-message"
                    key={message.id}
                    aria-label="Assistant response"
                  >
                    <div className="assistant-label">
                      <Mark small />
                      <span>Two Step</span>
                      {message.seconds !== undefined && (
                        <span className="message-time">{message.seconds}s</span>
                      )}
                    </div>
                    {message.improvedPrompt && (
                      <details className="improvement">
                        <summary>
                          <Check size={14} />
                          <span>Rewritten prompt</span>
                          <ChevronRight size={14} />
                        </summary>
                        <div className="improvement-content">
                          <div className="improvement-heading">
                            Sent to the answering model
                            <button
                              onClick={() =>
                                void copy(
                                  message.improvedPrompt!,
                                  `prompt-${message.id}`,
                                )
                              }
                              aria-label="Copy rewritten prompt"
                            >
                              {copied === `prompt-${message.id}` ? (
                                <Check size={14} />
                              ) : (
                                <Copy size={14} />
                              )}
                            </button>
                          </div>
                          <p>{message.improvedPrompt}</p>
                        </div>
                      </details>
                    )}
                    {message.content && (
                      <div className="markdown">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            a: ({ children, ...props }) => (
                              <a
                                {...props}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                {children}
                              </a>
                            ),
                          }}
                        >
                          {message.content}
                        </ReactMarkdown>
                      </div>
                    )}
                    {busy && index === messages.length - 1 && (
                      <output className="thinking">
                        <span className="thinking-dot" />
                        {stage === 'improving'
                          ? 'Rewriting prompt…'
                          : 'Answering…'}
                      </output>
                    )}
                    {message.citations && message.citations.length > 0 && (
                      <div className="sources">
                        <span>
                          <Globe2 size={14} />
                          Sources
                        </span>
                        {message.citations.map((source) => (
                          <a
                            href={source.url}
                            key={source.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {source.title || source.url}
                            <ArrowUpRight size={12} />
                          </a>
                        ))}
                      </div>
                    )}
                    {message.error && (
                      <p className="message-error" role="alert">
                        {message.error}
                      </p>
                    )}
                    {message.interrupted && (
                      <p className="interrupted">Response stopped.</p>
                    )}
                    {(!busy || index < messages.length - 1) && (
                      <div className="message-actions">
                        {message.content && (
                          <button
                            onClick={() =>
                              void copy(message.content, message.id)
                            }
                            aria-label="Copy answer"
                          >
                            {copied === message.id ? (
                              <Check size={15} />
                            ) : (
                              <Copy size={15} />
                            )}
                          </button>
                        )}
                        {index === messages.length - 1 && (
                          <button
                            onClick={() => void send(true)}
                            aria-label="Try response again"
                            disabled={busy}
                          >
                            <RotateCcw size={15} />
                            <span>
                              {message.error || message.interrupted
                                ? 'Try again'
                                : 'Regenerate'}
                            </span>
                          </button>
                        )}
                        {message.searchCount !== undefined &&
                          message.searchCount > 0 && (
                            <span className="search-count">
                              {message.searchCount} web{' '}
                              {message.searchCount === 1
                                ? 'search'
                                : 'searches'}
                            </span>
                          )}
                      </div>
                    )}
                  </article>
                ),
              )}
            </div>
          )}
        </div>
        {messages.length > 0 && (
          <div className="bottom-composer">{composer}</div>
        )}
      </main>
      <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
        <SheetContent className="prompt-sheet">
          <SheetHeader>
            <SheetTitle className="sheet-title">Settings</SheetTitle>
            <SheetDescription>
              Edits apply to the next message. Saved in this browser.
            </SheetDescription>
            {catalogStatus !== 'ready' && (
              <output className="model-catalog-note">
                {catalogStatus === 'loading' ? (
                  'Loading models…'
                ) : (
                  <>
                    Couldn’t load more models.{' '}
                    <button
                      type="button"
                      onClick={() => {
                        setCatalogStatus('loading');
                        setCatalogAttempt((attempt) => attempt + 1);
                      }}
                    >
                      Retry
                    </button>
                  </>
                )}
              </output>
            )}
          </SheetHeader>
          <Tabs defaultValue="improver" className="prompt-tabs">
            <TabsList className="prompt-tab-list">
              <TabsTrigger value="improver">01 · Rewrite</TabsTrigger>
              <TabsTrigger value="answerer">02 · Answer</TabsTrigger>
            </TabsList>
            {(['improver', 'answerer'] as const).map((key) => (
              <TabsContent value={key} key={key} className="prompt-panel">
                <div className="model-label-row">
                  <label htmlFor={`model-${key}`} className="prompt-label">
                    Model
                  </label>
                  <span>
                    {key === 'improver'
                      ? 'Low reasoning · 1 search max'
                      : 'High reasoning · 6 searches max'}
                  </span>
                </div>
                <ModelPicker
                  id={`model-${key}`}
                  value={modelDrafts[key]}
                  options={modelOptions}
                  onChange={(id) =>
                    setModelDrafts((prev) => ({ ...prev, [key]: id }))
                  }
                />
                <label htmlFor={`prompt-${key}`} className="prompt-label">
                  System prompt
                </label>
                <textarea
                  id={`prompt-${key}`}
                  value={drafts[key]}
                  maxLength={12000}
                  onChange={(e) =>
                    setDrafts((prev) => ({ ...prev, [key]: e.target.value }))
                  }
                  spellCheck={false}
                />
                <p className="prompt-hint">
                  {key === 'improver'
                    ? 'Rewrites your request before it reaches the answering model.'
                    : 'Receives the rewritten prompt and chat history, without the first agent’s reasoning.'}
                </p>
              </TabsContent>
            ))}
          </Tabs>
          <div className="sheet-actions">
            <button
              onClick={() => {
                setDrafts(DEFAULT_PROMPTS);
                setModelDrafts(DEFAULT_MODELS);
              }}
            >
              <RotateCcw size={15} />
              Reset defaults
            </button>
            <button
              className="save-prompts"
              onClick={saveSettings}
              disabled={!drafts.improver.trim() || !drafts.answerer.trim()}
            >
              Save settings
              <Check size={16} />
            </button>
          </div>
        </SheetContent>
      </Sheet>
    </SidebarProvider>
  );
}
