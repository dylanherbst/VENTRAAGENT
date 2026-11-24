'use client';
// UI lab: the VENTRA glass UI kit (@/components/glass), every component on one page. Branch ui/lab only; demo data.
import { useCallback, useState } from 'react';
import { GlassBottomNav, GlassCard, GlassPage, GlassSection, Icons as I } from '@/components/glass';
import { BadgesAndChips, ListCard, QuickActions } from './parts-a';
import { FormFields, SearchAndTabs, SetupChecklist } from './parts-b';
import { EmptyState, Notices, SheetAndToastDemo } from './parts-c';

export default function ComponentsLab() {
  const [tab, setTab] = useState('home');
  const select = useCallback((k: string) => setTab(k), []);
  return (
    <GlassPage>
      <GlassSection title="1 · Top header">
        <GlassCard padding="14px" cornerRadius={28}>
          <header className="g-header">
            <span className="g-avatar" aria-hidden="true">D</span>
            <div className="g-header-text"><small>Good morning</small><strong>Dylan</strong></div>
            <button type="button" className="g-icon-btn" aria-label="Notifications, 3 new">{I.bell}<span className="g-dot-count">3</span></button>
          </header>
        </GlassCard>
      </GlassSection>

      <GlassSection title="2 · Buttons">
        <GlassCard>
          <div className="g-stack">
            <button type="button" className="g-btn g-btn-primary">Book a call</button>
            <button type="button" className="g-btn g-btn-glass">View details</button>
            <div className="g-row">
              <button type="button" className="g-btn g-btn-primary g-btn-sm">{I.plus}Add</button>
              <button type="button" className="g-btn g-btn-glass g-btn-sm">Cancel</button>
              <button type="button" className="g-btn g-btn-ghost g-btn-sm">Skip</button>
              <button type="button" className="g-icon-btn" aria-label="More options">{I.more}</button>
            </div>
            <button type="button" className="g-btn g-btn-primary" disabled>Disabled</button>
          </div>
        </GlassCard>
      </GlassSection>

      <GlassSection title="3 · Stat tiles">
        <div className="g-grid2">
          <GlassCard tint="grape" padding="16px">
            <div className="g-stat"><small>Revenue this month</small><strong>$4,280</strong><span className="g-trend up">{I.up}12% vs last month</span></div>
          </GlassCard>
          <GlassCard padding="16px">
            <div className="g-stat"><small>New leads</small><strong>38</strong><span className="g-trend down">{I.down}4% vs last week</span></div>
          </GlassCard>
        </div>
      </GlassSection>

      <GlassSection title="4 · Badges and chips"><GlassCard padding="16px"><BadgesAndChips /></GlassCard></GlassSection>
      <GlassSection title="5 · List card"><GlassCard padding="16px"><ListCard /></GlassCard></GlassSection>
      <GlassSection title="6 · Quick actions"><GlassCard padding="14px"><QuickActions /></GlassCard></GlassSection>
      <GlassSection title="7 · Search and tabs"><GlassCard padding="14px"><SearchAndTabs /></GlassCard></GlassSection>
      <GlassSection title="8 · Form fields"><GlassCard><FormFields /></GlassCard></GlassSection>
      <GlassSection title="9 · Setup checklist"><GlassCard tint="grape" padding="18px"><SetupChecklist /></GlassCard></GlassSection>
      <GlassSection title="10 · Notices"><GlassCard padding="14px"><Notices /></GlassCard></GlassSection>
      <GlassSection title="11 · Empty state"><GlassCard><EmptyState /></GlassCard></GlassSection>
      <GlassSection title="12 · Bottom sheet and toast"><GlassCard padding="14px"><SheetAndToastDemo /></GlassCard></GlassSection>

      <GlassBottomNav current={tab} onSelect={select} />
    </GlassPage>
  );
}
