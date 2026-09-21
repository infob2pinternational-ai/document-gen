import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const url=s=>`data:text/javascript;base64,${Buffer.from(s).toString('base64')}`;

test('permission refresh preserves an open form on network failure but blocks revoked or different users',async()=>{
  const reactUrl=url(`export let effect; let state;
    export function useEffect(fn){effect=fn;}
    export function useState(initial){if(state===undefined)state=initial;return [state,next=>{state=typeof next==='function'?next(state):next;}];}`);
  const dbUrl=url(`export let result={data:'owner'}; export function respond(value){result=value;}
    export const supabase={async rpc(){return result;}};`);
  let {outputText}=ts.transpileModule(readFileSync(new URL('../src/hooks/useAppRole.ts',import.meta.url),'utf8'),{
    compilerOptions:{target:ts.ScriptTarget.ES2023,module:ts.ModuleKind.ESNext}
  });
  outputText=outputText.replace("'react'",JSON.stringify(reactUrl)).replace("'../services/supabaseClient'",JSON.stringify(dbUrl));
  const {useAppRole}=await import(url(outputText));
  const react=await import(reactUrl);const db=await import(dbUrl);
  const oldWindow=globalThis.window;let focus;
  globalThis.window={addEventListener(_name,fn){focus=fn;},removeEventListener(){focus=null;}};
  let cleanup;
  try{
    assert.equal(useAppRole('owner').verified,false);
    cleanup=react.effect();
    await new Promise(resolve=>setTimeout(resolve,0));
    assert.equal(useAppRole('owner').verified,true);
    db.respond({error:{message:'Network unavailable'}});
    await focus();
    assert.equal(useAppRole('owner').verified,true);
    assert.match(useAppRole('owner').error,/Could not refresh/);
    assert.equal(useAppRole('different-user').verified,false);
    db.respond({data:null});
    await focus();
    assert.equal(useAppRole('owner').verified,false);
    assert.match(useAppRole('owner').error,/no active office access/);
  }finally{cleanup?.();if(oldWindow===undefined)delete globalThis.window;else globalThis.window=oldWindow;}
});
