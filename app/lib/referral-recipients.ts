import type { SupabaseClient } from '@supabase/supabase-js';
import type { Practitioner } from '../types';
import type { DirectoryPage, searchPractitioners } from './directory.ts';
import { invoke } from './workflow.ts';
export type DirectorySelection = { candidateId: string; observationHash: string; routeId: string };
export type RecipientCommon = {
  displayName: string; professionId: string; practiceName: string;
  location: Practitioner['location']; distanceKm: number | null;
  reasons: string[]; warnings: string[]; requirementStatus: 'confirmed' | 'needs_confirmation';
};
export type RecipientOption = RecipientCommon & (
  { kind: 'member'; practitionerId: string } | { kind: 'directory'; selection: DirectorySelection }
);
export type RecipientPage = {
  items: RecipientOption[]; nextCursor: string | null;
  counts: { confirmed: number; needsConfirmation: number }; geography: DirectoryPage['geography'];
};
export function searchReferralRecipients(client: SupabaseClient,input: Parameters<typeof searchPractitioners>[1]): Promise<RecipientPage> {
  const limit = input.limit ?? 25;
  return invoke(client,'search-practitioners',{...input,operation:'recipients',cursor:input.cursor ?? null,
    limit:Math.min(50,Math.max(1,Math.trunc(Number.isFinite(limit)?limit:25)))});
}
