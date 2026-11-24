'use client';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { restoreProfile, storageKey } from '../../lib/onboarding';
import { assertProfileRevision } from '../../lib/profile-revision';
import type { Profile } from '../../lib/onboarding';
import { GlassCard } from '../design-system/primitives';
const Context=createContext<{profile:Profile|null;ready:boolean;raw:string|null;error:string;reload:()=>void}>({profile:null,ready:false,raw:null,error:'',reload:()=>{}});
export function WorkspaceProvider({children}:{children:ReactNode}){
 const loaded=useRef(false);const [raw,setRaw]=useState<string|null>(null);const [profile,setProfile]=useState<Profile|null>(null);const [ready,setReady]=useState(false);const [error,setError]=useState('');
 function reload(){try{const raw=localStorage.getItem(storageKey);const p=restoreProfile(raw);if(raw===null&&loaded.current){setError('Saved business details were removed. Unsaved editors remain paused.');setReady(true);return;}if(!raw||p){setProfile(p);setRaw(raw);if(p)loaded.current=true;}setError(raw&&!p?'Saved business details could not be read. Nothing has been overwritten. Review the original in local tools.':'');}catch{setError('Browser storage is unavailable. Saved records cannot be read.');}setReady(true);}
 useEffect(()=>{reload();window.addEventListener('storage',reload);window.addEventListener('ventra:updated',reload);return()=>{window.removeEventListener('storage',reload);window.removeEventListener('ventra:updated',reload);};},[]);
 return <Context value={{profile,raw,ready,error,reload}}>{children}</Context>;
}
export function useWorkspace(){return useContext(Context);}
export function ProfileGate({children}:{children:(profile:Profile)=>ReactNode}){const {profile,raw,ready,error,reload}=useWorkspace();return <div className="v-profile-boundary">{error&&<GlassCard><h2>Your data needs attention</h2><p role="alert">{error} Previously loaded editors are paused; unsaved edits remain below.</p><button className="v-button" onClick={reload}>Retry reading saved setup</button><Link className="v-button" href="/onboarding">Review your business setup</Link></GlassCard>}<div inert={!!error}>{!ready?<p role="status">Restoring your workspace…</p>:profile?<ProfileRevisionBoundary key={profile.id} profile={profile} raw={raw}>{children(profile)}</ProfileRevisionBoundary>:!error?<GlassCard><h2>A little context goes a long way</h2><p>Save your business details to begin. Setup is local, optional connections stay off, and other pages remain available.</p><Link className="v-button v-button-primary" href="/onboarding">Set up your business</Link></GlassCard>:null}</div></div>;}

function ProfileRevisionBoundary({profile,raw,children}:{profile:Profile;raw:string|null;children:ReactNode}){
 const expected=useRef(raw);const root=useRef<HTMLDivElement>(null);const [error,setError]=useState('');const [copy,setCopy]=useState<string|null>(null);
 function reviewEdits(){
  const forms=[...(root.current?.querySelectorAll('form')||[])];
  const fields=forms.flatMap((form,formIndex)=>[...form.querySelectorAll('input,textarea,select')].flatMap((field,index)=>{
   if(!(field instanceof HTMLInputElement||field instanceof HTMLTextAreaElement||field instanceof HTMLSelectElement)||field.matches(':disabled')||('readOnly' in field&&field.readOnly)||(field instanceof HTMLInputElement&&['password','hidden','file','submit','button'].includes(field.type)))return [];
   // Conservative concealment policy: never copy from hidden/inert/aria-hidden,
   // display:none, visibility:hidden/collapse, opacity:0 or content-visibility:hidden ancestors.
   for(let node:HTMLElement|null=field;node;node=node.parentElement){
    const style=getComputedStyle(node);
    if(node.hidden||node.inert||node.getAttribute('aria-hidden')==='true'||style.display==='none'||['hidden','collapse'].includes(style.visibility)||style.opacity==='0'||style.contentVisibility==='hidden')return [];
   }
   if(!field.getClientRects().length)return [];
   const labelNode=field.labels?.[0]?.cloneNode(true) as HTMLElement|undefined;
   labelNode?.querySelectorAll('input,textarea,select,button').forEach(node=>node.remove());
   const label=field.getAttribute('aria-label')||labelNode?.textContent?.trim()||`Field ${index+1}`;
   const selection=field instanceof HTMLSelectElement?[...field.selectedOptions].map(option=>({value:option.value,label:option.label})):undefined;
   const checked=field instanceof HTMLInputElement&&['checkbox','radio'].includes(field.type)?field.checked:undefined;
   return [{form:formIndex+1,label,value:field.value,...(selection?{selection}:{}),...(checked!==undefined?{checked}: {})}];
  }));
  setCopy(JSON.stringify({capturedAt:new Date().toISOString(),notice:'Snapshot; click Review again to refresh after editing. Manual recovery copy only. Not imported or saved. Review against current setup before re-entering.',fields},null,2));
 }
 return <div ref={root} onSubmitCapture={event=>{try{assertProfileRevision(localStorage,expected.current,profile.id);setError('');}catch(issue){event.preventDefault();event.stopPropagation();setError((issue as Error).message);}}}>{error&&<section className="v-feedback" aria-label="Unsaved edit recovery"><p role="alert">{error}</p><p>Keep this page open. Review a plain-text copy of the current form fields before reloading; passwords and hidden fields are excluded. The copy may contain private details: keep it on your device. This does not save or reconcile records.</p><button type="button" className="v-button" onClick={reviewEdits}>Review unsaved form copy</button>{copy!==null&&<label>Unsaved recovery snapshot (Review again to refresh)<textarea readOnly rows={10} value={copy} onFocus={event=>event.currentTarget.select()} /></label>}<Link className="v-button" href="/onboarding" target="_blank" rel="noopener noreferrer">Review saved setup in a new tab</Link></section>}{children}</div>;
}
