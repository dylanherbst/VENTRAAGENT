import { blankProfile, restoreProfile, serializeProfile, storageKey } from './onboarding.ts';
import type { Profile } from './onboarding.ts';
export const setupKey='ventra.setup-draft.v1';
export type SetupDraft={version:1;step:number;profile:Profile;baseRaw?:string|null};
export function restoreSetup(raw:string|null):SetupDraft {
 if(raw===null)return {version:1,step:0,profile:blankProfile()};
 const d=JSON.parse(raw) as SetupDraft;
 if(d?.version!==1||!Number.isInteger(d.step)||d.step<0||d.step>3||!d.profile)throw Error('Saved setup draft is invalid. Nothing was overwritten.');
 if('baseRaw' in d && d.baseRaw!==null && (typeof d.baseRaw!=='string'||!restoreProfile(d.baseRaw)))throw Error('Saved setup base is invalid. Nothing was overwritten.');
 const p=d.profile;
 for(const key of ['name','audience','goal','expertise','industry','website'] as const)if(typeof p[key]!=='string')throw Error('Invalid setup text.');
 if(!restoreProfile(JSON.stringify({...p,name:p.name||'Draft',audience:p.audience||'Draft',goal:p.goal||'Draft',expertise:p.expertise||'Draft',industry:p.industry||'Draft',website:''}))||typeof p.website!=='string')throw Error('Saved setup draft is invalid.');
 return d;
}
export type LocalStorage=Pick<Storage,'getItem'|'setItem'>;
export function writeCompared(storage:LocalStorage,key:string,expected:string|null,value:string):string {
 if(storage.getItem(key)!==expected)throw Error('Saved data changed in another tab. Reload before saving; your edits are still here.');
 storage.setItem(key,value);return value;
}
export function saveWorkspace(storage:LocalStorage,key:string,expected:string|null,profile:Profile){return writeCompared(storage,key,expected,serializeProfile(profile));}
// Setup owns only these fields, never legacy notes, checklist or other metadata.
const setupFields=['name','primary','pathways','stage','industry','audience','goal','expertise','website'] as const;
export function setupMatches(draft:SetupDraft,baseRaw:string|null){return Object.hasOwn(draft,'baseRaw')&&draft.baseRaw===baseRaw;}
export function reconcileSetup(draft:SetupDraft,baseRaw:string|null,useDraft:boolean):SetupDraft {
 const saved=restoreProfile(baseRaw);
 if(baseRaw!==null&&!saved)throw Error('Saved business details are unreadable. Nothing was overwritten.');
 const profile={...(saved||blankProfile())};
 if(useDraft)for(const field of setupFields)Object.assign(profile,{[field]:draft.profile[field]});
 return {...draft,baseRaw,profile};
}
export function saveSetupWorkspace(storage:LocalStorage & Pick<Storage,'removeItem'>,draft:SetupDraft,expectedDraft:string|null){
 if(!setupMatches(draft,storage.getItem(storageKey)))throw Error('Saved business details changed. Reconcile before saving; your edits are still here.');
 if(storage.getItem(setupKey)!==expectedDraft)throw Error('Saved setup changed in another tab. Your edits are still here; review the competing draft before continuing.');
 const merged=reconcileSetup(draft,draft.baseRaw!,true).profile;
 const raw=saveWorkspace(storage,storageKey,draft.baseRaw!,merged);
 // Never retire a competing draft. Cleanup failure may leave a matching draft after an identical save; later profile changes still require reconciliation.
 try{if(storage.getItem(setupKey)===expectedDraft)storage.removeItem(setupKey);}catch{/* Saved profile remains valid. */}
 return raw;
}
export type AuditAction={finding:string;evidence:string;impact:'High'|'Medium'|'Low';confidence:'High'|'Medium'|'Low';destination:'/business'|'/grow'|'/inbox'|'/customers'|'/sales'};
export type Audit={version:1;assessment:string;underperforming:string;plan:string;actions:AuditAction[];updatedAt:string};
export const auditKey='ventra.manual-growth-audit.v1.local-business';
export function blankAudit():Audit{return {version:1,assessment:'',underperforming:'',plan:'',actions:[],updatedAt:''};}
export function validateAudit(value:unknown,saved=true):Audit {
 const a=value as Audit;
 if(!a||a.version!==1||!Array.isArray(a.actions)||a.actions.length>3)throw Error('Invalid audit draft.');
 for(const key of ['assessment','underperforming','plan','updatedAt'] as const)if(typeof a[key]!=='string'||a[key].length>6000)throw Error('Invalid audit field.');
 if(saved&&(!a.assessment.trim()||!a.plan.trim()||!a.updatedAt||!Number.isFinite(Date.parse(a.updatedAt))))throw Error('Add an assessment and 30-day plan.');
 for(const x of a.actions){if(!x||typeof x.finding!=='string'||!x.finding.trim()||x.finding.length>1000||typeof x.evidence!=='string'||!x.evidence.trim()||x.evidence.length>2000||!['High','Medium','Low'].includes(x.impact)||!['High','Medium','Low'].includes(x.confidence)||!['/business','/grow','/inbox','/customers','/sales'].includes(x.destination))throw Error('Each action needs a finding, evidence, impact, confidence and a valid destination.');}
 return a;
}
export function restoreAudit(raw:string|null){return raw===null?null:validateAudit(JSON.parse(raw));}
