// Gym template for the AI Setter and Receptionist. A starting point the gym edits in /tools/front-office-settings.
// Deliberately empty: prices, hours, class times and FAQ answers. Only the gym can state those; until it does, the AI
// says a person will confirm and takes a message.
import type { QualificationQuestion } from '../setter/config';

export const gymQuestions: QualificationQuestion[] = [
  { id: 'goal', ask: 'What they want to achieve (for example get fitter, lose weight, build strength, train for an event)', required: true },
  { id: 'experience', ask: 'How much training they have done before, and any injuries the coach should know about', required: true },
  { id: 'preferred_times', ask: 'Which days and times suit them to train', required: true },
  { id: 'start_timeframe', ask: 'How soon they want to start', required: true },
  { id: 'membership_interest', ask: 'What kind of membership or training they are interested in (for example open gym, classes, personal training)', required: false },
];

export const gymTemplate = {
  offer: 'A free trial session or a tour of the gym, so new members can see if it suits them before joining.',
  idealCustomer: 'Local people who want to start training and can get to the gym.',
  notAFit: 'People who live too far away to train here, job seekers, sales pitches and spam.',
  bookingType: 'Free trial session or tour',
  bookingWhere: 'at the gym',
  bookingMinutes: 45,
  greeting: 'Thanks for calling {business}.',
  aiDisclosure: "I'm the {business} AI assistant.",
  followUps: [
    'Hi {name}, just checking you saw my last message. Happy to find a trial time that suits.',
    'Hi {name}, still keen to come in for a trial session? I can book you in.',
    'Hi {name}, it is {business}. Want me to hold a spot for you this week?',
    'Hi {name}, last nudge from me this week. Reply with a day that suits and I will sort the rest.',
    'Hi {name}, it is {business}. If you are still thinking about starting, reply and I will find you a time.',
  ],
  reminder24h: 'Hi {name}, reminder: your {meeting} is tomorrow at {time}. Reply here if you need to change it.',
  reminder2h: 'Hi {name}, see you at {time} for your {meeting}. Reply here if something has come up.',
  noShowRescue: [
    'Hi {name}, sorry we missed you today. Want to pick a new time for your trial?',
    'Hi {name}, happy to rebook your trial whenever suits. Just reply with a day.',
  ],
};
