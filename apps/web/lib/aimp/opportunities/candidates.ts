// Demo candidate catalogue for the Opportunity Finder. Every signal here is labelled demo/fixture when used:
// these are illustrative numbers for testing the flow, NOT market research. A factor with no signal has no evidence.
import type { Confidence } from '../contracts.ts';

export type SignalKey = 'demand' | 'automation' | 'differentiation' | 'repeatPurchases' | 'workload';

export interface Signal { score: number; confidence: Confidence; note: string; source: string }

export interface Candidate {
  id: string;
  niche: string;
  blueprintId: string;
  whatToSell: string;
  whoToSellTo: string;
  /** Lower-case words matched against interests and skills. */
  tags: string[];
  /** Ongoing hours per week once launched (estimate). */
  ongoingHoursPerWeek: number;
  signals: Partial<Record<SignalKey, Signal>>;
}

/** Demo data is never better than low confidence, whatever the sample row says. */
export const FIXTURE_CONFIDENCE_CAP: Confidence = 'low';
const s = (score: number, stated: Confidence, source: string, note: string): Signal => ({ score, confidence: stated && FIXTURE_CONFIDENCE_CAP, note, source });
const SEARCH = 'Demo search-interest sample';
const MARKET = 'Demo marketplace listing sample';
const BUILD = 'Demo build-effort estimate';

