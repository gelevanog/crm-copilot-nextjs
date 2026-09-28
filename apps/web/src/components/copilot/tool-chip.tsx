'use client';

import type { ResultTable } from '@crm/shared';
import { ChevronDown, Loader2, TriangleAlert, Wrench } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { cn } from '@/lib/utils';

export interface ToolActivity {
  id: string;
  name: string;
  input: unknown;
  status: 'running' | 'ok' | 'error';
  summary?: string;
  table?: ResultTable;
}

/** `searchDeals(stages: NEGOTIATION, minAmount: 20000)` */
export function formatToolCall(name: string, input: unknown): string {
  if (!input || typeof input !== 'object') return `${name}()`;
  const args = Object.entries(input as Record<string, unknown>)
    .map(
      ([k, v]) =>
        `${k}: ${Array.isArray(v) ? v.join(' | ') : typeof v === 'string' ? `"${v}"` : String(v)}`,
    )
    .join(', ');
  return `${name}(${args})`;
}

export function ToolChip({
  tool,
  defaultOpen = false,
}: {
  tool: ToolActivity;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const hasTable = !!tool.table && tool.table.rows.length > 0;

  return (
    <div className="bg-card rounded-lg border text-xs">
      <button
        type="button"
        onClick={() => hasTable && setOpen((o) => !o)}
        className={cn(
          'flex w-full items-start gap-2 px-2.5 py-1.5 text-left',
          hasTable && 'hover:bg-muted/60',
        )}
      >
        {tool.status === 'running' ? (
          <Loader2 className="text-ai mt-0.5 size-3.5 shrink-0 animate-spin" />
        ) : tool.status === 'error' ? (
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
        ) : (
          <Wrench className="text-ai mt-0.5 size-3.5 shrink-0" />
        )}
        <span className="text-muted-foreground shrink-0">used tool:</span>
        <span className="min-w-0 flex-1">
          <code className="break-words font-mono text-[11px]">
            {formatToolCall(tool.name, tool.input)}
          </code>
          {tool.summary && <span className="text-muted-foreground block">{tool.summary}</span>}
        </span>
        {hasTable && (
          <ChevronDown
            className={cn('mt-0.5 size-3.5 shrink-0 transition-transform', open && 'rotate-180')}
          />
        )}
      </button>
      {open && tool.table && <ResultTableView table={tool.table} />}
    </div>
  );
}

function ResultTableView({ table }: { table: ResultTable }) {
  return (
    <div className="max-h-64 overflow-auto border-t">
      <table className="w-full text-[11px]">
        <thead className="bg-muted/60 sticky top-0">
          <tr>
            {table.columns.map((c) => (
              <th
                key={c.key}
                className={cn(
                  'whitespace-nowrap px-2.5 py-1.5 font-medium',
                  c.align === 'right' ? 'text-right' : 'text-left',
                )}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, i) => (
            <tr key={i} className="border-t">
              {table.columns.map((c, j) => {
                const value = row.cells[c.key] ?? '—';
                return (
                  <td
                    key={c.key}
                    className={cn(
                      'px-2.5 py-1.5',
                      c.align === 'right' && 'text-right tabular-nums',
                    )}
                  >
                    {j === 0 && row.href ? (
                      <Link href={row.href} className="text-ai font-medium hover:underline">
                        {value}
                      </Link>
                    ) : (
                      value
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
