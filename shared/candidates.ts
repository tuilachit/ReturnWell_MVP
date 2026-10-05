export type CandidateDisposition = 'unreviewed' | 'needs_clarification' | 'duplicate' | 'unsuitable' | 'reviewed_for_onboarding';
export type CandidateLocation = {suburb:string|null; postcode:string|null; state:string|null};
export type CandidateImportRecord = {
  sourceId:string; displayName:string; professionIds:string[]; practiceNames:string[];
  locations:CandidateLocation[]; sourceUrls:string[]; observedAt:string|null;
  locationScope:string|null; reviewFlags:string[]; raw:Record<string,unknown>; observationHash:string;
};
export type CandidateImportManifest = {
  format:'returnwell-private-candidates-v1'; digest:string;
  inputs:{label:string;sha256:string;count:number}[];recordCount:number;flaggedCount:number;
};
export type CandidatePreparedBatch = {manifest:CandidateImportManifest;records:CandidateImportRecord[]};
export type CandidateImportReceipt = {batchId:string;digest:string;inserted:number;newObservations:number;unchanged:number;flagged:number;replayed:boolean;status:'completed'|'withdrawn'};
export type CandidateSummary = {id:string;displayName:string;professionIds:string[];practiceNames:string[];locations:CandidateLocation[];disposition:CandidateDisposition;version:number;reviewRequired:boolean;linkedApplicationId:string|null};
export type CandidatePage = {items:CandidateSummary[];total:number;nextCursor:string|null};
export type CandidateMutationResult = {ok:true;candidateId:string;version:number};
export type CandidateObservation = {id:string;record:CandidateImportRecord;importedAt:string;active:boolean};
export type CandidateReviewEvent = {id:string;actorId:string;action:string;occurredAt:string;expectedVersion:number;reason:string;evidenceReference:string|null;applicationId:string|null};
export type CandidateDetail = CandidateSummary & {currentObservation:CandidateObservation|null;observations:CandidateObservation[];events:CandidateReviewEvent[];nextObservationCursor:string|null;nextEventCursor:string|null;withdrawn:boolean};
export type CandidateBatchSummary = {batchId:string;digest:string;status:'completed'|'withdrawn';version:number;importedAt:string;recordCount:number;flaggedCount:number;unsupportedOnWithdrawal:number};
export type CandidateBatchPage = {items:CandidateBatchSummary[];nextCursor:string|null};
export type CandidateWithdrawalResult = {ok:true;batchId:string;version:number;hiddenCandidates:number};
