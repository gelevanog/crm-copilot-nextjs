'use client';

import type { ConversationSummary } from '@crm/shared';
import { Check, Loader2, MessageSquare, Pencil, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';

interface Props {
  activeId: string | null;
  onOpen: (id: string) => void;
  onRenamed: (conversation: ConversationSummary) => void;
  onDeleted: (id: string) => void;
}

/** Recent saved conversations of the signed-in user, with rename and delete. */
export function ConversationHistory({ activeId, onOpen, onRenamed, onDeleted }: Props) {
  const [items, setItems] = useState<ConversationSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/ai/conversations')
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        return (await res.json()) as ConversationSummary[];
      })
      .then((list) => !cancelled && setItems(list))
      .catch(() => !cancelled && setError('Could not load your conversations.'));
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p className="text-danger p-4 text-sm">{error}</p>;
  if (!items) {
    return (
      <p className="text-muted-foreground flex items-center gap-2 p-4 text-sm">
        <Loader2 className="size-4 animate-spin" /> Loading conversations…
      </p>
    );
  }
  if (items.length === 0) {
    return (
      <p className="text-muted-foreground p-4 text-sm">
        No saved conversations yet. Questions you ask are saved here automatically.
      </p>
    );
  }

  return (
    <ul className="space-y-1 p-2">
      {items.map((c) => (
        <HistoryItem
          key={c.id}
          conversation={c}
          active={c.id === activeId}
          onOpen={() => onOpen(c.id)}
          onRenamed={(updated) => {
            setItems((prev) => prev?.map((p) => (p.id === updated.id ? updated : p)) ?? null);
            onRenamed(updated);
          }}
          onDeleted={() => {
            setItems((prev) => prev?.filter((p) => p.id !== c.id) ?? null);
            onDeleted(c.id);
          }}
        />
      ))}
    </ul>
  );
}

function HistoryItem({
  conversation,
  active,
  onOpen,
  onRenamed,
  onDeleted,
}: {
  conversation: ConversationSummary;
  active: boolean;
  onOpen: () => void;
  onRenamed: (c: ConversationSummary) => void;
  onDeleted: () => void;
}) {
  const [mode, setMode] = useState<'view' | 'rename' | 'confirm-delete'>('view');
  const [title, setTitle] = useState(conversation.title);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function rename() {
    const next = title.trim();
    if (!next || next === conversation.title) {
      setMode('view');
      return;
    }
    setSaving(true);
    const res = await fetch(`/api/ai/conversations/${conversation.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: next }),
    });
    setSaving(false);
    if (!res.ok) {
      setError('Could not rename.');
      return;
    }
    onRenamed((await res.json()) as ConversationSummary);
    setMode('view');
  }

  async function remove() {
    setSaving(true);
    const res = await fetch(`/api/ai/conversations/${conversation.id}`, { method: 'DELETE' });
    setSaving(false);
    if (!res.ok) {
      setError('Could not delete.');
      return;
    }
    onDeleted();
  }

  if (mode === 'rename') {
    return (
      <li className="bg-card flex items-center gap-1 rounded-lg border p-1.5">
        <input
          autoFocus
          aria-label="Conversation title"
          value={title}
          maxLength={120}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void rename();
            if (e.key === 'Escape') {
              e.stopPropagation();
              setTitle(conversation.title);
              setMode('view');
            }
          }}
          className="min-w-0 flex-1 bg-transparent px-1.5 text-sm outline-none"
        />
        <Button
          size="icon-sm"
          variant="ghost"
          title="Save"
          disabled={saving}
          onClick={() => void rename()}
        >
          {saving ? <Loader2 className="animate-spin" /> : <Check />}
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          title="Cancel"
          onClick={() => {
            setTitle(conversation.title);
            setMode('view');
          }}
        >
          <X />
        </Button>
      </li>
    );
  }

  return (
    <li
      className={cn(
        'group flex items-center gap-1 rounded-lg border border-transparent pr-1 transition-colors',
        active ? 'border-ai-border bg-ai-soft' : 'hover:bg-muted',
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-start gap-2.5 px-2.5 py-2 text-left"
      >
        <MessageSquare className="text-muted-foreground mt-0.5 size-4 shrink-0" />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{conversation.title}</span>
          <span className="text-muted-foreground text-[11px]">
            {mode === 'confirm-delete'
              ? 'Delete this conversation?'
              : (error ?? `Updated ${formatRelative(conversation.updatedAt)}`)}
          </span>
        </span>
      </button>
      {mode === 'confirm-delete' ? (
        <>
          <Button size="sm" variant="outline" disabled={saving} onClick={() => void remove()}>
            {saving ? <Loader2 className="animate-spin" /> : <Trash2 className="text-danger" />}
            Delete
          </Button>
          <Button size="icon-sm" variant="ghost" title="Keep" onClick={() => setMode('view')}>
            <X />
          </Button>
        </>
      ) : (
        <span className="flex opacity-60 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
          <Button size="icon-sm" variant="ghost" title="Rename" onClick={() => setMode('rename')}>
            <Pencil />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            title="Delete"
            onClick={() => setMode('confirm-delete')}
          >
            <Trash2 />
          </Button>
        </span>
      )}
    </li>
  );
}
