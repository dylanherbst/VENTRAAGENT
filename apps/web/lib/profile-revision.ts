import {restoreProfile,storageKey} from './onboarding.ts';
import type {Profile} from './onboarding.ts';
export function assertProfileRevision(storage:Pick<Storage,'getItem'>,expected:string|null,profileId:string):Profile {
 const raw=storage.getItem(storageKey);
 const profile=restoreProfile(raw);
 if(!profile||profile.id!==profileId||raw!==expected)throw Error('Business details changed or cannot be read. Save was refused; your unsaved edits remain. Review saved setup before reloading.');
 return profile;
}
