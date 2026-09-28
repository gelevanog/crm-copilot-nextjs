'use client';

import { ACTIVITY_TYPES, type ActivityType } from '@crm/shared';
import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';

export function AddActivityForm({ dealId, companyId }: { dealId?: string; companyId?: string }) {
  const router = useRouter();
  const [type, setType] = useState<ActivityType>('NOTE');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const res = await fetch('/api/activities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, subject, ...(body.trim() && { body }), dealId, companyId }),
    });
    setSaving(false);
    if (!res.ok) {
      setError('Could not save the activity.');
      return;
    }
    setSubject('');
    setBody('');
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <div className="flex gap-2">
        <Select
          value={type}
          onChange={(e) => setType(e.target.value as ActivityType)}
          className="w-32"
        >
          {ACTIVITY_TYPES.map((t) => (
            <option key={t} value={t}>
              {t.charAt(0) + t.slice(1).toLowerCase()}
            </option>
          ))}
        </Select>
        <Input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Subject"
          maxLength={200}
          required
        />
      </div>
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Details (optional)"
        maxLength={5000}
        rows={3}
      />
      <div className="flex items-center justify-between">
        {error ? <p className="text-danger text-xs">{error}</p> : <span />}
        <Button type="submit" size="sm" disabled={saving || !subject.trim()}>
          {saving && <Loader2 className="animate-spin" />}
          Log activity
        </Button>
      </div>
    </form>
  );
}
