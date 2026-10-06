import type { SupabaseClient } from '@supabase/supabase-js';
import { invoke } from './workflow.ts';
export type PatientContact = { initials: string; preferredMethod: 'phone' | 'email'; phone: string; email: string };
export function validatePatientContact(input: Partial<PatientContact>,final: boolean): string[] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return ['Check patient contact details.'];
  const errors: string[]=[];
  const limits: Record<string,number>={initials:16,phone:32,email:254,preferredMethod:5};
  for(const [key,value] of Object.entries(input)) {
    if(!(key in limits)||typeof value!=='string'||Array.from(value).length>limits[key]) errors.push('Check patient contact details.');
  }
  const initials=typeof input.initials==='string'?input.initials.trim():'';
  if((final&&!initials)||(initials&&!/^[\p{L}\p{M} .'-]+$/u.test(initials))||/[\p{N}\p{Cc}\p{Cf}]/u.test(input.initials??'')) errors.push('Use patient initials only, up to 16 characters.');
  if((final||input.preferredMethod!==undefined)&&!['phone','email'].includes(input.preferredMethod??'')) errors.push('Choose phone or email.');
  const phone=typeof input.phone==='string'?input.phone.trim():'';
  const email=typeof input.email==='string'?input.email.trim():'';
  if(final&&input.preferredMethod==='phone'&&(!phone||!/^\+?[0-9 ().-]+$/.test(phone)||phone.replace(/\D/g,'').length<8||phone.replace(/\D/g,'').length>15)) errors.push('Enter a phone number containing 8–15 digits.');
  if(final&&input.preferredMethod==='email'&&(!email||!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(email)||email.startsWith('.')||email.includes('..')||email.includes('.@'))) errors.push('Enter a valid patient email address.');
  return errors;
}
export const readPatientContact=(client: SupabaseClient,referralId: string)=>
  invoke<PatientContact|null>(client,'manage-referral',{operation:'contact.read',referralId});
