import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GraphQLClient, gql } from 'graphql-request';
import {
  CreateNoteInput,
  CreateOpportunityInput,
  TwentyPerson,
  UpdatePersonInput,
} from './twenty.types';

@Injectable()
export class TwentyClient {
  constructor(private readonly config: ConfigService) {}

  private client(apiKey: string, endpoint?: string): GraphQLClient {
    const url = endpoint || this.config.getOrThrow<string>('TWENTY_GRAPHQL_URL');
    return new GraphQLClient(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });
  }

  async getPerson(apiKey: string, id: string, endpoint?: string): Promise<TwentyPerson> {
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
    const data = await this.client(apiKey, endpoint).request<{ person: TwentyPerson }>(query, {
      id,
    });
    return data.person;
  }

  async updatePerson(
    apiKey: string,
    id: string,
    input: UpdatePersonInput,
    endpoint?: string,
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
    const data = await this.client(apiKey, endpoint).request<{ updatePerson: TwentyPerson }>(
      mutation,
      { id, input },
    );
    return data.updatePerson;
  }

  async createOpportunity(
    apiKey: string,
    input: CreateOpportunityInput,
    endpoint?: string,
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
    const data = await this.client(apiKey, endpoint).request<{
      createOpportunity: { id: string; name: string };
    }>(mutation, { input });
    return data.createOpportunity;
  }

  async createNote(
    apiKey: string,
    input: CreateNoteInput,
    endpoint?: string,
  ): Promise<{ id: string }> {
    const mutation = gql`
      mutation CreateNote($input: NoteInput!) {
        createNote(input: $input) {
          id
          text
          createdAt
        }
      }
    `;
    const data = await this.client(apiKey, endpoint).request<{ createNote: { id: string } }>(
      mutation,
      {
        input: {
          body: input.text,
          // Twenty note linking varies by schema; keep person association in body for MVP
        },
      },
    );
    return data.createNote;
  }
}
