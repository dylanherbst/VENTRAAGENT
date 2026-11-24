// Shared business knowledge: the agents' business profile (lib/aimp/agents/team.ts BusinessProfile) is the single source of truth.
// The Sales agent (AI Setter) keeps its own conversation settings, but its business facts are COPIED from the profile on every
// profile save, so the three agents never hold conflicting versions of the business.
import type { BusinessProfile } from '../agents/team.ts';
import type { AgentConfig } from '../setter/types.ts';

export function setterConfigFromProfile(cfg: AgentConfig, p: BusinessProfile, now = new Date()): AgentConfig {
  const faqs = (p.faqs ?? []).map((f, i) => ({ id: `profile-faq-${i + 1}`, question: f.q, answer: f.a }));
  const ownFaqs = cfg.knowledge.filter((k) => !k.id.startsWith('profile-faq-'));
  return {
    ...cfg,
    businessName: p.businessName,
    about: [p.description || p.offer, p.location ? `Based in ${p.location}.` : '', p.products?.length ? `Products and services: ${p.products.join('; ')}.` : ''].filter(Boolean).join(' ').slice(0, 800),
    idealCustomer: p.audience || cfg.idealCustomer,
    bookingUrl: p.bookingUrl || cfg.bookingUrl,
    sellingPoints: p.usps?.length ? p.usps.slice(0, 10) : cfg.sellingPoints,
    brandVoice: p.brandVoice || cfg.brandVoice,
    timezone: p.timezone || cfg.timezone,
    knowledge: [...faqs, ...ownFaqs].slice(0, 30),
    updatedAt: now.toISOString(),
  };
}
