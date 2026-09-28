'use client';

import { useActionState } from 'react';
import { Loader2 } from 'lucide-react';
import { login, type LoginState } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function LoginForm({ defaultEmail }: { defaultEmail: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});
  return (
    <form action={action} className="space-y-4">
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">Email</span>
        <Input
          name="email"
          type="email"
          autoComplete="username"
          defaultValue={defaultEmail}
          required
        />
      </label>
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">Password</span>
        <Input
          name="password"
          type="password"
          autoComplete="current-password"
          defaultValue="demo1234"
          required
        />
      </label>
      {state.error && <p className="text-danger text-sm">{state.error}</p>}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending && <Loader2 className="animate-spin" />}
        Sign in
      </Button>
    </form>
  );
}
