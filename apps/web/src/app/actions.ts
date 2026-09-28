'use server';

import type { LoginResponse } from '@crm/shared';
import { loginRequestSchema } from '@crm/shared';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { env } from '@/lib/env';
import { SESSION_COOKIE } from '@/lib/session';

export interface LoginState {
  error?: string;
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginRequestSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) return { error: 'Enter a valid email and password.' };

  let res: Response;
  try {
    res = await fetch(`${env.API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed.data),
      cache: 'no-store',
    });
  } catch {
    return { error: 'The API is not reachable. Is it running?' };
  }
  if (res.status === 401) return { error: 'Invalid email or password.' };
  if (!res.ok) return { error: `Login failed (${res.status}).` };

  const { accessToken } = (await res.json()) as LoginResponse;
  (await cookies()).set(SESSION_COOKIE, accessToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.COOKIE_SECURE,
    path: '/',
    maxAge: 60 * 60 * 12,
  });
  redirect('/');
}

export async function logout(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
  redirect('/login');
}
