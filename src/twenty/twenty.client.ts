import { Injectable } from '@nestjs/common';
import { GraphQLClient, gql } from 'graphql-request';
import { TwentyConnectionService } from './twenty-connection.service';
import {
  CreateNoteInput,
  CreateOpportunityInput,
  TwentyPerson,
  UpdatePersonInput,
} from './twenty.types';

/**
 * Tenant-first Twenty GraphQL client.
 * Resolves per-tenant graphqlUrl + API key via TwentyConnectionService.
 * Does not use global TWENTY_GRAPHQL_URL for production CRM calls.
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
      query GetPerson($id: ID!) {
        person(id: $id) {
          id
          firstName
          lastName
          email
          jobTitle
          createdAt
          updatedAt
          company {
            id
            name
            website
          }
        }
      }
    `;
    const data = await (
      await this.clientFor(tenantId)
    ).request<{ person: TwentyPerson }>(query, {
      id,
    });
    return data.person;
  }

  async updatePerson(
    tenantId: string,
    id: string,
    input: UpdatePersonInput,
  ): Promise<TwentyPerson> {
    const mutation = gql`
      mutation UpdatePerson($id: ID!, $input: PersonInput!) {
        updatePerson(id: $id, input: $input) {
          id
          firstName
          lastName
          email
          jobTitle
        }
      }
    `;
    const data = await (
      await this.clientFor(tenantId)
    ).request<{ updatePerson: TwentyPerson }>(mutation, { id, input });
    return data.updatePerson;
  }

  async createOpportunity(
    tenantId: string,
    input: CreateOpportunityInput,
  ): Promise<{ id: string; name: string }> {
    const mutation = gql`
      mutation CreateOpportunity($input: OpportunityInput!) {
        createOpportunity(input: $input) {
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
    }>(mutation, { input });
    return data.createOpportunity;
  }

  async createNote(tenantId: string, input: CreateNoteInput): Promise<{ id: string }> {
    const mutation = gql`
      mutation CreateNote($input: NoteInput!) {
        createNote(input: $input) {
          id
          text
          createdAt
        }
      }
    `;
    const data = await (
      await this.clientFor(tenantId)
    ).request<{ createNote: { id: string } }>(mutation, {
      input: {
        body: input.text,
        // Twenty note linking varies by schema; keep person association in body for MVP
      },
    });
    return data.createNote;
  }
}
