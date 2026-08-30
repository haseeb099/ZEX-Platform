import { mapTwentyPersonRecord, normalizeWebhookPersonRecord } from './twenty-person.mapper';

describe('twenty-person.mapper', () => {
  it('maps pinned Twenty person GraphQL shape to TwentyPerson', () => {
    const mapped = mapTwentyPersonRecord({
      id: 'p1',
      name: { firstName: 'ZEX', lastName: 'Staging Test' },
      emails: { primaryEmail: 'zex-staging-test@example.invalid' },
      jobTitle: 'Engineer',
      company: {
        id: 'co1',
        name: 'Acme',
        domainName: { primaryLinkUrl: 'acme.test' },
      },
    });

    expect(mapped).toEqual({
      id: 'p1',
      firstName: 'ZEX',
      lastName: 'Staging Test',
      email: 'zex-staging-test@example.invalid',
      jobTitle: 'Engineer',
      createdAt: undefined,
      updatedAt: undefined,
      company: { id: 'co1', name: 'Acme', website: 'acme.test' },
    });
  });

  it('normalizes webhook record for worker snapshot', () => {
    const normalized = normalizeWebhookPersonRecord({
      id: 'p1',
      name: { firstName: 'Ada', lastName: 'Lovelace' },
      emails: { primaryEmail: 'ada@test.com' },
      jobTitle: 'Engineer',
    });

    expect(normalized).toMatchObject({
      id: 'p1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@test.com',
      jobTitle: 'Engineer',
    });
  });
});