export const demoCandidates: readonly Candidate[] = [
  {
    id: 'meal-planner', niche: 'Weekly meal planner for busy families', blueprintId: 'printable-planner',
    whatToSell: 'A printable weekly meal planner with a shopping list page',
    whoToSellTo: 'Parents juggling work and family dinners', tags: ['meal', 'cooking', 'family', 'parenting', 'food', 'design'],
    ongoingHoursPerWeek: 2,
    signals: {
      demand: s(8, 'medium', SEARCH, 'Steady monthly searches for meal planning printables (sample figure).'),
      automation: s(8, 'medium', BUILD, 'Pages are generated from one template (sample estimate).'),
      differentiation: s(5, 'low', MARKET, 'Many similar listings; a family angle helps (sample).'),
      repeatPurchases: s(6, 'low', MARKET, 'Buyers return for seasonal refills (sample).'),
      workload: s(7, 'medium', BUILD, 'Mostly answering questions and posting pins (sample).'),
    },
  },
  {
    id: 'adhd-planner', niche: 'ADHD-friendly daily planner', blueprintId: 'printable-planner',
    whatToSell: 'A low-clutter printable daily planner with focus and break blocks',
    whoToSellTo: 'Adults and students who find standard planners overwhelming', tags: ['adhd', 'productivity', 'planner', 'focus', 'wellbeing', 'writing'],
    ongoingHoursPerWeek: 3,
    signals: {
      demand: s(8, 'medium', SEARCH, 'Growing searches for ADHD planners (sample figure).'),
      automation: s(7, 'medium', BUILD, 'Template-based with small layout variants (sample estimate).'),
      differentiation: s(6, 'low', MARKET, 'Few listings with a clear low-clutter layout (sample).'),
    },
  },
  {
    id: 'runner-tracker', niche: 'Habit tracker for new runners', blueprintId: 'printable-tracker',
    whatToSell: 'A printable running log and habit tracker for the first 12 weeks',
    whoToSellTo: 'Beginners starting a couch-to-5k style plan', tags: ['running', 'fitness', 'health', 'exercise', 'habit', 'sport'],
    ongoingHoursPerWeek: 2,
    signals: {
      demand: s(7, 'low', SEARCH, 'Seasonal peaks around the new year (sample figure).'),
      automation: s(8, 'medium', BUILD, 'Grid pages are fully templated (sample estimate).'),
      differentiation: s(5, 'low', MARKET, 'Crowded; needs a clear beginner angle (sample).'),
      repeatPurchases: s(4, 'low', MARKET, 'One plan per goal, few repeat buys (sample).'),
      workload: s(8, 'medium', BUILD, 'Very little upkeep after launch (sample).'),
    },
  },
  {
    id: 'budget-tracker', niche: 'Budget tracker for first-home savers', blueprintId: 'printable-tracker',
    whatToSell: 'A printable savings and budget tracker with a deposit progress page',
    whoToSellTo: 'Young adults saving a first-home deposit', tags: ['money', 'finance', 'budget', 'budgeting', 'saving', 'property', 'spreadsheets'],
    ongoingHoursPerWeek: 2,
    signals: {
      demand: s(9, 'medium', SEARCH, 'High, steady searches for budget printables (sample figure).'),
      automation: s(8, 'medium', BUILD, 'Templated grids with a few text variants (sample estimate).'),
      differentiation: s(4, 'low', MARKET, 'Very crowded niche; the home-saver angle is thin (sample).'),
      repeatPurchases: s(7, 'low', MARKET, 'Yearly refills are common (sample).'),
      workload: s(7, 'medium', BUILD, 'Light support load (sample).'),
    },
  },
  {
    id: 'wedding-checklist', niche: 'Wedding planning checklist', blueprintId: 'printable-checklist',
    whatToSell: 'A printable month-by-month wedding planning checklist',
    whoToSellTo: 'Engaged couples planning on a modest budget', tags: ['wedding', 'events', 'planning', 'party'],
    ongoingHoursPerWeek: 1,
    signals: {
      demand: s(8, 'medium', SEARCH, 'Consistent searches year-round (sample figure).'),
      automation: s(9, 'medium', BUILD, 'Checklist pages are simple and fully templated (sample estimate).'),
      differentiation: s(3, 'low', MARKET, 'Heavily saturated (sample).'),
      repeatPurchases: s(2, 'low', MARKET, 'Most buyers marry once (sample).'),
      workload: s(9, 'medium', BUILD, 'Almost no upkeep (sample).'),
    },
  },
  {
    id: 'moving-checklist', niche: 'Moving house checklist', blueprintId: 'printable-checklist',
    whatToSell: 'A printable moving checklist covering the 8 weeks before and after a move',
    whoToSellTo: 'Renters and buyers moving house', tags: ['moving', 'home', 'organising', 'organizing', 'property', 'writing'],
    ongoingHoursPerWeek: 1,
    signals: {
      demand: s(6, 'low', SEARCH, 'Spikes at the start of the rental season (sample figure).'),
      automation: s(9, 'medium', BUILD, 'Single templated checklist (sample estimate).'),
      differentiation: s(6, 'low', MARKET, 'Fewer polished listings than weddings (sample).'),
    },
  },
  {
    id: 'pet-kit', niche: 'New pet owner starter kit', blueprintId: 'niche-kit',
    whatToSell: 'A printable bundle with a care planner, feeding tracker and vet checklist',
    whoToSellTo: 'First-time dog and cat owners', tags: ['pets', 'dogs', 'cats', 'animals', 'photography', 'design'],
    ongoingHoursPerWeek: 3,
    signals: {
      demand: s(7, 'medium', SEARCH, 'Steady searches for new pet checklists (sample figure).'),
      automation: s(7, 'medium', BUILD, 'Three page types, each templated (sample estimate).'),
      differentiation: s(7, 'low', MARKET, 'Bundles are rarer than single pages (sample).'),
      repeatPurchases: s(5, 'low', MARKET, 'Some buyers add a second pet (sample).'),
    },
  },
  {
    id: 'garden-planner', niche: 'Backyard vegetable garden planner', blueprintId: 'printable-planner',
    whatToSell: 'A printable planting calendar and bed layout planner',
    whoToSellTo: 'Beginner home gardeners growing vegetables', tags: ['garden', 'gardening', 'plants', 'outdoors', 'food'],
    ongoingHoursPerWeek: 2,
    signals: {
      demand: s(6, 'low', SEARCH, 'Strong seasonal peaks in early spring (sample figure).'),
      repeatPurchases: s(8, 'low', MARKET, 'Gardeners buy a new planner every season (sample).'),
    },
  },
  {
    id: 'homeschool-kit', niche: 'Homeschool teacher kit', blueprintId: 'niche-kit',
    whatToSell: 'A printable bundle with a term planner, progress tracker and lesson checklist',
    whoToSellTo: 'Parents who homeschool their children', tags: ['teaching', 'education', 'homeschool', 'kids', 'learning'],
    ongoingHoursPerWeek: 3,
    // No demand signal at all: the scoring rubric excludes this idea instead of guessing.
    signals: {
      automation: s(7, 'medium', BUILD, 'Templated pages (sample estimate).'),
      differentiation: s(5, 'low', MARKET, 'Unknown crowding (sample).'),
    },
  },
];
