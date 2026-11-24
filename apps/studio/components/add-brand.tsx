'use client';
import { useActionState } from 'react';
import { addBrandAction } from '../app/actions';
import { EXISTING_INDUSTRIES } from '../../web/lib/aimp/onboarding/existing';

export function AddBrand() {
  const [state, action, pending] = useActionState(addBrandAction, { errors: {} as Record<string, string> });
  const e = state.errors;
  const zone = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'Australia/Perth';
  return (
    <form action={action} className="sh-card sh-form">
      <h2 style={{ margin: 0 }}>Add a brand</h2>
      <label>Business name<input name="businessName" required maxLength={80} />{e.businessName ? <span className="sh-err">{e.businessName}</span> : null}</label>
      <label>Kind of business<select name="industry" defaultValue=""><option value="">Choose the closest match</option>{EXISTING_INDUSTRIES.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select>{e.industry ? <span className="sh-err">{e.industry}</span> : null}</label>
      <label>What it sells<textarea name="offer" rows={2} maxLength={300} />{e.offer ? <span className="sh-err">{e.offer}</span> : null}</label>
      <label>Who the customers are<input name="audience" maxLength={200} />{e.audience ? <span className="sh-err">{e.audience}</span> : null}</label>
      <label>Website (optional)<input name="website" inputMode="url" placeholder="yourbrand.com" />{e.website ? <span className="sh-err">{e.website}</span> : null}</label>
      <input type="hidden" name="timezone" value={zone} />
      {e.form ? <p className="sh-err">{e.form}</p> : null}
      <button className="sh-btn" disabled={pending}>{pending ? 'Adding…' : 'Add brand'}</button>
    </form>
  );
}
