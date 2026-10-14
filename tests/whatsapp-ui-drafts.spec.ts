import {test,expect,type Page} from '@playwright/test';
const company='a0000000-0000-4000-a000-000000000001';
const foreign='b0000000-0000-4000-b000-000000000002';
const conversation='c1000000-0000-4000-a000-000000000001';
const input=(page:Page)=>page.getByRole('textbox',{name:'Message',exact:true});
async function open(page:Page){
 await page.routeWebSocket('**/*',socket=>socket.close());
 await page.route('**/*',route=>{
  const url=new URL(route.request().url());
  if(!['127.0.0.1','localhost'].includes(url.hostname))return route.abort();
  if(url.pathname.endsWith('/services/apiAuth.ts'))return route.fulfill({contentType:'application/javascript',body:'export async function authenticatedHeaders(){return {"Content-Type":"application/json",Authorization:"Bearer synthetic-only"};}'});
  if(url.pathname.includes('whatsapp-media'))throw new Error('UI-only release must never request media capabilities');
  return route.fallback();
 });
 await page.addInitScript(({company,foreign,conversation})=>{
  if(sessionStorage.getItem('__ui_seeded'))return;sessionStorage.setItem('__ui_seeded','1');
  const row=(id:string,company_id:string,name:string)=>({id,company_id,customer_name:name,phone:'0000000000',last_message:'Synthetic history',last_message_at:'2026-10-14T00:00:00Z',status:'open',unread_count:0,created_at:'2026-10-14T00:00:00Z',updated_at:'2026-10-14T00:00:00Z'});
  localStorage.setItem('docgen_whatsapp_conversations',JSON.stringify([row(conversation,company,'Draft fixture 1'),row('c1000000-0000-4000-a000-000000000002',company,'Draft fixture 2'),row('c1000000-0000-4000-b000-000000000003',foreign,'Foreign draft fixture')]));
 },{company,foreign,conversation});
 await page.goto('/billing/verification/whatsapp-draft-fixture.html');await expect(input(page)).toBeVisible();
}
test('exact text survives reload and conversation switching without sending',async({page})=>{
 let sends=0;await page.route('**/api/whatsapp?*',r=>{sends++;return r.abort();});await open(page);
 await input(page).fill('  Synthetic draft\nsecond line  ');await page.reload();await expect(input(page)).toHaveValue('  Synthetic draft\nsecond line  ');
 await page.getByRole('button',{name:'Open conversation with Draft fixture 2',exact:true}).click();await expect(input(page)).toHaveValue('');
 await page.getByRole('button',{name:'Open conversation with Draft fixture 1',exact:true}).click();await expect(input(page)).toHaveValue('  Synthetic draft\nsecond line  ');expect(sends).toBe(0);
});
test('drafts and visible conversations stay scoped to company and user',async({page})=>{
 await open(page);await input(page).fill('Original user draft');await page.getByRole('button',{name:'Switch synthetic user'}).click();await expect(input(page)).toHaveValue('');await input(page).fill('Second user draft');
 await page.getByRole('button',{name:'Switch synthetic user'}).click();await expect(input(page)).toHaveValue('Original user draft');
 await page.getByRole('button',{name:'Switch synthetic company'}).click();await expect(input(page)).toHaveValue('');await expect(page.getByRole('button',{name:'Open conversation with Draft fixture 1',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Switch synthetic company'}).click();await expect(input(page)).toHaveValue('Original user draft');
});
test('existing API payload and acceptance work without a persisted response or new fields',async({page})=>{
 let sends=0;await open(page);await page.route('**/api/whatsapp?*',async route=>{
  sends++;expect(new URL(route.request().url()).pathname).toBe('/api/whatsapp');const body=route.request().postDataJSON();
  expect(Object.keys(body).sort()).toEqual(['company_id','conversation_id','phone','sender_email','sender_name','text','type'].sort());
  expect(body.company_id).toBe(company);expect(body.conversation_id).toBe(conversation);expect(body.type).toBe('text');
  await new Promise(r=>setTimeout(r,400));await route.fulfill({contentType:'application/json',body:JSON.stringify({success:true,messageId:'wamid.synthetic-ui'})});
 });
 await input(page).fill('Synthetic acceptance');await input(page).press('Enter');await input(page).press('Enter');
 await expect(input(page)).toHaveValue('');expect(sends).toBe(1);await page.reload();await expect(input(page)).toHaveValue('');
 await expect(page.getByTestId('whatsapp-message-feed')).toContainText('Synthetic acceptance');
});
for(const mode of ['rejected','network-loss'])test(mode+' keeps draft after reload without automatic retry',async({page})=>{
 let sends=0;await open(page);await page.route('**/api/whatsapp?*',route=>{sends++;return mode==='rejected'?route.fulfill({status:400,contentType:'application/json',body:'{"error":"Synthetic rejection"}'}):route.abort('timedout');});
 await input(page).fill('Preserved draft');await input(page).press('Enter');await expect(page.getByText(/Check delivery before manually retrying/)).toBeVisible();await expect(input(page)).toHaveValue('Preserved draft');
 await page.reload();await expect(input(page)).toHaveValue('Preserved draft');expect(sends).toBe(1);
});
test('storage errors retain in-memory text and explicit discard clears saved text',async({page})=>{
 await open(page);await input(page).fill('Saved draft');await page.getByRole('button',{name:'Discard draft'}).click();await page.reload();await expect(input(page)).toHaveValue('');
 await page.evaluate(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith('docgen_whatsapp_ui_draft_v1:'))throw new Error('Synthetic storage failure');return original.call(this,k,v);};});
 await input(page).fill('Memory only draft');await expect(page.getByText(/Draft storage is unavailable/)).toBeVisible();
 await page.getByRole('button',{name:'Open conversation with Draft fixture 2',exact:true}).click();await page.getByRole('button',{name:'Open conversation with Draft fixture 1',exact:true}).click();await expect(input(page)).toHaveValue('Memory only draft');
});
