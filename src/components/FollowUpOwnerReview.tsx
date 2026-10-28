import { useEffect, useState } from 'react';
import { authenticatedHeaders } from '../services/apiAuth';
import { getKolkataToday } from '../utils/dateUtils';
import { isOpenTask, matchesAttention, matchesDaily, normalizeEmail, reviewPage, scopeReview, sortReviewTasks } from '../utils/followupReviewDashboard';
import type { ReviewAction, ReviewTask, DailyFilter, AttentionFilter } from '../utils/followupReviewDashboard';
import './FollowUpReview.css';

type Review = { actions: ReviewAction[]; tasks: ReviewTask[] };
const dailyCards: [DailyFilter, string][] = [['all','All actions'],['completed','Completed'],['postponed','Moved later'],['rescheduled','Other reschedules'],['customer_callback','Customer callback'],['no_answer','No answer'],['not_contacted','Not contacted']];
const attentionCards: [AttentionFilter, string][] = [['all','All tracked tasks'],['overdue','Overdue'],['repeated','Postponed 2+ times'],['no_contact','Repeated without contact']];
const dueLabel = (value?: string) => {
  if (!value) return '—';
  const [date,time] = value.replace('T',' ').split(' ');
  return `${date.split('-').reverse().join('-')}${time ? ` ${time.slice(0,5)}` : ''}`;
};
const actionLabel = (action: ReviewAction) => dailyCards.find(([key])=>key===action.event_type)?.[1] || action.event_type;
const outcomeLabel = (action: ReviewAction) => dailyCards.find(([key])=>key===action.outcome)?.[1] || '—';
function Pager({ page, pages, onChange, label }: {page:number;pages:number;onChange:(page:number)=>void;label:string}) {
  return <nav className="review-pager" aria-label={`${label} pages`}>
    <button type="button" className="btn btn-secondary" disabled={page<=1} onClick={()=>onChange(page-1)}>Previous</button>
    <span>Page {page} of {pages}</span>
    <button type="button" className="btn btn-secondary" disabled={page>=pages} onClick={()=>onChange(page+1)}>Next</button>
  </nav>;
}
export function ReviewDashboard({ data }: {data:Review}) {
  const [staff,setStaff]=useState('all');
  const [search,setSearch]=useState('');
  const [daily,setDaily]=useState<DailyFilter>('all');
  const [attention,setAttention]=useState<AttentionFilter>('all');
  const [status,setStatus]=useState('all');
  const [sort,setSort]=useState('postponements');
  const [actionPage,setActionPage]=useState(1);
  const [taskPage,setTaskPage]=useState(1);
  const actions = data.actions || [];
  const tasks = data.tasks || [];
  const staffOptions=[...new Set([...actions.map(row=>normalizeEmail(row.actor_email)),...tasks.map(row=>normalizeEmail(row.assigned_staff_email))].filter(Boolean))].sort();
  const resetPages=()=>{setActionPage(1);setTaskPage(1);};
  const scopedActions=scopeReview(actions,staff,search);
  const scopedTasks=scopeReview(tasks,staff,search);
  const filteredActions=scopedActions.filter(row=>matchesDaily(row,daily)).sort((a,b)=>b.created_at.localeCompare(a.created_at) || String(b.id).localeCompare(String(a.id)));
  const filteredTasks=sortReviewTasks(scopedTasks.filter(row=>matchesAttention(row,attention,getKolkataToday()) && (status==='all' || (status==='open' ? isOpenTask(row) : row.current_status.toLowerCase()===status))),sort);
  const actionSlice=reviewPage(filteredActions,actionPage);
  const taskSlice=reviewPage(filteredTasks,taskPage);
  return <>
    <div className="review-controls">
      <label>Staff<select value={staff} onChange={event=>{setStaff(event.target.value);resetPages();}}><option value="all">All staff</option>{staffOptions.map(email=><option key={email} value={email}>{email}</option>)}</select></label>
      <label>Customer search<input type="search" placeholder="Search customer name" value={search} onChange={event=>{setSearch(event.target.value);resetPages();}} /></label>
      <button type="button" className="btn btn-secondary" onClick={()=>{setStaff('all');setSearch('');setDaily('all');setAttention('all');setStatus('all');setSort('postponements');resetPages();}}>Clear filters</button>
    </div>
    <section aria-labelledby="review-daily-heading">
      <h3 id="review-daily-heading">Selected-day activity</h3>
      <p className="review-help">Counts are recorded actions, not unique customers. Outcome cards overlap with reschedule cards. Staff means the person who recorded the action.</p>
      <div className="review-kpis">{dailyCards.map(([filter,label])=><button type="button" key={filter} className="review-kpi" aria-pressed={daily===filter} aria-controls="review-actions" onClick={()=>{setDaily(filter);setActionPage(1);}}><span>{label}</span><strong>{scopedActions.filter(row=>matchesDaily(row,filter)).length}</strong></button>)}</div>
      <p role="status">{dailyCards.find(([filter])=>filter===daily)?.[1]}: {filteredActions.length} actions match.</p>
      <div className="review-table" id="review-actions"><table className="table"><caption>Action details for the selected review day — times in India</caption><thead><tr><th>Time</th><th>Customer / Staff</th><th>Action / Outcome</th><th>Previous due</th><th>New due</th><th>Reason / Note</th></tr></thead><tbody>{actionSlice.rows.map(row=><tr key={row.id}><td>{new Date(row.created_at).toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit'})}</td><td>{row.customer_name}<small>{row.actor_email || 'Unassigned'}</small></td><td>{actionLabel(row)}<small>{outcomeLabel(row)}</small></td><td>{dueLabel(row.previous_due)}</td><td>{dueLabel(row.new_due)}</td><td>{row.reason || '—'}</td></tr>)}</tbody></table></div>
      {!filteredActions.length && <p>No actions match these filters for the selected day.</p>}
      <Pager {...actionSlice} onChange={setActionPage} label="Daily activity" />
    </section>
    <section aria-labelledby="review-tasks-heading">
      <h3 id="review-tasks-heading">Current follow-up status · all dates</h3>
      <p className="review-help">This is the latest task status, not a snapshot of the selected day. Overdue means an open task due before today in India. Staff means the currently assigned person.</p>
      <div className="review-kpis">{attentionCards.map(([filter,label])=><button type="button" key={filter} className="review-kpi" aria-pressed={attention===filter} aria-controls="review-tasks" onClick={()=>{setAttention(filter);setStatus('all');setTaskPage(1);}}><span>{label}</span><strong>{scopedTasks.filter(row=>matchesAttention(row,filter,getKolkataToday())).length}</strong></button>)}</div>
      <div className="review-controls">
        <label>Task status<select value={status} onChange={event=>{setStatus(event.target.value);setTaskPage(1);}}><option value="all">All statuses</option><option value="open">Open</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select></label>
        <label>Sort tasks<select value={sort} onChange={event=>{setSort(event.target.value);setTaskPage(1);}}><option value="postponements">Most postponements first</option><option value="due">Earliest due first</option><option value="customer">Customer name</option></select></label>
      </div>
      <p role="status">{filteredTasks.length} tasks match. Attention cards count open tasks; “All tracked tasks” includes every status.</p>
      <div className="review-table" id="review-tasks"><table className="table"><caption>Original dates and postponement counts — dates in India</caption><thead><tr><th>Customer / Assigned staff</th><th>Status</th><th>Original due / baseline</th><th>Current due</th><th>Postponements</th><th>Consecutive without contact</th><th>Latest reason</th></tr></thead><tbody>{taskSlice.rows.map(row=><tr key={row.follow_up_id}><td>{row.customer_name}<small>{row.assigned_staff_email || 'Unassigned'}</small></td><td>{row.current_status}</td><td>{dueLabel(row.original_due)}{!row.original_due_verified && <small>Baseline</small>}</td><td>{dueLabel(row.current_due)}</td><td>{row.postponement_count}{matchesAttention(row,'repeated',getKolkataToday()) && <small className="review-warning">Repeated</small>}</td><td>{row.consecutive_without_contact}</td><td>{row.last_reason || '—'}</td></tr>)}</tbody></table></div>
      {!filteredTasks.length && <p>No tasks match these filters.</p>}
      <Pager {...taskSlice} onChange={setTaskPage} label="Current tasks" />
    </section>
  </>;
}
export function FollowUpOwnerReview({ companyId }: { companyId: string }) {
  const [open,setOpen]=useState(false);
  const [day,setDay]=useState(getKolkataToday);
  const [retry,setRetry]=useState(0);
  const [result,setResult]=useState<{key:string;data:Review}|null>(null);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(false);
  const key=`${companyId}:${day}`;
  useEffect(()=>{
    if (!open || !day) return;
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
  return <section className="card followup-review">
    <button type="button" className="btn btn-secondary" aria-expanded={open} onClick={()=>setOpen(!open)}>Follow-up Review</button>
    {open && <div className="review-body">
      <div className="review-controls"><label>Review day (India time)<input type="date" value={day} onChange={event=>setDay(event.target.value)} /></label><button type="button" className="btn btn-secondary" disabled={loading || !day} onClick={()=>setRetry(value=>value+1)}>Refresh review</button></div>
      <p className="review-help">Contact outcomes are self-reported. Older tasks show a baseline date from activation; earlier postponements are unavailable.</p>
      {!day && <p>Select a review day.</p>}
      {loading && <p role="status">Loading review…</p>}
      {error && <p role="alert">{error}{data && ' Showing the last loaded data; refresh to try again.'} <button type="button" onClick={()=>setRetry(value=>value+1)}>Retry</button></p>}
      {data && <ReviewDashboard key={key} data={data} />}
    </div>}
  </section>;
}
