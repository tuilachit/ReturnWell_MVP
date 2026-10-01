import type { SupabaseClient } from "@supabase/supabase-js";
import { invoke } from "./workflow.ts";
export type PracticeCommand =
  | {
      operation: "list";
      organisationId?: string;
      cursor?: string;
      memberCursor?: string;
    }
  | {
      operation: "create";
      name: string;
      ownerUserId: string;
      evidenceReference: string;
      requestId: string;
    }
  | {
      operation: "reviewContact";
      organisationId: string;
      expectedVersion: number;
      contactPhone: string;
      contactEmail: string;
      secureInstructions: string;
      evidenceReference: string;
      requestId: string;
    }
  | {
      operation: "reviewInviter";
      organisationId: string;
      memberId: string;
      expectedVersion: number;
      displayName: string;
      evidenceReference: string;
      requestId: string;
    }
  | {
      operation: "revokeMember";
      organisationId: string;
      memberId: string;
      expectedVersion: number;
      reason: string;
      requestId: string;
    };
export type PracticeMember = {
  id: string;
  userId: string;
  email: string;
  role: string;
  active: boolean;
  version: number;
  inviterName: string | null;
};
export type PracticeRecord = {
  id: string;
  name: string;
  version: number;
  contact: {
    phone: string | null;
    email: string | null;
    instructions: string | null;
    reviewedAt: string;
  } | null;
  members: PracticeMember[];
  nextMemberCursor: string | null;
};
export type PracticeResult = {
  practices?: PracticeRecord[];
  nextCursor?: string | null;
  organisationId?: string;
  version?: number;
  ok?: boolean;
};
export function managePractice(
  client: SupabaseClient,
  command: PracticeCommand,
): Promise<PracticeResult> {
  return invoke(client, "manage-practice", command);
}
