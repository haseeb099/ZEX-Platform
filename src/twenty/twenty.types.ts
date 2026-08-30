export type TwentyPerson = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  jobTitle?: string | null;
  createdAt?: string;
  updatedAt?: string;
  company?: {
    id: string;
    name?: string | null;
    website?: string | null;
  } | null;
};

export type UpdatePersonInput = {
  /** @deprecated Pinned Twenty links company by id/connect — use companyId when known. */
  company?: string;
  companyId?: string;
  jobTitle?: string;
  /** Not a standard Person field on pinned Twenty — ignored at CRM boundary. */
  location?: string;
  [key: string]: unknown;
};

export type CreateOpportunityInput = {
  personId: string;
  name: string;
  stage?: string;
  probability?: number;
};

export type CreateNoteInput = {
  text: string;
  title?: string;
};

export type CreateNoteTargetInput = {
  noteId: string;
  personId: string;
};
