import * as http from 'http';
import { AddressInfo } from 'net';

export type FakeGraphqlBody = {
  query?: string;
  variables?: Record<string, unknown>;
  operationName?: string;
};

export type GraphqlOperationName =
  | 'GetPerson'
  | 'UpdatePerson'
  | 'CreateNote'
  | 'CreateNoteTarget'
  | 'CreateOpportunity'
  | 'FindCompaniesByDomain'
  | 'FindCompaniesByName'
  | 'CreateCompany'
  | 'Unknown';

export function toPinnedPersonResponse(person: FakePerson) {
  return {
    id: person.id,
    name: {
      firstName: person.firstName ?? null,
      lastName: person.lastName ?? null,
    },
    emails: {
      primaryEmail: person.email ?? null,
    },
    jobTitle: person.jobTitle ?? null,
    createdAt: person.createdAt,
    updatedAt: person.updatedAt,
    company: person.company
      ? {
          id: person.company.id,
          name: person.company.name ?? null,
          domainName: person.company.website ? { primaryLinkUrl: person.company.website } : null,
        }
      : null,
  };
}

export function classifyGraphqlOperation(query: string): GraphqlOperationName {
  if (query.includes('query GetPerson') || /\bperson\s*\(\s*filter/.test(query)) {
    return 'GetPerson';
  }
  if (query.includes('mutation UpdatePerson') || query.includes('updatePerson')) {
    return 'UpdatePerson';
  }
  if (query.includes('createNoteTarget')) return 'CreateNoteTarget';
  if (query.includes('createNote')) return 'CreateNote';
  if (query.includes('createOpportunity')) return 'CreateOpportunity';
  if (query.includes('createCompany')) return 'CreateCompany';
  if (query.includes('FindCompaniesByDomain')) return 'FindCompaniesByDomain';
  if (query.includes('FindCompaniesByName')) return 'FindCompaniesByName';
  if (/\bcompanies\s*\(/.test(query) && /domainName/.test(query)) return 'FindCompaniesByDomain';
  if (/\bcompanies\s*\(/.test(query)) return 'FindCompaniesByName';
  return 'Unknown';
}

export type CapturedGraphqlRequest = {
  method: string;
  url: string;
  authorization: string | undefined;
  body: FakeGraphqlBody;
  operation: GraphqlOperationName;
  receivedAt: number;
  order: number;
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

export type FakeCompany = {
  id: string;
  name: string;
  website?: string | null;
};

async function sleep(ms: number) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Minimal localhost GraphQL stand-in for Twenty CRM contract tests.
 * Captures Authorization + operation payloads for assertions.
 */
export class FakeTwentyGraphqlServer {
  private server: http.Server | null = null;
  private readonly requests: CapturedGraphqlRequest[] = [];
  private persons = new Map<string, FakePerson>();
  private companies = new Map<string, FakeCompany>();
  private failOperations = new Set<GraphqlOperationName>();
  private failOnceOperations = new Map<GraphqlOperationName, number>();
  private requestOrder = 0;
  private noteCounter = 0;
  private noteTargetCounter = 0;
  private oppCounter = 0;
  private companyCounter = 0;
  private readonly notes = new Map<string, { id: string; title?: string; markdown?: string }>();
  private readonly noteTargets = new Map<
    string,
    { id: string; noteId: string; targetPersonId: string }
  >();

  seedPerson(person: FakePerson) {
    this.persons.set(person.id, { ...person });
    if (person.company?.id) {
      this.seedCompany({
        id: person.company.id,
        name: person.company.name ?? person.company.id,
        website: person.company.website ?? null,
      });
    }
  }

  seedCompany(company: FakeCompany) {
    this.companies.set(company.id, { ...company });
  }

  getCompanies() {
    return [...this.companies.values()];
  }

  /** Cause the next matching operation(s) to return a GraphQL error until cleared. */
  failOperation(operation: GraphqlOperationName) {
    this.failOperations.add(operation);
  }

  /** Fail the next N matching operations, then succeed (for partial-success retry tests). */
  failOperationTimes(operation: GraphqlOperationName, times = 1) {
    this.failOnceOperations.set(operation, times);
  }

  clearFailedOperations() {
    this.failOperations.clear();
    this.failOnceOperations.clear();
  }

  countOperations(operation: GraphqlOperationName): number {
    return this.requests.filter(r => r.operation === operation).length;
  }

  getRequests(): CapturedGraphqlRequest[] {
    return [...this.requests];
  }

  getRequestsByOperation(operation: GraphqlOperationName): CapturedGraphqlRequest[] {
    return this.requests.filter(r => r.operation === operation);
  }

  clearRequests() {
    this.requests.length = 0;
    this.requestOrder = 0;
    this.noteCounter = 0;
    this.noteTargetCounter = 0;
    this.oppCounter = 0;
    this.companyCounter = 0;
    this.notes.clear();
    this.noteTargets.clear();
  }

  getNotes() {
    return [...this.notes.values()];
  }

  getNoteTargets() {
    return [...this.noteTargets.values()];
  }

  async waitForRequest(
    predicate: (request: CapturedGraphqlRequest) => boolean,
    options: { timeoutMs?: number; intervalMs?: number; label?: string } = {},
  ): Promise<CapturedGraphqlRequest> {
    const timeoutMs = options.timeoutMs ?? 15000;
    const intervalMs = options.intervalMs ?? 25;
    const started = Date.now();

    while (Date.now() - started < timeoutMs) {
      const match = this.requests.find(predicate);
      if (match) return match;
      await sleep(intervalMs);
    }

    throw new Error(
      `Timeout waiting for GraphQL request (${options.label || 'predicate'}); saw ${this.requests.length} request(s): ${this.requests.map(r => r.operation).join(', ') || 'none'}`,
    );
  }

  async waitForOperation(
    operation: GraphqlOperationName,
    options: { timeoutMs?: number; minCount?: number } = {},
  ): Promise<CapturedGraphqlRequest[]> {
    const minCount = options.minCount ?? 1;
    await this.waitForRequest(() => this.getRequestsByOperation(operation).length >= minCount, {
      timeoutMs: options.timeoutMs,
      label: `${operation} x${minCount}`,
    });
    return this.getRequestsByOperation(operation);
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
        const operation = classifyGraphqlOperation(body.query || '');
        this.requestOrder += 1;
        this.requests.push({
          method: req.method || 'GET',
          url: req.url || '/',
          authorization: typeof authorization === 'string' ? authorization : undefined,
          body,
          operation,
          receivedAt: Date.now(),
          order: this.requestOrder,
        });

        if (req.method === 'POST' && (req.url === '/graphql' || req.url?.startsWith('/graphql'))) {
          const payload = this.handleGraphql(body, operation);
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

  private handleGraphql(
    body: FakeGraphqlBody,
    operation: GraphqlOperationName,
  ): { data?: unknown; errors?: { message: string }[] } {
    const failOnceRemaining = this.failOnceOperations.get(operation);
    if (failOnceRemaining !== undefined && failOnceRemaining > 0) {
      const next = failOnceRemaining - 1;
      if (next <= 0) {
        this.failOnceOperations.delete(operation);
      } else {
        this.failOnceOperations.set(operation, next);
      }
      return { errors: [{ message: `contract forced failure (once): ${operation}` }] };
    }

    if (this.failOperations.has(operation)) {
      return { errors: [{ message: `contract forced failure: ${operation}` }] };
    }

    const query = body.query || '';
    const variables = (body.variables || {}) as Record<string, unknown>;

    if (operation === 'GetPerson') {
      const filter = (variables.filter || {}) as { id?: { eq?: string } };
      const id = String(filter.id?.eq || variables.id || '');
      const person = this.persons.get(id);
      if (!person) {
        return { errors: [{ message: `Person ${id} not found` }] };
      }
      return { data: { person: toPinnedPersonResponse(person) } };
    }

    if (operation === 'UpdatePerson') {
      const id = String(variables.personId || variables.id || '');
      const input = (variables.data || variables.input || {}) as Record<string, unknown>;
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
          updatePerson: toPinnedPersonResponse(updated),
        },
      };
    }

    if (operation === 'CreateOpportunity') {
      this.oppCounter += 1;
      const data = (variables.data || variables.input || {}) as Record<string, unknown>;
      return {
        data: {
          createOpportunity: {
            id: `opp_contract_${this.oppCounter}`,
            name: String(data.name || 'Opportunity'),
            stage: String(data.stage || 'NEW'),
          },
        },
      };
    }

    if (operation === 'CreateNote') {
      this.noteCounter += 1;
      const data = (variables.data || variables.input || {}) as Record<string, unknown>;
      const bodyV2 = (data.bodyV2 || {}) as Record<string, unknown>;
      const id = `note_contract_${this.noteCounter}`;
      this.notes.set(id, {
        id,
        title: typeof data.title === 'string' ? data.title : undefined,
        markdown: typeof bodyV2.markdown === 'string' ? bodyV2.markdown : undefined,
      });
      return {
        data: {
          createNote: { id },
        },
      };
    }

    if (operation === 'CreateNoteTarget') {
      this.noteTargetCounter += 1;
      const data = (variables.data || variables.input || {}) as Record<string, unknown>;
      const noteId = String(data.noteId || '');
      const targetPersonId = String(data.targetPersonId || '');
      if (!this.notes.has(noteId)) {
        return { errors: [{ message: `Note ${noteId} not found for CreateNoteTarget` }] };
      }
      const id = `note_target_${this.noteTargetCounter}`;
      this.noteTargets.set(id, { id, noteId, targetPersonId });
      return {
        data: {
          createNoteTarget: { id },
        },
      };
    }

    if (operation === 'FindCompaniesByDomain' || operation === 'FindCompaniesByName') {
      const filter = (variables.filter || {}) as Record<string, any>;
      const domainNeedle = String(
        filter.domainName?.primaryLinkUrl?.ilike || filter.domainName?.primaryLinkUrl?.eq || '',
      )
        .replace(/%/g, '')
        .toLowerCase();
      const nameNeedle = String(filter.name?.ilike || filter.name?.eq || '')
        .replace(/%/g, '')
        .toLowerCase();

      const matches = [...this.companies.values()].filter(c => {
        const website = (c.website || '').toLowerCase();
        const name = (c.name || '').toLowerCase();
        if (operation === 'FindCompaniesByDomain') {
          return domainNeedle ? website.includes(domainNeedle) : false;
        }
        return nameNeedle ? name.includes(nameNeedle) : false;
      });

      return {
        data: {
          companies: {
            edges: matches.map(c => ({
              node: {
                id: c.id,
                name: c.name,
                domainName: c.website ? { primaryLinkUrl: c.website } : null,
              },
            })),
          },
        },
      };
    }

    if (operation === 'CreateCompany') {
      this.companyCounter += 1;
      const data = (variables.data || variables.input || {}) as Record<string, any>;
      const id = `company_contract_${this.companyCounter}`;
      const website =
        data.domainName?.primaryLinkUrl ||
        (typeof data.domain === 'string' ? data.domain : null) ||
        null;
      const company: FakeCompany = {
        id,
        name: String(data.name || 'Company'),
        website,
      };
      this.companies.set(id, company);
      return {
        data: {
          createCompany: {
            id: company.id,
            name: company.name,
            domainName: company.website ? { primaryLinkUrl: company.website } : null,
          },
        },
      };
    }

    return { errors: [{ message: `Unhandled GraphQL operation: ${query.slice(0, 80)}` }] };
  }
}
