import { normalizeWebhookPersonRecord } from '@src/twenty/twenty-person.mapper';

/** Observed pinned Twenty webhook payload shape (fields only — no secrets). */
export const PINNED_TWENTY_WEBHOOK_PERSON_CREATED = {
  targetUrl: 'http://platform.example/webhooks/twenty/tenant',
  eventName: 'person.created',
  objectMetadata: { id: 'obj-meta-id', nameSingular: 'person' },
  workspaceId: 'workspace-id',
  webhookId: 'webhook-event-id',
  eventDate: '2026-08-30T00:00:00.000Z',
  record: {
    id: 'person-uuid',
    name: { firstName: 'ZEX', lastName: 'Staging Test' },
    emails: { primaryEmail: 'zex-staging-test@example.invalid', additionalEmails: [] },
    jobTitle: 'Engineer',
  },
};

describe('pinned Twenty webhook payload normalization', () => {
  it('extracts flat person fields from record.name / record.emails', () => {
    const normalized = normalizeWebhookPersonRecord(PINNED_TWENTY_WEBHOOK_PERSON_CREATED.record);
    expect(normalized).toMatchObject({
      id: 'person-uuid',
      firstName: 'ZEX',
      lastName: 'Staging Test',
      email: 'zex-staging-test@example.invalid',
      jobTitle: 'Engineer',
    });
  });
});
