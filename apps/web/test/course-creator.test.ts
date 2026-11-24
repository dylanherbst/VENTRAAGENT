import test from 'node:test';
import assert from 'node:assert/strict';
import { generateCourse, importCourse } from '../lib/course-creator.ts';
import { courseDraftFromInput, persistEducationCourseDraft, restoreEducationCourseDraft } from '../lib/local-education-course.ts';
const input = {title:'Practical course',summary:'A real learning outcome',lessons:[{id:'lesson-1',title:'Practice',content:'Complete the exercise',durationMinutes:'15'}]};
test('AI is never fabricated; adapter output is validated',async()=>{
 await assert.rejects(generateCourse('Teach a skill'),/not configured/);
 await assert.rejects(generateCourse(''),/1–4000/);
 assert.deepEqual(await generateCourse('Teach a skill',{generate:async()=>input}),input);
 await assert.rejects(generateCourse('Teach',{generate:async()=>({...input,lessons:[]})}),/at least one/);
});
test('save/reload/import roundtrip, concurrency and storage failure preserve data',()=>{
 const data=new Map<string,string>();
 const storage={getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value);}};
 const draft=courseDraftFromInput(input,{id:'course-1',profileId:'course-creator-sandbox'});
 const raw=persistEducationCourseDraft(storage,draft.profileId,null,draft);
 assert.deepEqual(restoreEducationCourseDraft(raw,draft.profileId),draft);
 assert.deepEqual(importCourse(raw,draft.profileId),input);
 assert.throws(()=>importCourse(raw,'other-profile'),/mismatched/);
 assert.throws(()=>persistEducationCourseDraft(storage,draft.profileId,null,draft),/another tab/);
 assert.throws(()=>persistEducationCourseDraft({...storage,setItem:()=>{throw Error('Quota exceeded');}},draft.profileId,raw,draft),/Quota/);
 assert.deepEqual([...data.values()],[raw]);
});
