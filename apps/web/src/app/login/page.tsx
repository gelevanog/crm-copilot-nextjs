import type { Metadata } from 'next';
import { Sparkles } from 'lucide-react';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in' };

const DEMO_USERS = [
  { email: 'alex@northwind.test', workspace: 'Northwind Sales' },
  { email: 'sam@northwind.test', workspace: 'Northwind Sales' },
  { email: 'jordan@globex.test', workspace: 'Globex Partners' },
];

export default function LoginPage() {
  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="bg-primary text-primary-foreground relative hidden flex-col justify-between overflow-hidden p-10 lg:flex">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <span className="bg-ai flex size-7 items-center justify-center rounded-lg">
            <Sparkles className="size-4" />
          </span>
          CRM Copilot
        </div>
        <div className="max-w-md space-y-4">
          <h2 className="text-3xl font-semibold tracking-tight">
            AI features on top of the CRM you already have.
          </h2>
          <p className="text-primary-foreground/70 text-sm leading-relaxed">
            Ask questions in plain English, draft follow-ups from real deal history and filter your
            pipeline by describing what you need. Every answer comes from typed, workspace-scoped
            queries, never from the model&apos;s imagination.
          </p>
        </div>
        <p className="text-primary-foreground/50 text-xs">Demo data is fictional.</p>
        <div className="bg-ai/30 absolute -bottom-24 -right-24 size-96 rounded-full blur-3xl" />
      </section>

      <section className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-6">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
            <p className="text-muted-foreground text-sm">Use one of the seeded demo accounts.</p>
          </div>
          <LoginForm defaultEmail={DEMO_USERS[0]!.email} />
          <div className="bg-muted/60 rounded-lg border p-4 text-xs">
            <p className="mb-2 font-medium">Demo accounts (password: demo1234)</p>
            <ul className="text-muted-foreground space-y-1">
              {DEMO_USERS.map((u) => (
                <li key={u.email} className="flex justify-between gap-2">
                  <code className="text-foreground">{u.email}</code>
                  <span>{u.workspace}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </main>
  );
}
