import { Injectable } from '@nestjs/common';
import { GraphQLClient, gql } from 'graphql-request';
import { TwentyConnectionService } from './twenty-connection.service';
import { mapTwentyPersonRecord } from './twenty-person.mapper';
import { mapOpportunityStageToTwenty } from './twenty-stage.constants';
import {
  CreateCompanyInput,
  CreateNoteInput,
  CreateNoteTargetInput,
  CreateOpportunityInput,
  TwentyCompany,
  TwentyPerson,
  UpdatePersonInput,
} from './twenty.types';

/**
 * Tenant-first Twenty GraphQL client (pinned Twenty / ZEX-CRM workspace schema).
 * Uses filter-based reads and `data:` mutation args — not legacy PersonInput shapes.
 */
@Injectable()
export class TwentyClient {
  constructor(private readonly connections: TwentyConnectionService) {}

  private async clientFor(tenantId: string): Promise<GraphQLClient> {
    const connection = await this.connections.resolve(tenantId);
    return new GraphQLClient(connection.graphqlUrl, {
      headers: {
        Authorization: `Bearer ${connection.apiKey}`,
      },
    });
  }

  async getPerson(tenantId: string, id: string): Promise<TwentyPerson> {
    const query = gql`
      query GetPerson($filter: PersonFilterInput!) {
        person(filter: $filter) {
          id
          name {
            firstName
            lastName
          }
          emails {
            primaryEmail
          }
          jobTitle
          createdAt
          updatedAt
          company {
            id
            name
            domainName {
              primaryLinkUrl
            }
          }
        }
      }
    `;
    const data = await (
      await this.clientFor(tenantId)
    ).request<{ person: Record<string, unknown> | null }>(query, {
      filter: { id: { eq: id } },
    });

    if (!data.person) {
      throw new Error(`Person ${id} not found`);
    }

    return mapTwentyPersonRecord(data.person);
  }

  async updatePerson(
    tenantId: string,
    id: string,
    input: UpdatePersonInput,
  ): Promise<TwentyPerson> {
    const data: Record<string, unknown> = {};

    if (input.jobTitle) {
      data.jobTitle = input.jobTitle;
    }

    // Pinned Twenty Person has no `location` field; company linking requires UUID/connect.
    if (input.companyId) {
      data.companyId = input.companyId;
    }

    const mutation = gql`
      mutation UpdatePerson($personId: UUID!, $data: PersonUpdateInput!) {
        updatePerson(id: $personId, data: $data) {
          id
          name {
            firstName
            lastName
          }
          emails {
            primaryEmail
          }
          jobTitle
          company {
            id
            name
          }
        }
      }
    `;

    const result = await (
      await this.clientFor(tenantId)
    ).request<{ updatePerson: Record<string, unknown> }>(mutation, {
      personId: id,
      data,
    });

    return mapTwentyPersonRecord(result.updatePerson);
  }

  async createOpportunity(
    tenantId: string,
    input: CreateOpportunityInput,
  ): Promise<{ id: string; name: string }> {
    const mutation = gql`
      mutation CreateOpportunity($data: OpportunityCreateInput!) {
        createOpportunity(data: $data) {
          id
          name
          stage
        }
      }
    `;

    const data = await (
      await this.clientFor(tenantId)
    ).request<{
      createOpportunity: { id: string; name: string };
    }>(mutation, {
      data: {
        name: input.name,
        pointOfContactId: input.personId,
        stage: mapOpportunityStageToTwenty(input.stage),
      },
    });

    return data.createOpportunity;
  }

  /**
   * Create a Note record only. Linking to a Person is a separate irreversible
   * mutation (`createNoteTarget`) — callers must checkpoint each step.
   */
  async createNote(tenantId: string, input: CreateNoteInput): Promise<{ id: string }> {
    const mutation = gql`
      mutation CreateNote($data: NoteCreateInput!) {
        createNote(data: $data) {
          id
        }
      }
    `;

    const noteResult = await (
      await this.clientFor(tenantId)
    ).request<{ createNote: { id: string } }>(mutation, {
      data: {
        title: input.title || 'ZEX Automation',
        bodyV2: {
          markdown: input.text,
          blocknote: null,
        },
      },
    });

    return noteResult.createNote;
  }

