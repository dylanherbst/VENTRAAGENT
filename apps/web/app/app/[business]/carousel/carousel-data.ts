// Plain data for the three-panel workspace carousel, built from the real overview view model (no React, so the node tests can check it).
// Nothing here is invented: every count, label and link comes from the overview read model.
import type { OverviewViewModel } from '../view-model';
import type { HomeView, InboxCounts } from '../../../../lib/aimp/home/build';
import type { AiTeamSummary } from '../_server/ai-team-summary';

export type Group = 'build' | 'growth';
export interface CTask { id: string; label: string; done: boolean; href: string | null; guided: boolean; group: Group }
export interface CTile { id: string; label: string; value: string; note: string; unknown: boolean }
export interface CarouselData {
  businessId: string;
  businessName: string;
  stateLabel: string;
  storeText: string;
  storeUrl: string | null;
  percent: number;
  done: number;
  total: number;
  next: { label: string; href: string | null; action: string; group: Group } | null;
  tasks: CTask[];
  count: Record<Group, { done: number; total: number }>;
  tiles: CTile[];
  attention: { title: string; impact: string; href: string | null } | null;
  inboxWaiting: number;
  /** True while a new seller is being guided: the main button glows. */
  guided: boolean;
  /** AI Team posts: waiting for approval and the next ones scheduled. Null when the AI Team is not available here. */
  aiTeam: { pending: number; href: string; upcoming: { label: string }[] } | null;
  marketingHref: string;
  ordersHref: string;
}

/** Setup steps up to a published store belong to Build; taking payments and the first order belong to Growth. */
export const GROUP_OF: Readonly<Record<string, Group>> = { idea: 'build', brand: 'build', product: 'build', catalogue: 'build', store: 'build', payments: 'growth', first_order: 'growth' };

/** `extra` is the Home page's own view (same read model plus Inbox), so the carousel and phone Home never disagree with Home about what to do next. */
export function buildCarouselData(vm: OverviewViewModel, extra?: { home: HomeView; inbox: InboxCounts; team?: AiTeamSummary | null }): CarouselData {
  const tasks: CTask[] = vm.progress.steps.map((s) => ({ id: s.id, label: s.label, done: s.done, href: s.href, guided: s.guided, group: GROUP_OF[s.id] ?? 'build' }));
  const count = (g: Group) => { const t = tasks.filter((x) => x.group === g); return { done: t.filter((x) => x.done).length, total: t.length }; };
  const open = tasks.find((t) => !t.done);
  const p = vm.primary;
  const top = vm.needsYou[0];
  const base: CarouselData = {
    businessId: vm.businessId,
    businessName: vm.title,
    stateLabel: vm.stateLabel,
    storeText: vm.storeLine.text,
    storeUrl: vm.storeLine.url,
    percent: vm.progress.total ? Math.round((vm.progress.done / vm.progress.total) * 100) : 0,
    done: vm.progress.done,
    total: vm.progress.total,
    next: open ? { label: open.label, href: open.href, action: open.group === 'build' ? 'Continue building' : 'Open this step', group: open.group }
      : p.kind === 'fix' ? { label: p.title, href: p.href, action: p.label, group: 'growth' } : null,
    tasks,
    count: { build: count('build'), growth: count('growth') },
    tiles: vm.tiles.map((t) => ({ id: t.id, label: t.label, value: t.value, note: t.note, unknown: t.unknown })),
    attention: top ? { title: top.title, impact: top.impact, href: top.href } : null,
    inboxWaiting: 0,
    guided: false,
    aiTeam: null,
    marketingHref: `/app/${vm.businessId}/marketing`,
    ordersHref: `/app/${vm.businessId}/orders`,
  };
  if (!extra) return base;
  const { home, inbox } = extra;
  const group: Group = open?.group ?? 'growth';
  const need = home.needsMe[0];
  return {
    ...base,
    next: { label: home.next.title, href: home.next.href, action: home.next.action, group },
    attention: need ? { title: need.text, impact: '', href: need.href } : null,
    inboxWaiting: inbox.waiting,
    guided: !home.guide.showFullMenu,
    aiTeam: extra.team ? { pending: extra.team.pending, href: `/app/${vm.businessId}/ai-team`, upcoming: extra.team.upcoming.map((u) => ({ label: `${u.date} ${u.time} · ${u.platform}` })) } : null,
  };
}
