'use client';

import type { ChatTurn, ConversationDetail, UsageSummary } from '@crm/shared';
import { ArrowUp, History, Loader2, Sparkles, Square, SquarePen, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { streamChat } from './chat-stream';
import { ConversationHistory } from './conversation-history';
import { useCopilot } from './copilot-provider';
import { MarkdownLite } from './markdown-lite';
import { ToolChip, type ToolActivity } from './tool-chip';

type Turn =
  | { id: string; role: 'user'; content: string }
  | {
      id: string;
      role: 'assistant';
      content: string;
      tools: ToolActivity[];
      status: 'streaming' | 'done' | 'error';
      error?: string;
      meta?: { model: string; usage: UsageSummary };
    };

type AssistantTurn = Extract<Turn, { role: 'assistant' }>;

const SUGGESTIONS = [
  'Which deals over $20k are stuck in Negotiation for more than 2 weeks?',
  'Summarize my last interactions with Acme',
  'How is the pipeline looking?',
  'Move the Acme deal to Proposal',
];

const TABLE_FIRST_TOOLS = new Set(['searchDeals', 'getPipelineStats']);

/** Maps a saved conversation's turns to the drawer's live turn model. */
function fromSaved(turns: ChatTurn[]): Turn[] {
  return turns.map((t): Turn =>
    t.role === 'user'
      ? t
      : {
          id: t.id,
          role: 'assistant',
          content: t.content,
          status: t.error ? 'error' : 'done',
          ...(t.error && { error: t.error }),
          ...(t.meta && { meta: t.meta }),
          tools: t.tools.map((tool) => ({
            id: tool.id,
            name: tool.name,
            input: tool.input,
            status: tool.ok ? 'ok' : 'error',
            summary: tool.summary,
            table: tool.table,
            proposal: tool.proposal,
          })),
        },
  );
}

export function ChatDrawer() {
  const { isOpen, setOpen, pendingQuestion, consumePending } = useCopilot();
  const [conversation, setConversation] = useState<{ id: string; title: string } | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [view, setView] = useState<'chat' | 'history'>('chat');
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const busy = turns.some((t) => t.role === 'assistant' && t.status === 'streaming');

  const updateAssistant = useCallback((id: string, fn: (t: AssistantTurn) => AssistantTurn) => {
    setTurns((prev) => prev.map((t) => (t.id === id && t.role === 'assistant' ? fn(t) : t)));
  }, []);

  const startNew = useCallback(() => {
    setConversation(null);
    setTurns([]);
    setLoadError(null);
    setView('chat');
  }, []);

  const openConversation = useCallback(async (id: string) => {
    setView('chat');
    setTurns([]);
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/ai/conversations/${id}`);
      if (!res.ok) throw new Error(String(res.status));
      const detail = (await res.json()) as ConversationDetail;
      setConversation({ id: detail.id, title: detail.title });
      setTurns(fromSaved(detail.turns));
    } catch {
      setLoadError('Could not open this conversation.');
    } finally {
      setLoading(false);
    }
  }, []);

  const send = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (!message || busy) return;

      const assistantId = crypto.randomUUID();
      setView('chat');
      setTurns((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: 'user', content: message },
        { id: assistantId, role: 'assistant', content: '', tools: [], status: 'streaming' },
      ]);
      setInput('');

      const controller = new AbortController();
      abortRef.current = controller;
      try {
        for await (const event of streamChat(
          { message, ...(conversation && { conversationId: conversation.id }) },
          controller.signal,
        )) {
          if (event.type === 'conversation') {
            setConversation({ id: event.id, title: event.title });
            continue;
          }
          updateAssistant(assistantId, (t) => {
            switch (event.type) {
              case 'text':
                return { ...t, content: t.content + event.delta };
              case 'tool_call':
                return {
                  ...t,
                  tools: [
                    ...t.tools,
                    { id: event.id, name: event.name, input: event.input, status: 'running' },
                  ],
                };
              case 'tool_result':
                return {
                  ...t,
                  tools: t.tools.map((tool) =>
                    tool.id === event.id
                      ? {
                          ...tool,
                          status: event.ok ? 'ok' : 'error',
                          summary: event.summary,
                          table: event.table,
                          proposal: event.proposal,
                        }
                      : tool,
                  ),
                };
              case 'done':
                return { ...t, status: 'done', meta: { model: event.model, usage: event.usage } };
              case 'error':
                return { ...t, status: 'error', error: event.message };
            }
          });
        }
        updateAssistant(assistantId, (t) =>
          t.status === 'streaming' ? { ...t, status: 'done' } : t,
        );
      } catch (err) {
        const aborted = err instanceof DOMException && err.name === 'AbortError';
        updateAssistant(assistantId, (t) => ({
          ...t,
          status: aborted ? 'done' : 'error',
          error: aborted ? undefined : 'Connection lost. Please try again.',
        }));
      } finally {
        abortRef.current = null;
      }
    },
    [busy, conversation, updateAssistant],
  );

  // Questions queued from elsewhere in the app ("Ask about this deal").
  useEffect(() => {
    if (isOpen && pendingQuestion && !busy) {
      const q = consumePending();
      if (q) void send(q);
    }
  }, [isOpen, pendingQuestion, busy, consumePending, send]);

  useEffect(() => {
    if (isOpen && view === 'chat') inputRef.current?.focus();
  }, [isOpen, view]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns]);

  return (
    <>
      <div
        onClick={() => setOpen(false)}
        className={cn(
          'fixed inset-0 z-40 bg-black/20 transition-opacity md:hidden',
          isOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      />
      <aside
        aria-label="CRM copilot"
        aria-hidden={!isOpen}
        className={cn(
          'bg-background fixed inset-y-0 right-0 z-50 flex w-full max-w-[460px] flex-col border-l shadow-2xl transition-transform duration-200',
          isOpen ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <header className="flex h-14 items-center gap-2 border-b px-4">
          <span className="bg-ai text-ai-foreground flex size-7 shrink-0 items-center justify-center rounded-lg">
            <Sparkles className="size-4" />
          </span>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="text-sm font-semibold">
              {view === 'history' ? 'Conversations' : 'Ask your CRM'}
            </p>
            <p className="text-muted-foreground truncate text-[11px]">
              {view === 'chat' && conversation
                ? conversation.title
                : 'Answers come from live, workspace-scoped queries'}
            </p>
          </div>
          <Button
            variant={view === 'history' ? 'ai-outline' : 'ghost'}
            size="icon-sm"
            title="Conversation history"
            aria-pressed={view === 'history'}
            onClick={() => setView((v) => (v === 'history' ? 'chat' : 'history'))}
            disabled={busy}
          >
            <History />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            title="New conversation"
            onClick={startNew}
            disabled={busy || (turns.length === 0 && view === 'chat')}
          >
            <SquarePen />
          </Button>
          <Button variant="ghost" size="icon-sm" title="Close" onClick={() => setOpen(false)}>
            <X />
          </Button>
        </header>

        {view === 'history' ? (
          <div className="flex-1 overflow-y-auto">
            <ConversationHistory
              activeId={conversation?.id ?? null}
              onOpen={(id) => void openConversation(id)}
              onRenamed={(c) =>
                setConversation((cur) => (cur?.id === c.id ? { id: c.id, title: c.title } : cur))
              }
              onDeleted={(id) => {
                if (conversation?.id === id) {
                  setConversation(null);
                  setTurns([]);
                }
              }}
            />
          </div>
        ) : (
          <div ref={scrollRef} className="flex-1 space-y-5 overflow-y-auto p-4">
            {loading && (
              <p className="text-muted-foreground flex items-center gap-2 text-sm">
                <Loader2 className="size-4 animate-spin" /> Loading conversation…
              </p>
            )}
            {loadError && <p className="text-danger text-sm">{loadError}</p>}

            {!loading && turns.length === 0 && (
              <div className="space-y-3 pt-6">
                <p className="text-muted-foreground text-sm">
                  Ask about deals, accounts and activities, or ask for a change. The copilot calls
                  typed tools (you will see each call), only sees data from your workspace, and
                  never changes anything without your approval.
                </p>
                <div className="space-y-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => void send(s)}
                      className="hover:border-ai-border hover:bg-ai-soft bg-card w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {turns.map((turn) =>
              turn.role === 'user' ? (
                <div key={turn.id} className="flex justify-end">
                  <p className="bg-primary text-primary-foreground max-w-[85%] rounded-2xl rounded-br-sm px-3.5 py-2 text-sm">
                    {turn.content}
                  </p>
                </div>
              ) : (
                <div key={turn.id} className="space-y-2">
                  {turn.tools.map((tool, i) => (
                    <ToolChip
                      key={tool.id}
                      tool={tool}
                      defaultOpen={i === 0 && TABLE_FIRST_TOOLS.has(tool.name)}
                    />
                  ))}
                  {(turn.content || turn.status === 'streaming') && (
                    <div
                      className={cn(
                        'text-sm leading-relaxed',
                        turn.status === 'streaming' && 'caret',
                      )}
                    >
                      {turn.content ? (
                        <MarkdownLite text={turn.content} />
                      ) : (
                        <span className="text-muted-foreground">Thinking…</span>
                      )}
                    </div>
                  )}
                  {turn.error && (
                    <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                      {turn.error}
                    </p>
                  )}
                  {turn.meta && (
                    <p className="text-muted-foreground text-[11px]">
                      {turn.meta.model} · {turn.meta.usage.inputTokens.toLocaleString()} in /{' '}
                      {turn.meta.usage.outputTokens.toLocaleString()} out tokens · $
                      {turn.meta.usage.costUsd.toFixed(4)}
                    </p>
                  )}
                </div>
              ),
            )}
          </div>
        )}

        <form
          className="border-t p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          <div className="focus-within:border-ring bg-card shadow-xs flex items-end gap-2 rounded-xl border p-2">
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              maxLength={4000}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send(input);
                }
              }}
              placeholder={conversation ? 'Continue the conversation…' : 'Ask about your pipeline…'}
              className="placeholder:text-muted-foreground max-h-32 min-h-8 flex-1 resize-none bg-transparent px-1.5 py-1 text-sm outline-none focus-visible:ring-0"
            />
            {busy ? (
              <Button
                type="button"
                size="icon-sm"
                variant="outline"
                title="Stop"
                onClick={() => abortRef.current?.abort()}
              >
                <Square />
              </Button>
            ) : (
              <Button
                type="submit"
                size="icon-sm"
                variant="ai"
                title="Send"
                disabled={!input.trim() || loading}
              >
                <ArrowUp />
              </Button>
            )}
          </div>
        </form>
      </aside>
    </>
  );
}
