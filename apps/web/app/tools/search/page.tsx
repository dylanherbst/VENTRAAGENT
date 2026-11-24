'use client';
import { useEffect, useState } from 'react';
import { DraftSearch } from '../../ui/draft-search';
import type { SearchMode } from '../../ui/draft-search';
import { ConnectionBadges } from '../../ui/connection-badges';
import { restoreProfile, storageKey } from '../../../lib/onboarding';
import type { Profile } from '../../../lib/onboarding';

// Isolated test page: the exact search box used on Home, over real saved drafts in this browser and the account.
export default function SearchTest() {
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);
  const [mode, setMode] = useState<SearchMode | null>(null);
  useEffect(() => { try { setProfile(restoreProfile(localStorage.getItem(storageKey))); } catch { setProfile(null); } }, []);
  return <main>
    <h1>Search saved items test</h1>
    <p><span className="v-status" data-testid="page-mode">{profile === undefined ? 'Checking…' : !profile ? 'DEMO · No saved business in this browser, so nothing to search' : mode === 'LIVE' ? 'LIVE · Searched browser and account' : mode === 'DEMO' ? 'DEMO · Account not searched, browser only' : 'LIVE · Real saved drafts in this browser (search to also check the account)'}</span> Read-only.</p>
    <ConnectionBadges />
    {profile ? <DraftSearch profileId={profile.id} onMode={setMode} /> : profile === null ? <p role="status">Save your business setup first.</p> : <p role="status">Loading…</p>}
  </main>;
}
