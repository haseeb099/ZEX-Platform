import { Injectable } from '@nestjs/common';
import { GraphQLClient, gql } from 'graphql-request';
import { TwentyConnectionService } from './twenty-connection.service';
import { mapTwentyPersonRecord } from './twenty-person.mapper';
import { mapOpportunityStageToTwenty } from './twenty-stage.constants';
import {
  CreateNoteInput,
  CreateNoteTargetInput,
  CreateOpportunityInput,
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
}
