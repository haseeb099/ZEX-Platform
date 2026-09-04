import { GraphQLClient } from 'graphql-request';
import { TwentyClient } from './twenty.client';
import { TwentyConnectionService } from './twenty-connection.service';
import { TwentyPerson } from './twenty.types';

jest.mock('graphql-request', () => {
  const actual = jest.requireActual('graphql-request');
  return {
    ...actual,
    GraphQLClient: jest.fn().mockImplementation(() => ({
      request: jest.fn(),
    })),
  };
});

describe('TwentyClient', () => {
  const connections = {
    resolve: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('exposes tenant-first CRM methods', () => {
    const client = new TwentyClient(connections as unknown as TwentyConnectionService);
    expect(typeof client.getPerson).toBe('function');
    expect(typeof client.updatePerson).toBe('function');
    expect(typeof client.createOpportunity).toBe('function');
    expect(typeof client.createNote).toBe('function');
    expect(typeof client.createNoteTarget).toBe('function');
    expect(typeof client.findCompaniesByDomain).toBe('function');
    expect(typeof client.findCompaniesByName).toBe('function');
    expect(typeof client.createCompany).toBe('function');

    const sample: TwentyPerson = { id: 'person_1', email: 'a@b.com' };
    expect(sample.id).toBe('person_1');
  });

  it('uses tenant-specific GraphQL URL from TwentyConnectionService', async () => {
    connections.resolve.mockResolvedValue({
      tenantId: 'tenant_a',
      workspaceId: 'ws_a',
      baseUrl: 'https://crm-a.example.com',
      graphqlUrl: 'https://crm-a.example.com/graphql',
      restUrl: 'https://crm-a.example.com/rest',
      apiKey: 'sk_a',
    });

    const mockRequest = jest.fn().mockResolvedValue({
      person: {
        id: 'person_1',
        name: { firstName: 'Ada', lastName: 'Lovelace' },
        emails: { primaryEmail: 'a@b.com' },
      },
    });
    (GraphQLClient as unknown as jest.Mock).mockImplementation(() => ({
      request: mockRequest,
    }));

    const client = new TwentyClient(connections as unknown as TwentyConnectionService);
    const person = await client.getPerson('tenant_a', 'person_1');

    expect(connections.resolve).toHaveBeenCalledWith('tenant_a');
    expect(GraphQLClient).toHaveBeenCalledWith('https://crm-a.example.com/graphql', {
      headers: { Authorization: 'Bearer sk_a' },
    });
    expect(person.id).toBe('person_1');
  });

  it('does not fall back to a shared global GraphQL URL between tenants', async () => {
    connections.resolve
      .mockResolvedValueOnce({
        tenantId: 'tenant_a',
        workspaceId: 'ws_a',
        baseUrl: 'https://a.example.com',
        graphqlUrl: 'https://a.example.com/graphql',
        restUrl: 'https://a.example.com/rest',
        apiKey: 'sk_a',
      })
      .mockResolvedValueOnce({
        tenantId: 'tenant_b',
        workspaceId: 'ws_b',
        baseUrl: 'https://b.example.com',
        graphqlUrl: 'https://b.example.com/graphql',
        restUrl: 'https://b.example.com/rest',
        apiKey: 'sk_b',
      });

    (GraphQLClient as unknown as jest.Mock).mockImplementation(() => ({
      request: jest.fn().mockResolvedValue({ person: { id: 'p' } }),
    }));

    const client = new TwentyClient(connections as unknown as TwentyConnectionService);
    await client.getPerson('tenant_a', 'p1');
    await client.getPerson('tenant_b', 'p2');

    expect(GraphQLClient).toHaveBeenNthCalledWith(1, 'https://a.example.com/graphql', {
      headers: { Authorization: 'Bearer sk_a' },
    });
    expect(GraphQLClient).toHaveBeenNthCalledWith(2, 'https://b.example.com/graphql', {
      headers: { Authorization: 'Bearer sk_b' },
    });
  });
});
