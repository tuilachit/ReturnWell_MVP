export const legacyCandidate = (overrides = {}) => ({
  candidate_id: 'fictional-a', display_name: 'Fictional Legacy Person', profession: 'physiotherapist',
  practice_names: ['Fictional Practice'], locations: [{suburb:'Sydney',postcode:'2000',state:'NSW',sourceUrl:'https://example.com/team'}],
  source_urls:['https://example.com/team'], telehealth:null, accepting_new_referrals:null,
  funding_types_raw:[], languages_raw:[], ahpra_registration_number:null, ...overrides,
});
export const pilotCandidate = (overrides = {}) => ({
  candidate_id:'fictional-b',display_name:'Fictional Pilot Person',profession:'psychologist',practice_name:'Fictional Clinic',
  locations:[],source_url:'https://example.org/team',scraped_at:'2026-09-30T01:00:00Z',
  telehealth:null,accepting_new_referrals:null,active:false,provider_confirmation_status:'not_confirmed',...overrides,
});
export const expandedCandidate = (overrides = {}) => ({
  candidate_id:'fictional-multi',display_name:'Fictional Multiple Roles',professions:['physiotherapist','occupational_therapist'],
  practice_name:'Fictional Allied Health',locations:[],source_urls:['https://example.net/team'],
  telehealth:null,active:false,location_scope:'practice_level_not_confirmed',...overrides,
});
