'use client';
import type { ReactNode } from 'react';
import type { Profile } from '../../lib/onboarding';
import type { LocalOffer } from '../../lib/local-offers';
import EducationCourseSalesPageDraftEditor from './education-course-sales-page-draft';
import EducationCertificateTemplateDraftEditor from './education-certificate-template-draft';
import EducationCoachingProgramDraftEditor from './education-coaching-program-draft';
import EducationWorkshopPlanDraftEditor from './education-workshop-plan-draft';
import ServiceClientPortalDraftEditor from './service-client-portal-draft';
import ServiceAgreementDraftEditor from './service-agreement-draft';
import AdConceptDraftEditor from './ad-concept-draft';
import LinkInBioDraftEditor from './link-in-bio-draft';

const Section = ({ id, title, children }: { id: string; title: string; children: ReactNode }) => <details id={id} className="v-extra"><summary>{title}</summary>{children}</details>;

/** The remaining Create editors, mounted on the customer Offers tab so every Ready tile lands on a real editor.
 *  Pathway-gated editors only render when that pathway is on; the hubs show the matching tiles as "Turn on ..." instead of Ready. */
export default function OfferExtras({ profile, offers }: { profile: Profile; offers: LocalOffer[] }) {
  const edu = profile.pathways.includes('education');
  const biz = profile.pathways.includes('business');
  return <>
    {edu && <>
      <Section id="course-sales-page" title="Course sales page"><EducationCourseSalesPageDraftEditor key={`sales-${profile.id}`} profile={profile} offers={offers} /></Section>
      <Section id="certificates" title="Certificate template"><EducationCertificateTemplateDraftEditor key={`cert-${profile.id}`} profile={profile} /></Section>
      <Section id="coaching" title="Coaching program"><EducationCoachingProgramDraftEditor key={`coach-${profile.id}`} profile={profile} offers={offers} /></Section>
      <Section id="workshop" title="Workshop plan"><EducationWorkshopPlanDraftEditor key={`workshop-${profile.id}`} profile={profile} offers={offers} /></Section>
    </>}
    {biz && <>
      <Section id="client-portal" title="Client portal draft"><ServiceClientPortalDraftEditor key={`portal-${profile.id}`} profileId={profile.id} /></Section>
      <Section id="agreements" title="Service agreement"><ServiceAgreementDraftEditor key={`agreement-${profile.id}`} profileId={profile.id} /></Section>
    </>}
    <Section id="ad-concepts" title="Ad concepts"><AdConceptDraftEditor key={`ad-${profile.id}`} profile={profile} offers={offers} /></Section>
    <Section id="link-in-bio" title="Link in bio"><LinkInBioDraftEditor key={`bio-${profile.id}`} profile={profile} offers={offers} /></Section>
  </>;
}
