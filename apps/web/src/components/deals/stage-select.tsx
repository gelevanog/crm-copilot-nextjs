'use client';

import { DEAL_STAGES, DEAL_STAGE_LABELS, type DealStage } from '@crm/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Select } from '@/components/ui/input';

export function StageSelect({ dealId, stage }: { dealId: string; stage: DealStage }) {
  const router = useRouter();
  const [value, setValue] = useState(stage);
  const [saving, setSaving] = useState(false);

  async function change(next: DealStage) {
    setValue(next);
    setSaving(true);
    const res = await fetch(`/api/deals/${dealId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage: next }),
    });
    setSaving(false);
    if (!res.ok) setValue(stage);
    router.refresh();
  }

  return (
    <Select
      aria-label="Stage"
      value={value}
      disabled={saving}
      onChange={(e) => void change(e.target.value as DealStage)}
      className="h-8 w-40 text-xs"
    >
      {DEAL_STAGES.map((s) => (
        <option key={s} value={s}>
          {DEAL_STAGE_LABELS[s]}
        </option>
      ))}
    </Select>
  );
}
