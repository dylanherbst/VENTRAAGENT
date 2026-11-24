import {restoreMarketEvidenceNotebook,marketEvidenceStorageKey} from './local-market-evidence.ts';
import {restoreAdConceptDrafts,adConceptStorageKey} from './local-ad-concepts.ts';
import {restoreContacts,contactStorageKey} from './local-crm-contacts.ts';
import {assertProfileRevision} from './profile-revision.ts';
export type GrowthPlan={version:1;profileId:string;title:string;plan:string;task:string;contactId:string;conceptId:string;mode:'review-only'|'consented-follow-up';evidenceRevision:number;updatedAt:string};
export const growthPlanKey=(id:string)=>'ventra.growth-plan.v1.'+id;
export function restoreGrowthPlan(raw:string|null,id:string):GrowthPlan|null{
 if(raw===null)return null;
 if(raw.length>16000)throw Error('Saved growth plan is too large. Nothing was overwritten.');
 let p:GrowthPlan;try{p=JSON.parse(raw);}catch{throw Error('Saved growth plan cannot be read. Original bytes are unchanged.');}
 if(!p||p.version!==1||p.profileId!==id||!['review-only','consented-follow-up'].includes(p.mode)||!Number.isInteger(p.evidenceRevision)||p.evidenceRevision<1||!Number.isFinite(Date.parse(p.updatedAt)))throw Error('Invalid saved growth plan. Nothing was overwritten.');
 for(const [key,max] of [['title',160],['plan',3000],['task',1000],['contactId',160],['conceptId',160]] as const)if(typeof p[key]!=='string'||!p[key].trim()||p[key].length>max)throw Error('Growth plan fields are required and must stay within their limits.');
 return {version:1,profileId:p.profileId,title:p.title,plan:p.plan,task:p.task,contactId:p.contactId,conceptId:p.conceptId,mode:p.mode,evidenceRevision:p.evidenceRevision,updatedAt:p.updatedAt};
}
export function growthSourceKeys(id:string){return [marketEvidenceStorageKey(id),adConceptStorageKey(id),contactStorageKey(id)];}
export function saveGrowthPlan(storage:Pick<Storage,'getItem'|'setItem'>,profileRaw:string|null,expected:string|null,sourceRaw:(string|null)[],draft:GrowthPlan):string{
 assertProfileRevision(storage,profileRaw,draft.profileId);
 const keys=growthSourceKeys(draft.profileId);
 if(sourceRaw.length!==keys.length||keys.some((key,i)=>storage.getItem(key)!==sourceRaw[i]))throw Error('Research, content or contacts changed. Save refused; keep your edits and review sources before reloading.');
 const evidence=restoreMarketEvidenceNotebook(sourceRaw[0],draft.profileId);
 const concepts=restoreAdConceptDrafts(sourceRaw[1],draft.profileId);
 const contacts=restoreContacts(sourceRaw[2],draft.profileId);
 const contact=contacts.find(c=>c.id===draft.contactId);
 if(!evidence||!evidence.sources.some(s=>s.sourceUrl&&s.verificationStatus==='reviewed-by-creator')||!concepts.some(c=>c.id===draft.conceptId)||!contact)throw Error('Choose saved content, a local contact and at least one creator-reviewed source URL first. Review is manual, not independent verification.');
 if(draft.mode==='consented-follow-up'&&contact.consentStatus!=='opted_in')throw Error('This contact is not opted in. Use a review-only task; do not contact them.');
 const raw=JSON.stringify({...draft,evidenceRevision:evidence.revision,updatedAt:new Date().toISOString()});
 restoreGrowthPlan(raw,draft.profileId);
 const key=growthPlanKey(draft.profileId);const current=storage.getItem(key);restoreGrowthPlan(current,draft.profileId);
 if(current!==expected)throw Error('Saved growth plan changed. Your unsaved edits remain.');
 const validated=JSON.stringify(restoreGrowthPlan(raw,draft.profileId));
 storage.setItem(key,validated);return validated;
}
