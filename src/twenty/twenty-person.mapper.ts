import { TwentyPerson } from './twenty.types';

type TwentyNameShape = { firstName?: string | null; lastName?: string | null } | null | undefined;
type TwentyEmailsShape =
  { primaryEmail?: string | null; additionalEmails?: string[] | null } | null | undefined;
type TwentyCompanyShape =
  | {
      id?: string;
      name?: string | null;
      domainName?: { primaryLinkUrl?: string | null } | null;
      website?: string | null;
    }
  | null
  | undefined;

/** Map pinned Twenty workspace GraphQL person record → platform TwentyPerson. */
export function mapTwentyPersonRecord(
  raw: Record<string, unknown> | null | undefined,
): TwentyPerson {
  if (!raw || typeof raw.id !== 'string') {
    throw new Error('Invalid Twenty person record: missing id');
  }

  const name = raw.name as TwentyNameShape;
  const emails = raw.emails as TwentyEmailsShape;
  const company = raw.company as TwentyCompanyShape;
  const website =
    company?.domainName?.primaryLinkUrl ||
    company?.website ||
    (typeof company?.name === 'string' ? undefined : undefined);

  return {
    id: raw.id,
    firstName: name?.firstName ?? (raw.firstName as string | null | undefined) ?? null,
    lastName: name?.lastName ?? (raw.lastName as string | null | undefined) ?? null,
    email: emails?.primaryEmail ?? (raw.email as string | null | undefined) ?? null,
    jobTitle: (raw.jobTitle as string | null | undefined) ?? null,
    createdAt: raw.createdAt as string | undefined,
    updatedAt: raw.updatedAt as string | undefined,
    company: company?.id
      ? {
          id: company.id,
          name: company.name ?? null,
          website: website ?? null,
        }
      : null,
  };
}

/** Normalize Twenty webhook `record` payload for worker snapshot / legacy flat fields. */
export function normalizeWebhookPersonRecord(
  record: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!record) return null;
  const mapped = mapTwentyPersonRecord(record);
  return {
    ...record,
    id: mapped.id,
    firstName: mapped.firstName,
    lastName: mapped.lastName,
    email: mapped.email,
    jobTitle: mapped.jobTitle,
  };
}
