import assert from 'node:assert/strict';
import test from 'node:test';
import { professions, getProfession, professionLabel, supportedProfessions } from '../app/lib/professions.ts';
import { normalizeTerm } from '../app/lib/terminology.ts';

const researchIds = 'physiotherapist psychologist occupational_therapist exercise_physiologist speech_pathologist dietitian nutritionist podiatrist audiologist social_worker genetic_counsellor rehabilitation_counsellor counsellor psychotherapist chiropractor osteopath optometrist pharmacist orthoptist orthotist prosthetist pedorthist art_therapist music_therapist child_life_therapist diversional_therapist radiographer medical_radiation_practitioner radiation_therapist nuclear_medicine_technologist sonographer cardiac_physiologist sexual_assault_worker welfare_worker'.split(' ');
test('every research profession has an explicit scope decision', () => {
  assert.deepEqual(professions.map(p => p.id).sort(), researchIds.sort());
  assert.ok(professions.every(p => ['supported','review_required','out_of_scope'].includes(p.scope) && p.sourceUrls.length));
});
test('catalogue ids are unique and no new protocol is silently activated', () => {
  assert.equal(new Set(professions.map(p => p.id)).size, professions.length);
  assert.deepEqual(supportedProfessions.map(p => p.id), ['physiotherapist','psychologist']);
});
test('unknown profession is not psychology', () => {
  assert.equal(getProfession('invented'), undefined);
  assert.equal(professionLabel('invented'), 'Unsupported profession (invented)');
});
test('non-AHPRA professions never require an AHPRA label', () => {
  assert.equal(getProfession('dietitian').route, 'professional_body');
  assert.equal(getProfession('dietitian').credentialLabel, 'Professional credential');
});
test('known terms normalize, ambiguous or unknown terms are not guessed', () => {
  assert.deepEqual(normalizeTerm('funding',' self-funded '), {id:'self_funded',label:'Self funded'});
  assert.deepEqual(normalizeTerm('language',' mandarin '), {id:'mandarin',label:'Mandarin'});
  assert.equal(normalizeTerm('language','Chinese'), null);
  assert.equal(normalizeTerm('language','Wheelchair access'), null);
  assert.equal(normalizeTerm('service','other'), null);
});
