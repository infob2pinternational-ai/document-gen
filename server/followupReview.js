import { requireUser, requireOwnerOrAdminSession, requireCompanyAccess } from './auth.js';
import { isAdditionalFollowupReviewer } from '../shared/followupReviewAccess.js';

export async function requireFollowupReviewAccess(req, res) {
  const auth = await requireUser(req, res);
  if (!auth) return null;
  if (auth.user.email_confirmed_at && isAdditionalFollowupReviewer(auth.user.email)) return auth;
  return requireOwnerOrAdminSession(auth, res);
}

export function dayBounds(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('A valid date is required.');
  const start = new Date(`${day}T00:00:00+05:30`);
  if (!Number.isFinite(+start) || new Date(+start + 19800000).toISOString().slice(0,10) !== day) throw new Error('A valid date is required.');
  return [start.toISOString(), new Date(+start + 86400000).toISOString()];
}
export function summarizeReview(events, states) {
  const totals = new Map();
  for (const event of events) {
    if (!['completed','postponed','rescheduled'].includes(event.event_type)) continue;
    const row = totals.get(event.actor_email) || { staff: event.actor_email, completed: 0, postponed: 0, customer_callback: 0, no_answer: 0, not_contacted: 0 };
    if (event.event_type === 'completed') row.completed++;
    else {
      if (event.event_type === 'postponed') row.postponed++;
      if (['customer_callback','no_answer','not_contacted'].includes(event.outcome)) row[event.outcome]++;
    }
    totals.set(event.actor_email,row);
  }
  return { totals: [...totals.values()].sort((a,b)=>a.staff.localeCompare(b.staff)),
    tasks: states.filter(row=>!row.deleted),
    flagged: states.filter(row=>!row.deleted && !['completed','cancelled'].includes(row.current_status.toLowerCase()) && row.postponement_count >= 2) };
}
export function createFollowupReviewHandler({ authorize = requireFollowupReviewAccess, companyAccess = requireCompanyAccess, request = (...args)=>fetch(...args) } = {}) {
  return async (req,res) => {
    res.setHeader('Cache-Control','private, no-store');
    if (req.method !== 'GET') { res.status(405).json({error:'Method not allowed.'}); return; }
    const auth = await authorize(req,res);
    if (!auth) return;
    const company = req.query?.company_id;
    if (!await companyAccess(auth,company,res)) return;
    let bounds;
    try { bounds = dayBounds(req.query?.day || ''); } catch(error) { res.status(400).json({error:error.message}); return; }
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key) { res.status(503).json({error:'Follow-up review is not configured.'}); return; }
    try {
      const headers = {apikey:key, Authorization:`Bearer ${key}`};
      const all = async (table, filter, order) => {
        const rows=[];
        for (let offset=0;;) {
          const response = await request(`${auth.url}/rest/v1/${table}?company_id=eq.${encodeURIComponent(company)}&select=*&order=${order}&${filter}&offset=${offset}&limit=500`, {headers,signal:AbortSignal.timeout(10000)});
          if (!response.ok) throw new Error('Follow-up review unavailable. Check database setup.');
          const page=await response.json();
          if (!Array.isArray(page)) throw new Error('Invalid review response.');
          rows.push(...page); if (!page.length) return rows;
          offset += page.length;
        }
      };
      const [events,states]=await Promise.all([
        all('followup_review_events',`created_at=gte.${bounds[0]}&created_at=lt.${bounds[1]}`,'id.asc'),
        all('followup_review_state','','follow_up_id.asc')
      ]);
      res.status(200).json(summarizeReview(events,states));
    } catch { res.status(503).json({error:'Unable to load follow-up review. Check setup and retry.'}); }
  };
}
