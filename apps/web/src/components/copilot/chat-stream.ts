import type { ChatRequest, ChatStreamEvent } from '@crm/shared';

/**
 * POSTs a question to the copilot endpoint (through the Next.js proxy) and
 * yields each NDJSON event as soon as it arrives. The history lives on the
 * server: only the conversation id and the new message are sent.
 */
export async function* streamChat(
  request: ChatRequest,
  signal: AbortSignal,
): AsyncGenerator<ChatStreamEvent> {
  const res = await fetch('/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal,
  });

  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => null)) as { message?: string; code?: string } | null;
    yield {
      type: 'error',
      code: body?.code ?? `http_${res.status}`,
      message: body?.message ?? `Request failed (${res.status})`,
    };
    return;
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) yield JSON.parse(line) as ChatStreamEvent;
      newline = buffer.indexOf('\n');
    }
  }
}
