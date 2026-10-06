import type {PatientContact} from '../lib/patient-contact';
export const emptyPatientContact:PatientContact={initials:'',preferredMethod:'phone',phone:'',email:''};
export default function PatientContactFields({value,disabled=false,onChange}:{value:PatientContact;disabled?:boolean;onChange:(value:PatientContact)=>void}) {
  return <fieldset disabled={disabled}>
    <legend>Patient contact</legend>
    <p>Initials and one contact method only. These details stay private and are never included in the notification email.</p>
    <div className="form-grid">
      <label>Patient initials<input name="patientInitials" value={value.initials} maxLength={16} autoComplete="off" onChange={e=>onChange({...value,initials:e.target.value})}/></label>
      <div><label htmlFor="patient-contact-method">Preferred contact method</label><select id="patient-contact-method" value={value.preferredMethod} onChange={e=>onChange({...value,preferredMethod:e.target.value as 'phone'|'email',phone:'',email:''})}><option value="phone">Phone</option><option value="email">Email</option></select></div>
      {value.preferredMethod==='phone'
        ?<label>Patient phone<input type="tel" autoComplete="off" value={value.phone} maxLength={32} onChange={e=>onChange({...value,phone:e.target.value,email:''})}/></label>
        :<label>Patient email<input type="email" autoComplete="off" value={value.email} maxLength={254} onChange={e=>onChange({...value,email:e.target.value,phone:''})}/></label>}
    </div>
  </fieldset>;
}
