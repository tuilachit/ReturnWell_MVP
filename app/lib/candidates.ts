import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CandidatePage,
  CandidateDetail,
  CandidateDisposition,
  CandidateMutationResult,
  CandidateBatchPage,
  CandidateWithdrawalResult,
} from "../../shared/candidates";
import { invoke } from "./workflow";
export type CandidateFilters = {
  search?: string;
  professionId?: string;
  suburb?: string;
  postcode?: string;
  disposition?: string;
  cursor?: string | null;
  limit?: number;
};
type Mutation = {
  candidateId: string;
  expectedVersion: number;
  reason: string;
  evidenceReference?: string;
  requestId: string;
};
const call = <T>(
  client: SupabaseClient,
  operation: string,
  input: object = {},
) => invoke<T>(client, "review-practitioner", { operation, ...input });
export const listCandidates = (
  client: SupabaseClient,
  filters: CandidateFilters,
) => call<CandidatePage>(client, "candidate_list", filters);
export const loadCandidate = (
  client: SupabaseClient,
  id: string,
  cursors: { observationCursor?: string; eventCursor?: string } = {},
) =>
  call<CandidateDetail>(client, "candidate_detail", {
    candidateId: id,
    ...cursors,
  });
export const disposeCandidate = (
  client: SupabaseClient,
  input: Mutation & { disposition: CandidateDisposition },
) => call<CandidateMutationResult>(client, "candidate_dispose", input);
export const linkCandidateApplication = (
  client: SupabaseClient,
  input: Mutation & { applicationId: string },
) => call<CandidateMutationResult>(client, "candidate_link_application", input);
export const unlinkCandidateApplication = (
  client: SupabaseClient,
  input: Mutation & { applicationId: string },
) =>
  call<CandidateMutationResult>(client, "candidate_unlink_application", input);
export const listCandidateBatches = (client: SupabaseClient, cursor?: string) =>
  call<CandidateBatchPage>(client, "candidate_batches", { cursor });
export const withdrawCandidateBatch = (
  client: SupabaseClient,
  input: {
    batchId: string;
    expectedVersion: number;
    expectedUnsupported: number;
    reason: string;
    requestId: string;
  },
) => call<CandidateWithdrawalResult>(client, "candidate_withdraw_batch", input);
