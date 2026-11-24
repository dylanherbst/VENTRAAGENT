# VENTRA roadmap: from today to launch and first revenue

Source for the Agent Dashboard "Roadmap" page. Checked 2026-11-03.

- **Feature steps** (Status = `auto`): their status is computed live from `FEATURES.md` by matching the `Match` text against each feature's "Module · Feature". Done = every matched feature is Working. In progress = at least one is Working or a Local draft. Blocked = blocked with nothing built yet. Otherwise Not started.
- **Launch steps** (explicit Status): things that are not product features but must happen before real customers pay. Statuses here are maintained by hand with a reason; nothing is marked Done without evidence.

| Stage | Step | Match | Status | Needs | Detail |
| --- | --- | --- | --- | --- | --- |
| 1 Foundation | Sign up, routes and onboarding | Sign up, sign in;Three customer routes;Personalised onboarding;Account data saving;Isolated test pages | auto | | Customers can create an account, pick a route and keep their data |
| 1 Foundation | Course Creator | Course Creator;Course saved;Learner preview | auto | | Create, edit, save to account, preview a course |
| 1 Foundation | Business Launcher | Business Launcher | auto | | Skill, market, offer, pricing, brand and plan drafts saved to the account |
| 2 Create something to sell | Services and offers | Services · | auto | | Offers, proposals, agreements, invoices, client portal, projects |
| 2 Create something to sell | Website and storefront | Website and store | auto | | Pages, storefront, link-in-bio, then publishing |
| 2 Create something to sell | Course extras | Lesson quizzes;Certificates;Course sales page;Coaching program;Video lessons;Student portal | auto | | Quizzes, certificates, sales page, student portal |
| 3 Get paid | Test-mode checkout | Test-mode Stripe checkout | auto | Stripe TEST key from the owner | Take a test payment end to end |
| 3 Get paid | Payment webhook and orders | Payment webhook | auto | Signing secret and the owner's decision on a permanent orders table | Record paid orders safely |
| 4 Manage customers | CRM contacts and pipeline | Contacts;Sales pipeline | auto | Owner applies the CRM migration | Customer records and deals saved to the account |
| 4 Manage customers | Bookings and inbox | Appointments;Unified inbox;Booking pages;Lead qualification | auto | A calendar and email provider account | Take bookings, see messages |
| 5 Grow | Lead generation | Growth · | auto | AI provider key and consent rules | Lead forms, growth plan, outreach drafts, setter |
| 5 Grow | Content and marketing | Content Studio;Marketing | auto | AI provider key and an email provider | Posts, ads, email campaigns, funnels |
| 5 Grow | AI voice receptionist | Voice Receptionist | auto | A phone and voice provider account | Answer calls and book appointments |
| 5 Grow | AI generation features | AI course generation;AI business idea;AI website generation | auto | A paid AI API key (not covered by a Claude subscription) | Course, idea and site generation |
| 6 Scale | Automation and analytics | Automation;Analytics | auto | Connected payment and lead data | Workflow builder, revenue and conversion insights |
| 6 Scale | Teams, billing and memberships | Teams, permissions;Subscriptions and billing;Memberships | auto | Decisions on pricing and plans | Team roles, VENTRA's own subscriptions |
| 7 Launch gates | All checks pass on a release commit | | In progress | | `ventra-verify` passes on the current branch; needs a final run on the release commit |
| 7 Launch gates | GitHub remote and branch protection | | Blocked | GitHub Pro or a separate dev repository, owner decision | No remote is approved; branch protection is unavailable on the free plan |
| 7 Launch gates | Security review of sign-in, data access and payments | | Not started | | Independent review before real money moves |
| 7 Launch gates | Production database | | Not started | Owner approval for a new production Supabase project and migrations | Separate from the local test database |
| 7 Launch gates | Production hosting and domain | | Not started | Owner approval, a domain, a hosting account | Deploy only through the approval gate |
| 7 Launch gates | Transactional email | | Not started | An email provider account | Sign-up confirmations, receipts |
| 7 Launch gates | Terms, privacy policy and refund policy | | Not started | Owner, ideally a lawyer | Needed before taking payments |
| 7 Launch gates | Monitoring and error reporting | | Not started | Sentry or similar account | See failures in production |
| 7 Launch gates | Live payments switched on | | Not started | Owner approval; live Stripe keys entered by the owner only | Never done by an agent |
| 7 Launch gates | Soft launch with first users | | Not started | All gates above | Small invited group |
| 7 Launch gates | First paying customer | | Not started | Live payments, soft launch | The point where VENTRA makes money |
