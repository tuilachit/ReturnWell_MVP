import type {RecipientOption,RecipientPage} from '../lib/referral-recipients';
export const recipientKey=(option:RecipientOption)=>option.kind==='member'?`member:${option.practitionerId}`:`directory:${option.selection.routeId}:${option.selection.observationHash}`;
export default function ReferralRecipientOptions({page,selected,busy,onSelect}:{page:RecipientPage;selected:RecipientOption|null;busy:boolean;onSelect:(option:RecipientOption)=>void}) {
  return <div className="provider-list">
    {(['confirmed','needs_confirmation'] as const).map(tier=>{
      const options=page.items.filter(x=>x.requirementStatus===tier);
      return options.length?<section key={tier} aria-label={tier==='confirmed'?'Confirmed members':'Needs confirmation'}>
        <h3>{tier==='confirmed'?'Confirmed members':'Needs confirmation'}</h3>
        {options.map(option=><label className={`provider-row ${selected&&recipientKey(selected)===recipientKey(option)?'selected':''}`} key={recipientKey(option)}>
          <input type="radio" name="practitioner" disabled={busy} checked={Boolean(selected&&recipientKey(selected)===recipientKey(option))} onChange={()=>onSelect(option)}/>
          <span className="provider-name"><strong>{option.displayName}</strong><small>{option.practiceName}</small><small>{tier==='confirmed'?'Confirmed member':'Needs confirmation · directory contact'}</small></span>
          <span><strong>{option.location?`${option.location.suburb} ${option.location.postcode}`:'Location not provided'}</strong><small>{option.distanceKm===null?'Distance unavailable':`${option.distanceKm.toFixed(1)} km approximate straight-line distance`}</small>{option.kind==='directory'&&<small>Practice email · may be a shared inbox</small>}</span>
          <ul>{option.reasons.map(reason=><li key={reason}>{reason}</li>)}{option.warnings.map(warning=><li key={warning}>{warning}</li>)}</ul>
        </label>)}
      </section>:null;
    })}
  </div>;
}
