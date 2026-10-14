// Test-only actual composer with synthetic identity props; no Auth bypass in App.
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {WhatsAppInbox} from '../src/components/WhatsAppInbox';
import '../src/index.css';
if(!import.meta.env.DEV || location.hostname!=='127.0.0.1')throw new Error('Local fixture only');
const companyA='a0000000-0000-4000-a000-000000000001';
const companyB='b0000000-0000-4000-b000-000000000002';
const userA='e1000000-0000-4000-a000-000000000001';
const userB='e1000000-0000-4000-a000-000000000002';
export function Fixture(){
 const [company,setCompany]=useState(sessionStorage.getItem('__draft_fixture_company')||companyA);
 const [user,setUser]=useState(sessionStorage.getItem('__draft_fixture_user')||userA);
 return <><div>
  <button onClick={()=>{const next=company===companyA?companyB:companyA;sessionStorage.setItem('__draft_fixture_company',next);setCompany(next);}}>Switch synthetic company</button>
  <button onClick={()=>{const next=user===userA?userB:userA;sessionStorage.setItem('__draft_fixture_user',next);setUser(next);}}>Switch synthetic user</button>
 </div><WhatsAppInbox userId={user} userEmail="synthetic@example.invalid" companyId={company}/></>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
