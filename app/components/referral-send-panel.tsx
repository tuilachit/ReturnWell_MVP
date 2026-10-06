import type {RecipientOption} from '../lib/referral-recipients';
import type {InviteReferral} from '../lib/referral-growth';
export default function ReferralSendPanel({selected,contactBasis,contactConsentConfirmed,consentConfirmed,busy,uncertain,preview=false,onSend,onContactBasis,onContactConsent,onConsent}:{
  selected:RecipientOption|null;contactBasis:InviteReferral['contactBasis']|'';contactConsentConfirmed:boolean;consentConfirmed:boolean;busy:boolean;uncertain:boolean;preview?:boolean;
  onSend:()=>Promise<void>;onContactBasis:(value:InviteReferral['contactBasis']|'')=>void;onContactConsent:(value:boolean)=>void;onConsent:(value:boolean)=>void;
}) {
  const directory=selected?.kind==='directory';
  return <aside className="send-card">
    <h2>{preview?'Record referral':'Send referral'}</h2>
    <p>{preview?'This preview does not save or send anything.':directory?'We will save the referral and attempt a private notification to this practice email. Patient details are released only after the intended recipient passes professional and ownership review.':'We will save the referral and attempt an email notification. Delivery status is recorded separately from saving the referral.'}</p>
    {directory&&<fieldset disabled={busy||uncertain} style={{border:0,padding:0}}>
      <legend className="sr-only">Receiving practice permission</legend>
      <p>Funding, availability and other unconfirmed requirements need checking. A publicly listed email is not permission to contact.</p>
      <label htmlFor="referral-contact-basis">Permission to contact</label><select id="referral-contact-basis" value={contactBasis} onChange={e=>onContactBasis(e.target.value as InviteReferral['contactBasis']|'')}><option value="">Choose a recorded basis</option><option value="recipient_requested">The recipient requested this referral</option><option value="documented_permission">I have documented permission</option></select>
      <label className="consent-check"><input type="checkbox" checked={contactConsentConfirmed} onChange={e=>onContactConsent(e.target.checked)}/><span>I have permission to send this referral notification.</span></label>
      <p>Patient consent expires after seven days if the referral cannot be released. Resending does not extend it.</p>
    </fieldset>}
    <label className="consent-check"><input type="checkbox" checked={consentConfirmed} disabled={busy||uncertain} onChange={e=>onConsent(e.target.checked)}/><span>I confirm the patient has consented and the information is accurate.</span></label>
    {uncertain&&!busy&&<p role="status">This save is not yet confirmed. Keep this page open. Check and retry uses the same submission without changing details or creating a second referral.</p>}
    <button className="button primary full" disabled={busy||!selected||(!uncertain&&(!consentConfirmed||(directory&&(!contactBasis||!contactConsentConfirmed))))} onClick={()=>void onSend()}>{busy?'Sending…':uncertain?'Check and retry':preview?'Record referral':'Send referral'}</button>
  </aside>;
}