  /** Link an existing Note to a Person (pinned Twenty `createNoteTarget`). */
  async createNoteTarget(tenantId: string, input: CreateNoteTargetInput): Promise<{ id: string }> {
    const mutation = gql`
      mutation CreateNoteTarget($data: NoteTargetCreateInput!) {
        createNoteTarget(data: $data) {
          id
        }
      }
    `;

    const result = await (
      await this.clientFor(tenantId)
    ).request<{ createNoteTarget: { id: string } }>(mutation, {
      data: {
        noteId: input.noteId,
        targetPersonId: input.personId,
      },
    });

    return result.createNoteTarget;
  }

  /**
   * Find companies by normalized domain (pinned Twenty Links `domainName.primaryLinkUrl`).
   * Uses ilike contains on the domain host for matching.
   */
  async findCompaniesByDomain(tenantId: string, domain: string): Promise<TwentyCompany[]> {
    const query = gql`
      query FindCompaniesByDomain($filter: CompanyFilterInput!, $first: Int) {
        companies(filter: $filter, first: $first) {
          edges {
            node {
              id
              name
              domainName {
                primaryLinkUrl
              }
            }
          }
        }
      }
    `;

    const data = await (
      await this.clientFor(tenantId)
    ).request<{
      companies: {
        edges: Array<{
          node: {
            id: string;
            name?: string | null;
            domainName?: { primaryLinkUrl?: string | null } | null;
          };
        }>;
      };
    }>(query, {
      filter: {
        domainName: {
          primaryLinkUrl: { ilike: `%${domain}%` },
        },
      },
      first: 20,
    });

    return (data.companies?.edges ?? []).map(edge => mapTwentyCompanyRecord(edge.node));
  }

  /** Name search for POSSIBLE_MATCH when domain exact match is unavailable. */
  async findCompaniesByName(tenantId: string, name: string): Promise<TwentyCompany[]> {
    const query = gql`
      query FindCompaniesByName($filter: CompanyFilterInput!, $first: Int) {
        companies(filter: $filter, first: $first) {
          edges {
            node {
              id
              name
              domainName {
                primaryLinkUrl
              }
            }
          }
        }
      }
    `;

    const data = await (
      await this.clientFor(tenantId)
    ).request<{
      companies: {
        edges: Array<{
          node: {
            id: string;
            name?: string | null;
            domainName?: { primaryLinkUrl?: string | null } | null;
          };
        }>;
      };
    }>(query, {
      filter: {
        name: { ilike: `%${name}%` },
      },
      first: 20,
    });

    return (data.companies?.edges ?? []).map(edge => mapTwentyCompanyRecord(edge.node));
  }

  async createCompany(tenantId: string, input: CreateCompanyInput): Promise<TwentyCompany> {
    const mutation = gql`
      mutation CreateCompany($data: CompanyCreateInput!) {
        createCompany(data: $data) {
          id
          name
          domainName {
            primaryLinkUrl
          }
        }
      }
    `;

    const primaryLinkUrl =
      input.websiteUrl || (input.domain ? `https://${input.domain}` : undefined);

    const result = await (
      await this.clientFor(tenantId)
    ).request<{
      createCompany: {
        id: string;
        name?: string | null;
        domainName?: { primaryLinkUrl?: string | null } | null;
      };
    }>(mutation, {
      data: {
        name: input.name,
        ...(primaryLinkUrl
          ? {
              domainName: {
                primaryLinkUrl,
                primaryLinkLabel: input.domain || input.name,
              },
            }
          : {}),
      },
    });

    return mapTwentyCompanyRecord(result.createCompany);
  }
}

function mapTwentyCompanyRecord(raw: {
  id: string;
  name?: string | null;
  domainName?: { primaryLinkUrl?: string | null } | null;
}): TwentyCompany {
  const websiteUrl = raw.domainName?.primaryLinkUrl ?? null;
  return {
    id: raw.id,
    name: raw.name ?? null,
    websiteUrl,
    domain: websiteUrl,
  };
}
