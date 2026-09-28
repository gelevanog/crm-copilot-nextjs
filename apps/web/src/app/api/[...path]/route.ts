import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';
import { env } from '@/lib/env';
import { SESSION_COOKIE } from '@/lib/session';

/**
 * Backend-for-frontend proxy: client components call `/api/...`, and this
 * handler forwards to the NestJS API with the bearer token from the httpOnly
 * session cookie. Response bodies are streamed through unchanged, which keeps
 * the copilot chat stream token-by-token.
 */
export const dynamic = 'force-dynamic';

const FORWARDED_RESPONSE_HEADERS = [
  'content-type',
  'cache-control',
  'retry-after',
  'x-ratelimit-remaining',
];

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) {
    return Response.json({ statusCode: 401, message: 'Not signed in' }, { status: 401 });
  }

  const { path } = await context.params;
  const url = `${env.API_URL}/${path.map(encodeURIComponent).join('/')}${request.nextUrl.search}`;
  const body = request.method === 'GET' ? undefined : await request.text();

  const upstream = await fetch(url, {
    method: request.method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body,
    signal: request.signal,
    cache: 'no-store',
  });

  const headers = new Headers();
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}

export { proxy as GET, proxy as POST, proxy as PATCH };
