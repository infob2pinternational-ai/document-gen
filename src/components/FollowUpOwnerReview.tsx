import { useEffect, useState } from 'react';
import { authenticatedHeaders } from '../services/apiAuth';
import { getKolkataToday } from '../utils/dateUtils';

type Total = { staff: string; completed: number; postponed: number; customer_callback: number; no_answer: number; not_contacted: number };
type Flag = { follow_up_id: string; customer_name: string; assigned_staff_email: string; original_due: string; original_due_verified: boolean; current_due: string; postponement_count: number; consecutive_without_contact: number; last_reason: string; current_status: string };
type Review = { totals: Total[]; flagged: Flag[]; tasks: Flag[] };
export function FollowUpOwnerReview({ companyId }: { companyId: string }) {
  const [open,setOpen]=useState(false);
  const [day,setDay]=useState(getKolkataToday);
  const [retry,setRetry]=useState(0);
  const [result,setResult]=useState<{key:string;data:Review}|null>(null);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(false);
  const key=`${companyId}:${day}`;
  useEffect(()=>{
    if (!open) return;
    const controller=new AbortController();
    let active=true;
    setLoading(true); setError('');
    void (async()=>{
      try {
        const headers=await authenticatedHeaders();
        if (!active) return;
        const response=await fetch(`/api/followup-review?${new URLSearchParams({company_id:companyId,day})}`,{headers,cache:'no-store',signal:controller.signal});
        const data=await response.json();
        if (!response.ok) throw new Error(data.error || 'Unable to load review.');
        if (active) setResult({key,data});
      } catch(error) { if(active) setError(error instanceof Error ? error.message : 'Unable to load review.'); }
      finally {if(active) setLoading(false);}
    })();
    return ()=>{active=false;controller.abort();};
  },[companyId,day,key,open,retry]);
  const data=result?.key===key ? result.data : null;
  return <section className="card" style={{padding:'1rem',marginBottom:'1rem'}}>
    <button type="button" className="btn btn-secondary" aria-expanded={open} onClick={()=>setOpen(!open)}>Owner follow-up review</button>
    {open && <div style={{display:'grid',gap:'1rem',marginTop:'1rem'}}>
      <label>Review day (India time) <input type="date" value={day} onChange={event=>setDay(event.target.value)} /></label>
      <p>Recorded staff outcomes are self-reported. Existing tasks show a baseline date from activation; earlier postponements are unavailable.</p>
      <button type="button" className="btn btn-secondary" disabled={loading} onClick={()=>setRetry(value=>value+1)}>Refresh review</button>
      {loading && <p role="status">Loading review…</p>}
      {error && <p role="alert">{error} <button type="button" onClick={()=>setRetry(value=>value+1)}>Retry</button></p>}
      {data && <>
        <div style={{overflowX:'auto'}}><table className="table"><caption>Daily actions — completion and postponement are separate</caption><thead><tr><th>Staff</th><th>Completed</th><th>Moved later</th><th>Customer callback</th><th>No answer</th><th>Not contacted</th></tr></thead>
          <tbody>{data.totals.map(row=><tr key={row.staff}><td>{row.staff}</td><td>{row.completed}</td><td>{row.postponed}</td><td>{row.customer_callback}</td><td>{row.no_answer}</td><td>{row.not_contacted}</td></tr>)}</tbody></table>
          {!data.totals.length && <p>No recorded actions for this day.</p>}
        </div>
        <div style={{overflowX:'auto'}}><table className="table"><caption>Original dates and postponement counts (all dates)</caption><thead><tr><th>Customer / Staff</th><th>Original due / baseline</th><th>Current due</th><th>Postponements</th><th>Consecutive without contact</th><th>Latest reason</th></tr></thead><tbody>
          {data.tasks.map(row=><tr key={row.follow_up_id}><td>{row.customer_name}<br/>{row.assigned_staff_email}</td><td>{row.original_due.replace('T',' ')}{!row.original_due_verified && ' (baseline)'}</td><td>{row.current_due.replace('T',' ')}</td><td>{row.postponement_count}{row.postponement_count >= 2 && !['completed','cancelled'].includes(row.current_status.toLowerCase()) ? ' — Repeated' : ''}</td><td>{row.consecutive_without_contact}</td><td>{row.last_reason}</td></tr>)}
        </tbody></table>{!data.tasks.length && <p>No tracked follow-ups.</p>}</div>
      </>}
    </div>}
  </section>;
}
