// Durable delivery on the jobs runner (AMP-060 + AMP-042). Three checkpointed steps: record -> deliver -> confirm.
// The runner is at-least-once per step, so every step here is safe to run again: `record` finds the existing fulfilment,
// `deliver` only sends when it wins the delivery lease, `confirm` only reads. Checkpoints hold ids and statuses, never a link.
import type { JobKindDefinition } from '../jobs/registry.ts';
import { JobError } from '../jobs/types.ts';
import type { JsonValue } from '../jobs/types.ts';
import type { FulfilmentService } from './service.ts';

export const FULFIL_ORDER_JOB = 'fulfil-order';

const orderIdOf = (input: JsonValue): string => {
  const id = typeof input === 'object' && input !== null && !Array.isArray(input) ? input.orderId : null;
  if (typeof id !== 'string' || !id) throw new JobError('permanent', 'The job has no order to deliver.');
  return id;
};

/** Enqueue with `{ orderId }` as input and the order id as the idempotency key: one job per order. */
export function createFulfilOrderJob(service: Pick<FulfilmentService, 'recordPaidOrder' | 'fulfilPaidOrder'>): JobKindDefinition {
  return {
    kind: FULFIL_ORDER_JOB,
    steps: [
      {
        name: 'record',
        async run({ job, input }) {
          const r = await service.recordPaidOrder({ workspaceId: job.workspaceId, orderId: orderIdOf(input) });
          if (r.outcome === 'revoked') return { output: { fulfilmentId: r.fulfilment?.id ?? null, status: 'revoked' } };
          if (!r.fulfilment) throw new JobError('permanent', 'The order is not a paid order of this workspace, so nothing was delivered.');
          return { output: { fulfilmentId: r.fulfilment.id, status: r.fulfilment.status } };
        },
      },
      {
        name: 'deliver',
        async run({ job, input }) {
          const r = await service.fulfilPaidOrder({ workspaceId: job.workspaceId, orderId: orderIdOf(input) }, { trigger: 'job' });
          if (r.outcome === 'delivered' || r.outcome === 'already_delivered') return { output: { status: 'delivered', sentNow: r.outcome === 'delivered', attempts: r.fulfilment?.attempts ?? 0 } };
          if (r.outcome === 'revoked') return { output: { status: 'revoked', sentNow: false, attempts: r.fulfilment?.attempts ?? 0 } };
          if (r.outcome === 'failed') throw new JobError('temporary', 'The delivery email could not be sent yet.');
          if (r.outcome === 'in_progress') throw new JobError('temporary', 'Another worker is delivering this order.');
          if (r.outcome === 'needs_review' || r.outcome === 'retries_exhausted') throw new JobError('permanent', 'Delivery needs the owner: the file or the email could not be sent after several tries.');
          throw new JobError('permanent', 'The order is not a paid order of this workspace, so nothing was delivered.');
        },
      },
      {
        name: 'confirm',
        async run({ job, input, outputs }) {
          const r = await service.recordPaidOrder({ workspaceId: job.workspaceId, orderId: orderIdOf(input) });
          const delivered = outputs.deliver as { status?: string } | undefined;
          return { output: { status: r.fulfilment?.status ?? delivered?.status ?? 'unknown', deliveredAt: r.fulfilment?.delivery.deliveredAt ?? null } };
        },
      },
    ],
  };
}
