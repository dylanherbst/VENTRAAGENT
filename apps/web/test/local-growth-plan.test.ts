import test from 'node:test';
import assert from 'node:assert/strict';
import {blankProfile,storageKey} from '../lib/onboarding.ts';
import {growthPlanKey,growthSourceKeys,restoreGrowthPlan,saveGrowthPlan} from '../lib/local-growth-plan.ts';
import type {GrowthPlan} from '../lib/local-growth-plan.ts';
import {saveMarketEvidenceNotebook} from '../lib/local-market-evidence.ts';
import {blankAdConceptDraftInput,saveAdConceptDraft} from '../lib/local-ad-concepts.ts';
import {blankContactInput,saveContact} from '../lib/local-crm-contacts.ts';
const p={...blankProfile(),name:'QA Glass Studio',audience:'Founders',goal:'Plan',expertise:'Design'};const profileRaw=JSON.stringify(p);
const evidence=saveMarketEvidenceNotebook({marketHypothesis:'QA hypothesis',unansweredQuestions:'QA question',sources:[{id:'src',title:'QA public source',sourceUrl:'https://example.invalid/research',observation:'QA manual observation',sourceDate:'2026-10-28',sourceDateUnknown:false,relevance:'QA relevance',verificationStatus:'reviewed-by-creator'}]},p.id,null);
const concept=saveAdConceptDraft({...blankAdConceptDraftInput(),conceptLabel:'QA concept',offerSelection:'__unlinked__',audience:'Founders',angle:'QA manual',headline:'QA headline',body:'QA body',cta:'Review'}, {id:'concept',profileId:p.id},[]);
const contact=saveContact({...blankContactInput(),name:'QA Contact'}, {id:'contact',profileId:p.id});
const source=[JSON.stringify(evidence),JSON.stringify([concept]),JSON.stringify([contact])];
const draft:GrowthPlan={version:1,profileId:p.id,title:'QA campaign',plan:'QA manual plan',task:'Review only',contactId:contact.id,conceptId:concept.id,mode:'review-only',evidenceRevision:1,updatedAt:new Date().toISOString()};
function fixture(){const data=new Map([[storageKey,profileRaw],...growthSourceKeys(p.id).map((k,i)=>[k,source[i]] as [string,string])]);return {data,getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v);}};}
test('growth plan saves/restores local review-only task; non-opted-in cannot plan contact',()=>{const s=fixture();const raw=saveGrowthPlan(s,profileRaw,null,source,draft);assert.equal(restoreGrowthPlan(raw,p.id)?.contactId,contact.id);assert.throws(()=>saveGrowthPlan(s,profileRaw,raw,source,{...draft,mode:'consented-follow-up'}),/not opted in/);assert.equal(s.getItem(growthPlanKey(p.id)),raw);});
test('growth source, profile and same-key drift fail closed without writes',()=>{for(const key of [...growthSourceKeys(p.id),storageKey,growthPlanKey(p.id)]){const s=fixture();s.data.set(key,key===storageKey?profileRaw+' ':key===growthPlanKey(p.id)?'{':s.getItem(key)+' ');const before=[...s.data];assert.throws(()=>saveGrowthPlan(s,profileRaw,null,source,draft));assert.deepEqual([...s.data],before);}});
test('growth corruption, validation, missing sources and quota preserve saved bytes',()=>{for(const raw of ['{','{}','null',JSON.stringify({...draft,title:''}),JSON.stringify({...draft,profileId:'other'})])assert.throws(()=>restoreGrowthPlan(raw,p.id));const s=fixture();assert.throws(()=>saveGrowthPlan({...s,setItem:()=>{throw Error('quota');}},profileRaw,null,source,draft),/quota/);assert.equal(s.getItem(growthPlanKey(p.id)),null);const missing=fixture();missing.data.delete(growthSourceKeys(p.id)[0]);assert.throws(()=>saveGrowthPlan(missing,profileRaw,null,[null,source[1],source[2]],draft));});

test('explicit opted-in intention remains only a plan and strips unknown fields',()=>{const s=fixture();const updated=[source[0],source[1],JSON.stringify([{...contact,consentStatus:'opted_in'}])];s.data.set(growthSourceKeys(p.id)[2],updated[2]);const raw=saveGrowthPlan(s,profileRaw,null,updated,{...draft,mode:'consented-follow-up',unexpected:'not persisted'} as GrowthPlan);assert.equal(restoreGrowthPlan(raw,p.id)?.mode,'consented-follow-up');assert.equal('unexpected' in JSON.parse(raw),false);});
