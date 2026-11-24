import { adConceptStorageKey } from './local-ad-concepts.ts';
import { bookingPageStorageKey } from './local-booking-page.ts';
import { businessPlanStorageKey } from './local-business-plan-draft.ts';
import { brandDirectionStorageKey } from './local-brand-direction-draft.ts';
import { communitySpaceStorageKey } from './local-community-space.ts';
import { contactStorageKey } from './local-crm-contacts.ts';
import { dealStorageKey } from './local-crm-pipeline.ts';
import { contentCalendarStorageKey } from './local-content-calendar.ts';
import { educationCertificateTemplateStorageKey } from './local-education-certificate-template.ts';
import { educationCoachingProgramStorageKey } from './local-education-coaching-program.ts';
import { educationCourseSalesPageStorageKey } from './local-education-course-sales-page.ts';
import { educationWorkshopPlanStorageKey } from './local-education-workshop-plan.ts';
import { emailCampaignsStorageKey } from './local-email-campaigns.ts';
import { funnelsStorageKey } from './local-funnels.ts';
import { growthPlanKey } from './local-growth-plan.ts';
import { followupStorageKey } from './local-lead-followups.ts';
import { leadFormStorageKey } from './local-lead-forms.ts';
import { leadScoringStorageKey } from './local-lead-scoring.ts';
import { linkInBioStorageKey } from './local-link-in-bio.ts';
import { marketEvidenceStorageKey } from './local-market-evidence.ts';
import { membershipStorageKey } from './local-membership-plans.ts';
import { offerStorageKey } from './local-offers.ts';
import { offerValidationStorageKey } from './local-offer-validation-worksheet.ts';
import { pricingScenarioStorageKey } from './local-pricing-scenario.ts';
import { serviceAgreementStorageKey } from './local-service-agreement-draft.ts';
import { serviceClientPortalStorageKey } from './local-service-client-portal-draft.ts';
import { serviceInvoiceStorageKey } from './local-service-invoice-draft.ts';
import { serviceProjectBoardStorageKey } from './local-service-project-board.ts';
import { skillAssessmentStorageKey } from './local-skill-assessment.ts';
import { storefrontStorageKey } from './local-storefront.ts';
import { studentProgressStorageKey } from './local-student-progress.ts';
import { websitePageStorageKey } from './local-website-page.ts';
import { workflowsStorageKey } from './local-workflow-builder.ts';
import { proposalStorageKey } from './service-proposals.ts';
import type { LauncherKind } from './launcher-drafts.ts';

