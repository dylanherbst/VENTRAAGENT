import test from 'node:test';
import assert from 'node:assert/strict';
import { loadAccountCourses, saveAccountCourse, type CourseRequest } from '../lib/course-account.ts';
const workspace = '11111111-1111-1111-1111-111111111111';
const id = '22222222-2222-2222-2222-222222222222';
const course = {title:'Practical course',summary:'Learn',lessons:[{id:'lesson-1',title:'Practice',content:'Do this',durationMinutes:'15'}]};
const reply = (body: unknown, status = 200): CourseRequest => async () => Response.json(body,{status});
test('account list validates every row, revision and course before returning editor data', async () => {
 assert.deepEqual(await loadAccountCourses(workspace,reply({courses:[{id,data:course,revision:2}]})),[{id,course,revision:2}]);
 for (const row of [{id,data:course,revision:0},{id,data:{...course,lessons:[]},revision:1},{id:'bad',data:course,revision:1}]) {
  await assert.rejects(loadAccountCourses(workspace,reply({courses:[row]})));
 }
 await assert.rejects(loadAccountCourses(workspace,reply({courses:[{id,data:course,revision:1},{id,data:course,revision:1}]})),/Duplicate/);
 await assert.rejects(loadAccountCourses(workspace,reply({error:'Sign in again.'},401)),/Sign in again/);
});
test('account saves send explicit revisions and cookie credentials, and verify the acknowledged revision', async () => {
 const item = {id,course,revision:2};
 const saved = await saveAccountCourse(workspace,item,async (url,init) => {
  assert.equal(url,'/api/workspace/courses');
  assert.equal(init?.credentials,'same-origin'); assert.equal(init?.cache,'no-store');
  assert.deepEqual(JSON.parse(init?.body as string),{workspace,id,revision:2,course});
  return Response.json({saved:true,revision:3});
 });
 assert.equal(saved.revision,3); assert.equal(item.revision,2);
 await assert.rejects(saveAccountCourse(workspace,item,reply({error:'Revision conflict'},409)),/Revision conflict/);
 await assert.rejects(saveAccountCourse(workspace,item,reply({saved:true,revision:2})),/could not be verified/);
 let called = false;
 await assert.rejects(saveAccountCourse(workspace,{...item,course:{...course,lessons:[]}},async () => {called=true;return Response.json({});}));
 assert.equal(called,false);
});
