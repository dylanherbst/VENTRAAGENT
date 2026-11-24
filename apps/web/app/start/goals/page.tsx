import type { Metadata } from 'next';
import { GoalsFlow } from './goals-flow';

export const metadata: Metadata = { title: 'Your goals' };

// Goal questionnaire: the existing onboarding model and save/resume store, on the glass library.
export default function StartGoals() {
  return <GoalsFlow />;
}
