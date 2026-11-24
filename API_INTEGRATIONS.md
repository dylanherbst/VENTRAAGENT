# API integrations

| Provider | Used for | Status | Env |
|---|---|---|---|
| Anthropic Claude | All agent writing, AI Sales replies, onboarding drafts | Live (key in local env) | `ANTHROPIC_API_KEY`, `MARKETING_TEXT_MODEL`, `SETTER_MODEL` |
| OpenAI | Optional text; images | Adapter built; key and model needed | `OPENAI_API_KEY`, `OPENAI_TEXT_MODEL`, `OPENAI_IMAGE_MODEL` |
| Creatomate | Reels and branded statics | Adapter built; templates needed | `CREATOMATE_API_KEY`, `CREATOMATE_REEL_TEMPLATE_ID`, `CREATOMATE_STATIC_TEMPLATE_ID` |
| Zernio | Connect Instagram and Facebook, schedule, status webhooks | Adapter built (scheduling field names unverified) | `ZERNIO_API_KEY`, `ZERNIO_WEBHOOK_SECRET`, `SOCIAL_PUBLISHING_ENABLED` |
| Instagram Login and Graph (Meta) | AI Sales DMs | Built; needs Meta app review | `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, `INSTAGRAM_REDIRECT_URI`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, `SETTER_TOKEN_KEY`, `SETTER_CLICK_SECRET`, `SETTER_STATE_SECRET`, `SETTER_LIVE_SEND` |
| Stripe | Subscriptions (tiers) | Test key verified; products not created | `STRIPE_SECRET_KEY`, webhook secret |
| Resend | Emails and notifications | Key verified (send-only) | `RESEND_API_KEY` |
| Supabase | Auth, database, storage | Needs a NEW project for Growth | `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_*` |
| Public website reader | Onboarding auto-fill | Live (https only, public addresses only, 6 s, 600 KB) | none |

## Not supported yet (shown as "Not yet" in onboarding)

WhatsApp, Google Business Profile, Meta ad accounts, booking systems, LinkedIn and TikTok publishing.
