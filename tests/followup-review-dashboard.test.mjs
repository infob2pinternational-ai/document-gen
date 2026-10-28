import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { summarizeReview } from '../server/followupReview.js';
const source=ts.transpileModule(readFileSync(new URL('../src/utils/followupReviewDashboard.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2023,module:ts.ModuleKind.ESNext}}).outputText;
const {matchesDaily,matchesAttention,scopeReview,sortReviewTasks,reviewPage}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const tasks=[
 {follow_up_id:'a',customer_name:'Alpha',assigned_staff_email:'staff@example.test',current_status:'PENDING',current_due:'2026-10-27T11:00:00',postponement_count:3,consecutive_without_contact:2},
 {follow_up_id:'b',customer_name:'Beta',assigned_staff_email:'other@example.test',current_status:'COMPLETED',current_due:'2026-10-20T11:00:00',postponement_count:5,consecutive_without_contact:3},
 {follow_up_id:'c',customer_name:'Gamma',assigned_staff_email:'staff@example.test',current_status:'PENDING',current_due:'2026-10-28T11:00:00',postponement_count:0,consecutive_without_contact:0}
];
const events=[
 {id:1,follow_up_id:'a',actor_email:'staff@example.test',event_type:'postponed',outcome:'no_answer',reason:'No response',created_at:'2026-10-28T04:00:00Z'},
 {id:2,follow_up_id:'a',actor_email:'staff@example.test',event_type:'rescheduled',outcome:'customer_callback',created_at:'2026-10-28T05:00:00Z'},
 {id:3,follow_up_id:'b',actor_email:'other@example.test',event_type:'completed',outcome:'completed',created_at:'2026-10-28T06:00:00Z'}
];
test('daily drilldown and summary counts agree; reschedules and postponements stay distinct',()=>{
 const report=summarizeReview(events,tasks);
 assert.equal(report.actions.length,3);
 for(const key of ['completed','postponed','customer_callback','no_answer','not_contacted']) assert.equal(report.actions.filter(a=>matchesDaily(a,key)).length,report.totals.reduce((sum,row)=>sum+row[key],0));
 assert.equal(report.actions.filter(a=>matchesDaily(a,'rescheduled')).length,1);
 assert.equal(report.actions[0].customer_name,'Alpha');
 assert.equal(report.actions[0].reason,'No response');
});
test('attention filters exclude closed tasks and use India calendar day boundary',()=>{
 for(const filter of ['overdue','repeated','no_contact']) assert.deepEqual(tasks.filter(t=>matchesAttention(t,filter,'2026-10-28')).map(t=>t.follow_up_id),['a']);
 assert.equal(tasks.filter(t=>matchesAttention(t,'all','2026-10-28')).length,3);
});
test('staff and customer filters combine; actions use actor and tasks use assignee',()=>{
 assert.equal(scopeReview(tasks,' STAFF@example.test ','alp').length,1);
 assert.equal(scopeReview(tasks,'staff@example.test','beta').length,0);
 const reassigned={...tasks[0],assigned_staff_email:'other@example.test'};
 assert.equal(scopeReview([reassigned],'staff@example.test','').length,0);
 assert.equal(scopeReview(summarizeReview(events,tasks).actions,'staff@example.test','').length,2);
});
test('sort is deterministic and pages clamp after filtering without mutating source',()=>{
 assert.deepEqual(sortReviewTasks(tasks,'postponements').map(t=>t.follow_up_id),['b','a','c']);
 assert.deepEqual(tasks.map(t=>t.follow_up_id),['a','b','c']);
 assert.equal(reviewPage(tasks,9).page,1);
 assert.deepEqual(reviewPage([],2).rows,[]);
 assert.equal(reviewPage(Array.from({length:21},(_,i)=>i),3).rows[0],20);
});
test('dashboard renders separate daily/current sections and accessible KPI controls',async()=>{
 const {createRequire}=await import('node:module');
 const {pathToFileURL}=await import('node:url');
 const require=createRequire(import.meta.url);
 const asUrl=value=>`data:text/javascript;base64,${Buffer.from(value).toString('base64')}`;
 let component=ts.transpileModule(readFileSync(new URL('../src/components/FollowUpOwnerReview.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2023,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 component=component.replace(/import '\.\/FollowUpReview.css';/,'')
 .replaceAll('"react/jsx-runtime"',JSON.stringify(pathToFileURL(require.resolve('react/jsx-runtime')).href))
 .replaceAll("'react'",JSON.stringify(pathToFileURL(require.resolve('react')).href))
 .replaceAll("'../services/apiAuth'",JSON.stringify(asUrl('export const authenticatedHeaders=async()=>({});')))
 .replaceAll("'../utils/dateUtils'",JSON.stringify(asUrl("export const getKolkataToday=()=> '2026-10-28';")))
 .replaceAll("'../utils/followupReviewDashboard'",JSON.stringify(asUrl(source)));
 const {ReviewDashboard}=await import(asUrl(component));
 const React=await import('react');const {renderToStaticMarkup}=await import('react-dom/server');
 const html=renderToStaticMarkup(React.createElement(ReviewDashboard,{data:summarizeReview(events,tasks)}));
 assert.match(html,/Selected-day activity/);assert.match(html,/Current follow-up status/);
 assert.match(html,/aria-controls="review-actions"/);assert.match(html,/aria-controls="review-tasks"/);
 assert.match(html,/Customer search/);assert.match(html,/Task status/);assert.match(html,/Baseline/);
});
