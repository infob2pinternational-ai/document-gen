import test from 'node:test';
import assert from 'node:assert/strict';
import {providerOutcome} from '../server/whatsappOutcome.js';

test('only an existing provider ID confirms acceptance',()=>{
  for(const body of [{messageId:'provider-synthetic'},{messages:[{id:'provider-synthetic'}]}])
    assert.deepEqual(providerOutcome({ok:true,status:200},body),{success:true,outcome:'accepted',messageId:'provider-synthetic'});
});
test('missing, malformed or blank IDs never fabricate acceptance',()=>{
  for(const body of [{},null,{success:true},{messageId:''},{messageId:123},{messageId:' '},{id:'generic-record'},{data:{id:'generic-record'}}])
    assert.deepEqual(providerOutcome({ok:true,status:200},body),{success:false,outcome:'uncertain'});
});
test('rejections and uncertain provider failures remain distinct',()=>{
  assert.equal(providerOutcome({ok:false,status:400},{}).outcome,'rejected');
  for(const status of [408,429,500,502,504])assert.equal(providerOutcome({ok:false,status},{}).outcome,'uncertain');
  assert.equal(providerOutcome({ok:true,status:200},{success:false,messageId:'not-accepted'}).success,false);
});
