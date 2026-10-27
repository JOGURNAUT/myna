import { HANDOFF_LABEL, OUTCOME_LABEL } from '@/lib/format';
import type { CallSummary } from '@/lib/types';
import { Badge, Icon, ICONS } from './ui';

export function OutcomeBadge({ call: c }: { call: CallSummary }) {
  if (c.handoffReason) {
    return (
      <Badge tone="warn" icon={<Icon d={ICONS.person} size={14} />}>
        {HANDOFF_LABEL[c.handoffReason] ?? 'Handed to staff'}
      </Badge>
    );
  }
  if (c.outcome) {
    return (
      <Badge tone={c.outcome.includes('booked') ? 'safe' : 'muted'}>
        {c.outcome
          .split(',')
          .map((o) => OUTCOME_LABEL[o] ?? o.replaceAll('_', ' '))
          .join(', ')}
      </Badge>
    );
  }
  return <Badge tone="accent">In progress</Badge>;
}
