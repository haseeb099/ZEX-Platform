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
  company?: string;
  jobTitle?: string;
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
  personId: string;
  text: string;
};
