// Pure, side-effect-free formatter for owner-only, customer-by-customer staff reports.
// Inputs must already be fetched with verified owner authorization and scoped to one staff account.
const STAFF_EMAIL = 'brutf5354@gmail.com';
const IST = 'Asia/Kolkata';
const fmtTime = (s) => s ? new Intl.DateTimeFormat('en-IN',{timeZone:IST,hour:'2-digit',minute:'2-digit',hour12:true}).format(new Date(s)) : 'Not recorded';
const safe = (s) => String(s ?? '').replace(/[\r\n]+/g,' ').trim() || 'Not recorded';
const isDay = (timestamp,date) => timestamp && new Intl.DateTimeFormat('en-CA',{timeZone:IST,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(timestamp)) === date;
const email = (s) => String(s || '').toLowerCase().trim();
const table = (headers,rows) => [headers.join(' | '),headers.map(()=> '---').join(' | '),...rows.map(row=>row.map(safe).join(' | '))].join('\n');
export function buildDetailedStaffReport({date,staffEmail=STAFF_EMAIL,telecalling=[],leads=[],activities=[],followups=[],documents=[],queryErrors=[]}) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Expected YYYY-MM-DD date');
  if(email(staffEmail)!==STAFF_EMAIL) throw new Error('Report is restricted to the configured staff account');
  const tc = telecalling.filter(x=>email(x.created_by_email)===STAFF_EMAIL && (isDay(x.created_at,date)||isDay(x.updated_at,date)));
  const newTc=tc.filter(x=>isDay(x.created_at,date));
  const updatedTc=tc.filter(x=>isDay(x.updated_at,date)&&!isDay(x.created_at,date));
  const scopedLeads=leads.filter(x=>email(x.assigned_telecaller_email)===STAFF_EMAIL && (isDay(x.created_at,date)||isDay(x.updated_at,date)));
  const newLeads=scopedLeads.filter(x=>isDay(x.created_at,date));
  const updatedLeads=scopedLeads.filter(x=>isDay(x.updated_at,date)&&!isDay(x.created_at,date));
  // Activity actor attribution is explicit. Assigned lead or record ownership is NOT actor evidence.
  const actions=activities.filter(x=>email(x.performed_by)===STAFF_EMAIL && isDay(x.created_at,date));
  const followCreated=followups.filter(x=>email(x.created_by_email)===STAFF_EMAIL&&isDay(x.created_at,date));
  const docCreated=documents.filter(x=>email(x.created_by_email)===STAFF_EMAIL&&isDay(x.created_at,date));
  const docSent=documents.filter(x=>email(x.whatsapp_sent_by_email)===STAFF_EMAIL&&isDay(x.whatsapp_sent_at,date));
  const deleted=actions.filter(x=>/follow.up deleted/i.test(x.type||x.activity_type||''));
  const countRows=[['New leads',newLeads.length],['Existing leads updated',updatedLeads.length],['New telecalling records',newTc.length],['Existing telecalling records updated',updatedTc.length],['Follow-ups created (retained rows)',followCreated.length],['Follow-up deletions (logged events)',deleted.length],['Documents created',docCreated.length],['Document WhatsApp sends',docSent.length]];
  const sections=[
    '# B2P detailed staff activity report',
    '**Date:** '+date+' (IST)  **Staff:** '+STAFF_EMAIL,
    '## Verified database totals',table(['Activity','Count'],countRows),
    '**Interpretation:** Counts are records or events, not confirmed phone calls. Assigned records may have been edited by another user or an automated process.',
    '## Telecalling daily-report changes',
    tc.length?table(['Customer / contact','Record type','Current status','Current feedback','Updated (IST)'],tc.map(x=>[safe(x.company_name)+' — '+safe(x.contact_person),isDay(x.created_at,date)?'Created':'Existing record updated',x.call_status,x.feedback,fmtTime(x.updated_at||x.created_at)])):'No matching telecalling records.',
    '## Lead records created or updated',
    scopedLeads.length?table(['Lead','Customer / contact','Record type','Current status','Current notes / remarks','Updated (IST)'],scopedLeads.map(x=>[x.lead_number,safe(x.company_name)+' — '+safe(x.customer_name),isDay(x.created_at,date)?'Created':'Existing record updated',x.status,x.notes||x.remarks,fmtTime(x.updated_at||x.created_at)])):'No matching lead records.',
    '## Explicitly attributed staff activity',
    actions.length?table(['Customer / lead','Action','Notes','Time (IST)'],actions.map(x=>[x.company_name||x.lead_number||x.lead_id,x.type||x.activity_type,x.notes,fmtTime(x.created_at)])):'No explicitly attributed activity events found.',
    '## Retained follow-ups created',
    followCreated.length?table(['Customer / lead','Due','Status','Notes'],followCreated.map(x=>[x.company_name||x.lead_number,x.follow_up_date,x.status,x.notes])):'None found.',
    '## Documents',
    docCreated.length||docSent.length?table(['Document','Customer','Action','Time (IST)'],[...docCreated.map(x=>[x.document_number,x.customer_name,'Created',fmtTime(x.created_at)]),...docSent.map(x=>[x.document_number,x.customer_name,'WhatsApp send recorded',fmtTime(x.whatsapp_sent_at)])]):'No matching created or sent documents.',
    '## Owner attention',
    deleted.length?'Follow-up deletions: '+deleted.map(x=>safe(x.company_name||x.lead_number||x.lead_id)).join(', ')+'. Check whether replacements were created; deleted records may not be retained.':'No explicitly attributed follow-up deletions found.',
    '## Verification limits',
    'A modification timestamp does not identify the editor or show previous field values. Current feedback is not independent proof that a call, meeting, email or message occurred.',
    queryErrors.length?'**Incomplete source checks:** '+queryErrors.map(safe).join('; '):'All supplied datasets processed; completeness depends on successful upstream database queries.'
  ];
  return {staffEmail:STAFF_EMAIL,date,counts:Object.fromEntries(countRows),markdown:sections.join('\n\n')};
}
