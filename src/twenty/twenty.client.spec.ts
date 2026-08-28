import { TwentyClient } from './twenty.client';
import { TwentyPerson } from './twenty.types';

describe('TwentyClient', () => {
  it('builds and exposes getPerson/updatePerson methods', () => {
    const config = {
      getOrThrow: (key: string) => {
        if (key === 'TWENTY_GRAPHQL_URL') return 'https://example.test/graphql';
        throw new Error(`missing ${key}`);
      },
    };
    const client = new TwentyClient(config as never);
    expect(typeof client.getPerson).toBe('function');
    expect(typeof client.updatePerson).toBe('function');

    const sample: TwentyPerson = { id: 'person_1', email: 'a@b.com' };
    expect(sample.id).toBe('person_1');
  });
});
