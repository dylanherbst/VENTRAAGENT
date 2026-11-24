import test from 'node:test';
import assert from 'node:assert/strict';
import {assertProfileRevision} from '../lib/profile-revision.ts';
import {blankProfile} from '../lib/onboarding.ts';
const p={...blankProfile(),name:'QA',audience:'Owners',goal:'Safety',expertise:'Testing'};
test('save-time profile revision validates exact bytes and profile before resource writes',()=>{const raw=JSON.stringify(p);assert.deepEqual(assertProfileRevision({getItem:()=>raw},raw,p.id),p);for(const current of [null,'{','{}',raw+' ',JSON.stringify({...p,completed:['new']})])assert.throws(()=>assertProfileRevision({getItem:()=>current},raw,p.id),/unsaved edits remain/);assert.throws(()=>assertProfileRevision({getItem:()=>{throw Error('unreadable');}},raw,p.id));});
