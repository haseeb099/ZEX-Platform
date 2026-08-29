import * as http from 'http';
import { AddressInfo } from 'net';

export type FakeGraphqlBody = {
  query?: string;
  variables?: Record<string, unknown>;
  operationName?: string;
};

export type CapturedGraphqlRequest = {
  method: string;
  url: string;
  authorization: string | undefined;
  body: FakeGraphqlBody;
};

export type FakePerson = {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  jobTitle?: string | null;
  createdAt?: string;
  updatedAt?: string;
  company?: { id: string; name?: string; website?: string } | null;
};

/**
 * Minimal localhost GraphQL stand-in for Twenty CRM contract tests.
 * Captures Authorization + operation payloads for assertions.
 */
export class FakeTwentyGraphqlServer {
  private server: http.Server | null = null;
  private readonly requests: CapturedGraphqlRequest[] = [];
  private persons = new Map<string, FakePerson>();

  seedPerson(person: FakePerson) {
    this.persons.set(person.id, { ...person });
  }

  getRequests(): CapturedGraphqlRequest[] {
    return [...this.requests];
  }

  clearRequests() {
    this.requests.length = 0;
  }

  async start(): Promise<{ baseUrl: string; graphqlUrl: string; restUrl: string; port: number }> {
    if (this.server) {
      throw new Error('FakeTwentyGraphqlServer already started');
    }

    this.server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let body: FakeGraphqlBody = {};
        try {
          body = raw ? (JSON.parse(raw) as FakeGraphqlBody) : {};
        } catch {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ errors: [{ message: 'Invalid JSON' }] }));
          return;
        }

        const authorization = req.headers.authorization;
        this.requests.push({
          method: req.method || 'GET',
          url: req.url || '/',
          authorization: typeof authorization === 'string' ? authorization : undefined,
          body,
        });

        if (req.method === 'POST' && (req.url === '/graphql' || req.url?.startsWith('/graphql'))) {
          const payload = this.handleGraphql(body);
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(payload));
          return;
        }

        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ errors: [{ message: 'Not found' }] }));
      });
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(0, '127.0.0.1', () => resolve());
    });

    const address = this.server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;
    return {
      baseUrl,
      graphqlUrl: `${baseUrl}/graphql`,
      restUrl: `${baseUrl}/rest`,
      port: address.port,
    };
  }

  async stop() {
    if (!this.server) return;
    const server = this.server;
    this.server = null;
    await new Promise<void>((resolve, reject) => {
      server.close(err => (err ? reject(err) : resolve()));
    });
  }

  private handleGraphql(body: FakeGraphqlBody): { data?: unknown; errors?: { message: string }[] } {
    const query = body.query || '';
    const variables = (body.variables || {}) as Record<string, unknown>;

    if (query.includes('query GetPerson') || /\bperson\s*\(/.test(query)) {
      const id = String(variables.id || '');
      const person = this.persons.get(id);
      if (!person) {
        return { errors: [{ message: `Person ${id} not found` }] };
      }
      return { data: { person } };
    }

    if (query.includes('mutation UpdatePerson') || query.includes('updatePerson')) {
      const id = String(variables.id || '');
      const input = (variables.input || {}) as Record<string, unknown>;
      const existing = this.persons.get(id) || { id };
      const updated: FakePerson = {
        ...existing,
        id,
        jobTitle: typeof input.jobTitle === 'string' ? input.jobTitle : (existing.jobTitle ?? null),
        firstName: existing.firstName,
        lastName: existing.lastName,
        email: existing.email,
      };
      this.persons.set(id, updated);
      return {
        data: {
          updatePerson: {
            id: updated.id,
            firstName: updated.firstName ?? null,
            lastName: updated.lastName ?? null,
            email: updated.email ?? null,
            jobTitle: updated.jobTitle ?? null,
          },
        },
      };
    }

    if (query.includes('createOpportunity')) {
      return {
        data: {
          createOpportunity: {
            id: 'opp_contract_1',
            name: String((variables.input as { name?: string })?.name || 'Opportunity'),
            stage: 'prospect',
          },
        },
      };
    }

    if (query.includes('createNote')) {
      return {
        data: {
          createNote: {
            id: 'note_contract_1',
            text: 'ok',
            createdAt: new Date().toISOString(),
          },
        },
      };
    }

    return { errors: [{ message: `Unhandled GraphQL operation: ${query.slice(0, 80)}` }] };
  }
}