// One place that says, for each account-synced draft kind: its plain name, the page where the owner edits it, and (when it has its own
// browser key) where the browser copy lives. Kinds with no entry here are not searched or compared (they live inside another store).
export type DraftInfo = { label: string; href: string; localKey?: (profileId: string) => string };
export const draftRegistry: Partial<Record<LauncherKind, DraftInfo>> = {
  'skill-assessment': { label: 'Skill assessment', href: '/create/start#start-skills', localKey: skillAssessmentStorageKey },
  'market-evidence': { label: 'Market evidence', href: '/create/start#start-evidence', localKey: marketEvidenceStorageKey },
  'offer-validation': { label: 'Offer validation', href: '/create/start#start-validate', localKey: offerValidationStorageKey },
  'pricing-scenario': { label: 'Pricing scenario', href: '/create/start#start-pricing', localKey: pricingScenarioStorageKey },
  'brand-direction': { label: 'Brand direction', href: '/create/start#start-branding', localKey: brandDirectionStorageKey },
  'business-plan': { label: 'Business plan', href: '/create/start#start-plan', localKey: businessPlanStorageKey },
  'crm-contacts': { label: 'Contacts', href: '/customers', localKey: contactStorageKey },
  'crm-pipeline': { label: 'Deals', href: '/customers?tab=opportunities', localKey: dealStorageKey },
  'lead-forms': { label: 'Lead form', href: '/grow?tab=leads', localKey: leadFormStorageKey },
  'storefront': { label: 'Storefront', href: '/business?tab=website', localKey: storefrontStorageKey },
  'link-in-bio': { label: 'Link in bio', href: '/business?tab=offers#link-in-bio', localKey: linkInBioStorageKey },
  'ad-concepts': { label: 'Ad concepts', href: '/grow?tab=content', localKey: adConceptStorageKey },
  'community-space': { label: 'Community space', href: '/business?tab=delivery#community', localKey: communitySpaceStorageKey },
  'website-page': { label: 'Website page', href: '/business?tab=website', localKey: websitePageStorageKey },
  'service-proposals': { label: 'Service proposals', href: '/business?tab=delivery', localKey: proposalStorageKey },
  'service-agreement': { label: 'Service agreement', href: '/business?tab=offers#agreements', localKey: serviceAgreementStorageKey },
  'service-invoice': { label: 'Invoice draft', href: '/sales?tab=invoices', localKey: serviceInvoiceStorageKey },
  'service-portal': { label: 'Client portal', href: '/business?tab=offers#client-portal', localKey: serviceClientPortalStorageKey },
  'service-projects': { label: 'Project board', href: '/business?tab=delivery#client-projects', localKey: serviceProjectBoardStorageKey },
  'education-certificate': { label: 'Certificate template', href: '/business?tab=offers#certificates', localKey: educationCertificateTemplateStorageKey },
  'education-sales-page': { label: 'Course sales page', href: '/business?tab=offers#course-sales-page', localKey: educationCourseSalesPageStorageKey },
  'education-coaching': { label: 'Coaching program', href: '/business?tab=offers#coaching', localKey: educationCoachingProgramStorageKey },
  'education-workshop': { label: 'Workshop plan', href: '/business?tab=offers#workshop', localKey: educationWorkshopPlanStorageKey },
  'lead-scoring': { label: 'Lead scoring', href: '/customers?tab=lead-scoring', localKey: leadScoringStorageKey },
  'content-calendar': { label: 'Content calendar', href: '/grow?tab=content', localKey: contentCalendarStorageKey },
  'email-campaigns': { label: 'Email campaigns', href: '/grow?tab=campaigns', localKey: emailCampaignsStorageKey },
  'funnels': { label: 'Funnels', href: '/grow?tab=funnels', localKey: funnelsStorageKey },
  'booking-page': { label: 'Booking page', href: '/sales?tab=appointments', localKey: bookingPageStorageKey },
  'student-progress': { label: 'Student progress', href: '/business?tab=delivery', localKey: studentProgressStorageKey },
  'workflow-builder': { label: 'Workflows', href: '/grow?tab=automations', localKey: workflowsStorageKey },
  'service-offers': { label: 'Offers and pricing', href: '/business?tab=offers', localKey: offerStorageKey },
  'growth-plan': { label: 'Growth plan', href: '/grow?tab=campaigns', localKey: growthPlanKey },
  'lead-followups': { label: 'Follow-ups', href: '/customers?tab=follow-ups', localKey: followupStorageKey },
  'membership-plans': { label: 'Membership plans', href: '/business?tab=memberships', localKey: membershipStorageKey },
};
/** Plain name for any kind, including kinds without a registry entry. */
export const kindLabel = (kind: string): string => (draftRegistry as Record<string, DraftInfo | undefined>)[kind]?.label ?? kind.replace(/-/g, ' ');
export const kindHref = (kind: string): string => (draftRegistry as Record<string, DraftInfo | undefined>)[kind]?.href ?? '/settings';
/** Every registered kind that has a browser key, for this business. */
export function localDraftKeys(profileId: string): { kind: string; key: string }[] {
  const out: { kind: string; key: string }[] = [];
  for (const [kind, info] of Object.entries(draftRegistry)) if (info?.localKey) out.push({ kind, key: info.localKey(profileId) });
  return out;
}
