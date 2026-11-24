// Ventra's own settings (customer zero): the Ventra Setter config as an agent-settings template.
import { ventraSetterConfig } from '../setter/config';

const c = ventraSetterConfig;
export const ventraTemplate = {
  businessName: c.businessName,
  offer: c.offer,
  idealCustomer: c.idealCustomer,
  notAFit: c.notAFit,
  questions: c.questions,
  bookingType: c.meetingTitle,
  bookingWhere: c.where,
  bookingMinutes: c.availability.slotMinutes,
  timeZone: c.availability.timeZone,
  weekly: c.availability.weekly,
  facts: c.facts,
  greeting: 'Thanks for calling {business}.',
  aiDisclosure: "I'm the {business} AI assistant.",
  followUps: c.followUps, reminder24h: c.reminder24h, reminder2h: c.reminder2h, noShowRescue: c.noShowRescue,
};
