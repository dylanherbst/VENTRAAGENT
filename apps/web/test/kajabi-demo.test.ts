import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { fixtures, saveDraft, staff, reorder, publishCourse, publishOffer, publicOffer, publishStorefront, storefront, canRead, readLesson, setCompletion, progressCount, parsePriceMinor, emptyWorkspaceFixture, creatorSummary } from '../lib/kajabi-demo.ts';
import type { Progress } from '../lib/kajabi-demo.ts';

test('UX1 empty fixture and derived empty states never create records or alter working fixture', () => {
 const empty = emptyWorkspaceFixture(); const working = fixtures(); const before = JSON.stringify({empty, working});
 assert.deepEqual(empty, {tenantId:'empty-studio',courses:[],versions:[],offers:[],listed:[],grants:[]});
 for (let i=0;i<4;i++) assert.deepEqual(creatorSummary(empty.courses[0] ?? null,null,empty.versions,empty.offers,empty.listed), {draft:'No course draft',saved:'No saved draft',course:'No published course version',offer:'No published offer',storefront:'0 published storefront listing(s)'});
 assert.equal(JSON.stringify({empty, working}),before);
 assert.equal(working.draft.modules.length,2);assert.equal(working.versions[0].modules.flatMap(m=>m.lessons).length,3);assert.equal(working.offer.published,false);assert.equal(working.grants.length,2);
 const second=emptyWorkspaceFixture();second.courses.push(structuredClone(working.draft));assert.equal(empty.courses.length,0);
});
test('ST1 summary derives independent unsaved/saved/course/offer/listing states without writes', () => {
 const f=fixtures(),saved=saveDraft(f.actors[0],f.draft),draft=structuredClone(saved);
 const start=creatorSummary(draft,saved,f.versions,[],[]);assert.match(start.draft,/No unsaved/);assert.match(start.saved,/in memory only/);assert.match(start.course,/v1/);assert.equal(start.offer,'No published offer');
 draft.title='New unsaved title';draft.modules[0].lessons[0].included=false;
 const changed=creatorSummary(draft,saved,f.versions,[f.offer],[]);assert.equal(changed.draft,'Unsaved curriculum changes');assert.equal(changed.saved,start.saved);assert.equal(changed.course,start.course);assert.equal(changed.offer,start.offer);
 const nextSaved=saveDraft(f.actors[0],draft);const v2=publishCourse(f.actors[0],nextSaved,2,true);const versions=[...f.versions,v2];
 const courseOnly=creatorSummary(draft,nextSaved,versions,[],[]);assert.match(courseOnly.draft,/No unsaved/);assert.match(courseOnly.course,/v2/);assert.equal(courseOnly.offer,'No published offer');assert.equal(courseOnly.storefront,'0 published storefront listing(s)');assert.equal(f.grants.length,2);
 const offer=publishOffer(f.actors[0],f.offer,versions);const offerOnly=creatorSummary(draft,nextSaved,versions,[offer],[]);assert.match(offerOnly.offer,/references small-experiments-v1/);assert.equal(offerOnly.storefront,'0 published storefront listing(s)');
 const listed=publishStorefront(f.actors[0],'fieldwork',[offer.id],[offer],versions);assert.equal(creatorSummary(draft,nextSaved,versions,[offer],listed).storefront,'1 published storefront listing(s)');
 const unlisted=publishStorefront(f.actors[0],'fieldwork',[],[offer],versions);assert.equal(creatorSummary(draft,nextSaved,versions,[offer],unlisted).storefront,'0 published storefront listing(s)');assert.ok(canRead(f.actors[2],f.versions[0],f.grants));assert.equal(f.versions[0].title,saved.title);
 const before=JSON.stringify({draft,nextSaved,versions,offer,listed,grants:f.grants});creatorSummary(draft,nextSaved,versions,[offer],listed);assert.equal(JSON.stringify({draft,nextSaved,versions,offer,listed,grants:f.grants}),before);
});
test('UX1/AU1 source wiring keeps fixture navigation and collapse presentation-only (not rendered QA)', () => {
 const source=readFileSync(new URL('../app/tools/page.tsx',import.meta.url),'utf8');
 const toggle=source.slice(source.indexOf('function toggleModule'),source.indexOf("const [draft, setDraft]"));
 assert.match(toggle,/setCollapsedModules/);assert.doesNotMatch(toggle,/setDraft|setSaved|publishCourse|publishOffer|setVersions|setProgress/);
 assert.ok(source.includes('aria-expanded={!collapsedModules[m.id]}'));assert.ok(source.includes('hidden={!!collapsedModules[m.id]}'));assert.ok(source.includes("aria-controls={'module-editor-' + m.id}"));
 assert.ok(source.includes('onFocusCapture={() => setSelectedDraftLesson(l.id)}'));assert.match(source,/Selected draft lesson:/);assert.match(source,/Move module /);assert.match(source,/Move lesson /);
 const emptyView=source.slice(source.indexOf('function EmptyWorkspace'),source.indexOf('function WorkingDemo'));
 assert.ok(emptyView.includes('onClick={() => setArea(key)}'));for(const mutation of ['saveDraft(', 'publishCourse(', 'publishOffer(', 'publishStorefront(', '.push(']) assert.ok(!emptyView.includes(mutation));
 assert.ok(source.includes("<div hidden={view !== 'working'}><WorkingDemo />"));assert.ok(source.includes('amountMinor: parsePriceMinor(priceInput)'));assert.ok(!source.includes('Number(e.target.value)'));
});
test('A1 explicit saves, empty draft, deterministic keyboard reorder and identity isolation', () => {
 const f = fixtures(); const d = saveDraft(f.actors[0], f.draft); d.title = 'Changed'; assert.notEqual(f.draft.title, d.title);
 assert.deepEqual(reorder(['a','b','c'], 0, 1), ['b','a','c']); assert.deepEqual(reorder(['a'], 0, -1), ['a']); assert.deepEqual(reorder(['a'], -1, 1), ['a']); assert.deepEqual(reorder(['a'], 2, -1), ['a']);
 assert.equal(saveDraft(f.actors[1], {...f.draft, modules: []}).modules.length, 0);
 for (const actor of f.actors.slice(2)) assert.throws(() => saveDraft(actor, f.draft), /denied/);
 for (const change of [(d: typeof f.draft) => {d.title=' ';}, (d: typeof f.draft) => {d.modules[0].title='';}, (d: typeof f.draft) => {d.modules[0].lessons[0].title=' ';}, (d: typeof f.draft) => {d.modules[0].lessons[0].id=d.modules[0].id;}]) {const d=structuredClone(f.draft);change(d);assert.throws(()=>saveDraft(f.actors[0],d));}
});
test('A2 publish guards, selected content, immutable recursive snapshot and republish', () => {
 const f=fixtures(); const a=f.actors[0];
 assert.throws(()=>publishCourse(a,f.draft,2,false)); assert.throws(()=>publishCourse(a,{...f.draft,archived:true},2,true));
 for (const n of [0,1.2,-1]) assert.throws(()=>publishCourse(a,f.draft,n,true));
 assert.throws(()=>publishCourse(a,{...f.draft,modules:[]},2,true));
 const d=structuredClone(f.draft);d.modules[0].lessons[0].body=' ';assert.throws(()=>publishCourse(a,d,2,true)); d.modules[0].lessons[0].included=false;
 const v=publishCourse(a,d,2,true);assert.equal(v.modules[0].lessons.length,1);
 d.modules[0].lessons[1].body='changed';d.modules[0].title='changed'; assert.notEqual(v.modules[0].title,'changed');assert.notEqual(v.modules[0].lessons[0].body,'changed');
 assert.ok(Object.isFrozen(v));assert.ok(Object.isFrozen(v.modules));assert.ok(Object.isFrozen(v.modules[0]));assert.ok(Object.isFrozen(v.modules[0].lessons));assert.ok(Object.isFrozen(v.modules[0].lessons[0]));
 assert.throws(()=> { (v.modules[0].lessons[0] as {body:string}).body='mutate'; });
 assert.equal(publishCourse(a,d,3,true).modules[0].title,'changed');
 for (const actor of f.actors.slice(1)) assert.throws(()=>publishCourse(actor,f.draft,2,true));
});
test('A3 independent publish/list, invalid offers, safe metadata projection and unchanged public curriculum', () => {
 const f=fixtures();const a=f.actors[0]; assert.equal(publicOffer(f.offer,f.versions,'fieldwork'),null);assert.deepEqual(storefront('fieldwork',[f.offer.id],[f.offer],f.versions),[]);
 const o=publishOffer(a,f.offer,f.versions);assert.ok(Object.isFrozen(o));assert.deepEqual(storefront('fieldwork',[],[o],f.versions),[]);assert.ok(publicOffer(o,f.versions,'fieldwork'));
 const listed=publishStorefront(a,'fieldwork',[o.id,o.id],[o],f.versions);assert.equal(listed.length,1);assert.equal(storefront('fieldwork',listed,[o],f.versions).length,1);
 const before=JSON.stringify(publicOffer(o,f.versions,'fieldwork'));f.draft.modules[0].lessons[0].title='new draft title';assert.equal(JSON.stringify(publicOffer(o,f.versions,'fieldwork')),before);
 const safe=publicOffer(o,f.versions,'fieldwork')!;assert.deepEqual(Object.keys(safe).sort(),['id','title','summary','slug','amountMinor','currency','terms','seller','curriculum'].sort());assert.ok(!JSON.stringify(safe).includes('body'));for(const m of f.versions[0].modules) for(const l of m.lessons) assert.ok(!JSON.stringify(safe).includes(l.body));
 assert.equal(publicOffer(o,f.versions,'other-studio'),null);assert.equal(publicOffer(o,[],'fieldwork'),null);assert.throws(()=>publishStorefront(a,'fieldwork',['missing'],[o],f.versions));assert.throws(()=>publishStorefront(a,'fieldwork',[f.offer.id],[f.offer],f.versions));
 for(const patch of [{title:' '},{summary:''},{slug:'bad slug'},{terms:''},{currency:'USD'},{amountMinor:-1},{amountMinor:1.1},{amountMinor:NaN},{amountMinor:Infinity},{amountMinor:Number.MAX_SAFE_INTEGER+1},{courseVersionId:'unknown'},{tenantId:'other-studio'}]) assert.throws(()=>publishOffer(a,{...f.offer,...patch},f.versions));
 assert.equal(publishOffer(a,{...f.offer,amountMinor:0},f.versions).amountMinor,0);
 for(const actor of f.actors.slice(1)){assert.throws(()=>publishOffer(actor,f.offer,f.versions));assert.throws(()=>publishStorefront(actor,'fieldwork',[],[],f.versions));}
});
test('F1 raw price parser used by publication rejects blank/invalid input without silent free offers', () => {
 const f = fixtures();
 // Match the actual Publish offer handler: parse the raw field before publishOffer.
 const publishRaw = (raw: string) => publishOffer(f.actors[0], { ...f.offer, amountMinor: parsePriceMinor(raw) }, f.versions);
 for (const raw of ['', ' ', '\t\n', '-1', '-0', '1.5', '1.0', '1e3', '0x10', 'NaN', 'Infinity', 'abc', '+1', '1 000', '9007199254740992', '999999999999999999999999999999999999']) {
   assert.throws(() => parsePriceMinor(raw), /price|Price/);
   assert.throws(() => publishRaw(raw), /price|Price/);
 }
 assert.equal(publishRaw('0').amountMinor, 0);
 assert.equal(publishRaw('2900').amountMinor, 2900);
 assert.equal(publishRaw(' 42 ').amountMinor, 42);
 assert.equal(publishRaw('9007199254740991').amountMinor, Number.MAX_SAFE_INTEGER);
 // Clearing a previously valid raw field stays invalid rather than inheriting its value.
 let raw = '2900'; assert.equal(publishRaw(raw).amountMinor, 2900);
 raw = ''; assert.throws(() => publishRaw(raw));
 raw = '0'; assert.equal(publishRaw(raw).amountMinor, 0);
 assert.equal(f.offer.amountMinor, 2900);
});
test('A4 every actor/resource/tenant/grant boundary denies by default', () => {
 const f=fixtures(),v=f.versions[0],learner=f.actors[2];assert.ok(canRead(learner,v,f.grants));assert.equal(readLesson(learner,v,'question',f.grants).id,'question');
 for(const actor of f.actors.filter(a=>a.id!==learner.id)){assert.equal(canRead(actor,v,f.grants),false);assert.throws(()=>readLesson(actor,v,'question',f.grants),/denied/);assert.throws(()=>progressCount(actor,v,f.grants,[]));assert.throws(()=>setCompletion(actor,v,'question',f.grants,[],true));}
 for(const grants of [[],f.grants.map(g=>({...g,active:false})),f.grants.map(g=>({...g,tenantId:'other-studio'})),f.grants.map(g=>({...g,courseVersionId:'missing'})),f.grants.map(g=>({...g,learnerId:'someone-else'}))]) assert.equal(canRead(learner,v,grants),false);
 assert.equal(canRead({...learner,tenantId:'other-studio'},v,f.grants),false);assert.equal(canRead(learner,{...v,tenantId:'other-studio'},f.grants),false);assert.throws(()=>readLesson(learner,v,'guessed',f.grants));assert.throws(()=>staff(f.actors[4],'fieldwork'));
 assert.ok(canRead(learner,v,[...f.grants.map(g=>({...g,active:false})),f.grants[0]]));
});
test('A5 idempotence, undo, no navigation writes, scoped deduplication and purchased denominator', () => {
 const f=fixtures(),a=f.actors[2],v=f.versions[0];let p:Progress[]=[];
 p=setCompletion(a,v,'question',f.grants,p,true);p=setCompletion(a,v,'question',f.grants,p,true);assert.equal(p.length,1);assert.deepEqual(progressCount(a,v,f.grants,p),{completed:1,total:3,percent:33});
 readLesson(a,v,'signal',f.grants);assert.equal(p.length,1);
 const polluted=[...p,...p,{...p[0],lessonId:'unknown'},{...p[0],tenantId:'other-studio'},{...p[0],learnerId:'other'},{...p[0],courseVersionId:'different'}];assert.equal(progressCount(a,v,f.grants,polluted).completed,1);
 const d=structuredClone(f.draft);d.modules[0].lessons.push({id:'new',title:'new',body:'new',included:true});assert.equal(publishCourse(f.actors[0],d,2,true).modules[0].lessons.length,3);assert.equal(progressCount(a,v,f.grants,p).total,3);
 p=setCompletion(a,v,'question',f.grants,p,false);p=setCompletion(a,v,'question',f.grants,p,false);assert.equal(p.length,0);assert.throws(()=>setCompletion(a,v,'unknown',f.grants,p,true));
 for(const m of v.modules)for(const l of m.lessons)p=setCompletion(a,v,l.id,f.grants,p,true);assert.equal(progressCount(a,v,f.grants,p).percent,100);
 assert.deepEqual(progressCount(a,{...v,modules:[]},f.grants,p),{completed:0,total:0,percent:0});
 const o=publishOffer(f.actors[0],f.offer,f.versions);publishStorefront(f.actors[0],'fieldwork',[],[o],f.versions);assert.ok(canRead(a,v,f.grants));
});
