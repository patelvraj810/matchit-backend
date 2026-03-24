# MATCHIT — Project Context

## What Is Matchit
Two-sided AI platform for service businesses.
Domain: matchit.ai
Side 1 — Matchit for Business: service businesses subscribe ($49-499/mo), AI handles leads, booking, WhatsApp, invoicing, team management, reminders, follow-ups
Side 2 — Matchit Find: customers post urgent requests, AI matches them to available businesses
One brand, two dashboards. Think Airbnb host/traveller model.
Target market: HVAC, plumbing, electrical, cleaning, landscaping in GTA Canada

## Codebase Locations
Frontend: /Users/vraj/.gemini/antigravity/scratch/leadclaw-app/
Backend: ~/leadclaw-backend/
OpenClaw workspace: ~/.openclaw/workspace/matchit/

## Tech Stack
Frontend: React 19 + Vite 8 + React Router v7
Backend: Node.js + Express 5 (CommonJS)
Database: Supabase (Postgres) with Row Level Security
AI: Gemini Flash-Lite (`@google/generative-ai`)
Email: Resend
WhatsApp: Meta Cloud API (main) + Twilio (Find endpoint)
Payments: Stripe
Booking: Cal.com
Scheduling: node-cron
Deploy: Vercel (frontend) + Railway (backend)

## What Is Built

### Frontend — src/pages/
- `Landing.jsx` — Marketing landing page with hero, stats, feature cards — NEEDS TESTING
- `Login.jsx` — Login form (email + password) — NEEDS TESTING
- `Signup.jsx` — Signup form (name, email, password, businessName, industry) — NEEDS TESTING
- `Onboarding.jsx` — Post-signup onboarding flow (currently redirects to /signup) — NEEDS TESTING
- `Dashboard.jsx` — Main dashboard with KPI stats from /api/stats — NEEDS TESTING
- `Leads.jsx` — Lead list from /api/leads — NEEDS TESTING
- `Conversations.jsx` — Conversation inbox from /api/conversations — NEEDS TESTING
- `Analytics.jsx` — Analytics view — NEEDS TESTING
- `AgentSetup.jsx` — AI agent configuration (name, tone, services) — NEEDS TESTING
- `Integrations.jsx` — Integrations management — NEEDS TESTING
- `Sources.jsx` — Lead source management — NEEDS TESTING
- `Campaigns.jsx` — Campaign management — NEEDS TESTING
- `Find.jsx` — Public Matchit Find form (customer service requests, no auth) — NEEDS TESTING

### Frontend — src/components/
- `Layout.jsx` — App shell wrapping sidebar + outlet (protected routes) — NEEDS TESTING
- `ProtectedRoute.jsx` — JWT auth guard, redirects to /login if no token — NEEDS TESTING
- `Sidebar.jsx` — Navigation sidebar with all app links — NEEDS TESTING
- `Topbar.jsx` — Top navigation bar — NEEDS TESTING
- `ui/Button.jsx` — Reusable button component — WORKING
- `ui/Card.jsx` — Reusable card container — WORKING
- `ui/KpiCard.jsx` — Dashboard KPI metric card — WORKING
- `ui/Tag.jsx` — Status tag/badge component — WORKING

### Frontend — src/context/ and src/lib/
- `context/AuthContext.jsx` — JWT auth state, login/logout, token persistence in localStorage — NEEDS TESTING
- `lib/api.js` — API client with auth header injection — NEEDS TESTING
- `lib/auth.js` — Auth helper functions — NEEDS TESTING
- `lib/conversations.js` — Conversations API helpers — NEEDS TESTING

### Backend — src/routes/
- `routes/auth.js` — /auth/* (signup, login, me, logout) — NEEDS TESTING
- `routes/webhook.js` — POST /webhook/inbound (external lead intake) — NEEDS TESTING
- `routes/whatsapp.js` — GET/POST /webhook/whatsapp (Meta Cloud API handler) — NEEDS TESTING
- `routes/invoices.js` — /api/invoices CRUD + /api/invoices/:id/send — NEEDS TESTING

### Backend — src/services/
- `services/pipeline.js` — Lead processing and AI response pipeline — NEEDS TESTING
- `services/reminders.js` — Appointment reminder cron jobs (24h, 2h, 30min before job via WhatsApp) — NEEDS TESTING
- `services/morningBriefing.js` — Daily 7am WhatsApp briefing to owner — NEEDS TESTING
- `services/endOfDaySummary.js` — Daily 6pm WhatsApp summary to owner — NEEDS TESTING
- `services/invoices.js` — Invoice generation + Stripe payment link creation — NEEDS TESTING

### Backend — src/lib/ and src/middleware/
- `lib/db.js` — Supabase client singleton — NEEDS TESTING
- `lib/ai.js` — Gemini Flash-Lite API client — NEEDS TESTING
- `lib/auth.js` — JWT token generation + bcryptjs password hashing — NEEDS TESTING
- `lib/email.js` — Resend email client — NEEDS TESTING
- `lib/stripe.js` — Stripe client for payment links — NEEDS TESTING
- `lib/systemPrompt.js` — AI system prompt builder for agent personality — NEEDS TESTING
- `lib/whatsapp.js` — Meta Cloud API message sender — NEEDS TESTING
- `middleware/authenticate.js` — JWT verification middleware — NEEDS TESTING

### Database Migrations
- `migrations/001_create_schema.sql` — Core schema: users, agents, leads, conversations, messages — WORKING
- `src/services/createInvoicesTable.sql` — Invoices table with RLS policies — WORKING
- `src/services/createRemindersTable.sql` — Reminders table (⚠️ references bookings table not yet created) — NEEDS TESTING

## API Endpoints

### Auth (`src/routes/auth.js`)
- `POST /auth/signup` — Creates Supabase auth user + users row + agents row, returns JWT
- `POST /auth/login` — Supabase signInWithPassword, returns JWT + user profile
- `GET /auth/me` — Returns current user profile (protected)
- `POST /auth/logout` — Client-side only, returns success

### Webhook (`src/routes/webhook.js`)
- `POST /webhook/inbound` — Receives lead from external form `{name, email, phone, service, source, message}`, fires pipeline async

### WhatsApp (`src/routes/whatsapp.js` mounted at `/webhook`)
- `GET /webhook/whatsapp` — Meta webhook verification (hub.verify_token check)
- `POST /webhook/whatsapp` — Receive incoming WhatsApp messages, process via pipeline async

### Invoices (`src/routes/invoices.js`)
- `GET /api/invoices` — List all invoices (protected, supports ?status, ?from_date, ?to_date)
- `POST /api/invoices` — Create invoice `{lead_id, job_description, line_items, subtotal, tax_rate, due_date}` (protected)
- `GET /api/invoices/:id` — Get single invoice with lead + user join (protected)
- `POST /api/invoices/:id/send` — Send invoice via WhatsApp + generate Stripe payment link (protected)

### Inline in `src/index.js`
- `GET /` — Health check, returns `{status: 'ok', service: 'leadclaw-backend'}`
- `GET /api/leads` — All leads for user ordered by created_at desc (protected)
- `GET /api/conversations` — All conversations with leads join + last message (protected)
- `GET /api/stats` — Dashboard stats: leadsToday, qualified, thisMonth, totalConversations (protected)
- `GET /api/messages/:conversationId` — Messages for a conversation, verifies ownership (protected)
- `POST /api/find/request` — Public service request form `{category, urgency, description, whatsapp}`, saves to service_requests table, sends WhatsApp to customer + owner via Twilio

## Database Tables

### users
`id` (UUID PK), `email` (unique), `name`, `created_at`

### agents
`id` (UUID PK), `user_id` (FK → users), `name`, `business_name`, `services` (TEXT[]), `service_area`, `tone` (default: professional), `created_at`

### leads
`id` (UUID PK), `user_id` (FK → users), `contact_name`, `contact_email`, `contact_phone`, `source`, `source_detail`, `message`, `qualification_status` (default: pending), `last_contact_at`, `created_at`
⚠️ Note: migration uses `contact_name` but some code queries `customer_name` — verify actual column name in Supabase

### conversations
`id` (UUID PK), `user_id` (FK → users), `lead_id` (FK → leads), `agent_id` (FK → agents), `channel` (default: web), `status` (default: active), `created_at`

### messages
`id` (UUID PK), `user_id` (FK → users), `conversation_id` (FK → conversations), `lead_id` (FK → leads), `direction`, `sender_type`, `sender_name`, `content`, `channel` (default: web), `status` (default: sent), `created_at`

### invoices
`id` (UUID PK), `user_id` (FK → auth.users), `lead_id` (FK → leads), `job_description`, `line_items` (JSONB), `subtotal`, `tax_rate` (default: 0.13), `tax_amount`, `total`, `status` (draft/sent/unpaid/paid/overdue/cancelled), `stripe_payment_link`, `stripe_payment_intent_id`, `sent_at`, `paid_at`, `due_date`, `first_reminder_at`, `second_reminder_at`, `owner_alerted_at`, `created_at`, `updated_at`

### reminders
`id` (UUID PK), `booking_id` (FK → bookings — ⚠️ bookings table not yet created), `customer_phone`, `customer_name`, `owner_phone`, `type` (24h/2h/30min), `message`, `scheduled_for`, `status` (pending/sent/failed/cancelled), `sent_at`, `created_at`

### service_requests (used in /api/find/request — no migration file found)
`id`, `category`, `urgency`, `description`, `contact_phone`, `status` (default: new)

## Environment Variables Needed

### Backend (`~/leadclaw-backend/.env`) — key names only:
```
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_KEY=
GEMINI_API_KEY=
RESEND_API_KEY=
STRIPE_PUBLISHABLE_KEY=
STRIPE_SECRET_KEY=
CAL_API_KEY=
WHATSAPP_TOKEN=
WHATSAPP_PHONE_ID=
WHATSAPP_VERIFY_TOKEN=
JWT_SECRET=
JWT_EXPIRES_IN=
```

⚠️ These keys are used in code but NOT found in .env — must be added for Find + reminders to work:
```
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_WHATSAPP_NUMBER=
OWNER_WHATSAPP=
PORT=
```

### Frontend (`src/.env.local`)
```
VITE_API_URL=http://localhost:3000
```

## Known Issues / Gaps
1. **TWILIO keys missing from .env** — `/api/find/request` and owner notifications will fail silently
2. **`bookings` table doesn't exist** — `reminders` table has FK to `bookings(id)`, will fail until bookings table is created or FK is removed
3. **`service_requests` table has no migration** — needs to be created before Find endpoint works
4. **`contact_name` vs `customer_name`** — leads migration uses `contact_name`, invoices route queries `customer_name` — verify actual Supabase column
5. **Health check still says "leadclaw-backend"** — `GET /` returns `service: 'leadclaw-backend'` — should be updated to Matchit

## What Needs To Be Built Next (in order)
1. Test auth end to end — signup at localhost:5173, confirm token saved, dashboard loads with real user data
2. Appointment reminders — 24h, 2h, 30min before job via WhatsApp using node-cron
3. Morning briefing — 7am daily WhatsApp to owner with jobs, leads, follow-ups
4. End of day summary — 6pm daily WhatsApp to owner
5. Invoice system — generate after job, send Stripe payment link via WhatsApp, auto follow-up if unpaid
6. Quote follow-up sequences — Day 2, 5, 10 after quote sent
7. Matchit Find page — /find route, public, service request form, AI responds via WhatsApp
8. Team features — team accounts, job assignment, employee briefings, field tech WhatsApp interface
9. RAG document upload — business uploads price list, AI learns from it
10. Owner back-channel — owner texts agent to reschedule, message customers, check stats

## Branding Rules
- Product name: Matchit (capital M)
- Domain: matchit.ai
- **Never say LeadClaw anywhere in UI** — replace all instances with Matchit
- Tagline: "Your service business, fully automated."
- Footer: "© 2026 Matchit · matchit.ai"
- Logo font: Clash Display bold
- Green dot next to logo (blink animation)

## Design System (from src/index.css)
```css
--bg: #fafaf8
--surface: #fff
--surface2: #f4f4f0
--surface3: #eeeee8
--text: #111110
--text2: #6b6b66
--text3: #a8a8a0
--green: #16a34a  /* primary action */
--blue: #2563eb
--purple: #7c3aed
--amber: #d97706
--red: #dc2626
--r: 10px
--rl: 16px
--rxl: 24px
```
Fonts: Satoshi (body), Clash Display (h1-h4 + logo), JetBrains Mono (mono/badge)
Animations: fadeUp, blink (logo dot), bounce, pulse

Design rules:
- Never show fake or mock data — empty state instead
- Mobile first — sidebar slides in on mobile
- Green is the primary action colour
- Clean minimal warm off-white background (#fafaf8)

## How To Run Locally
Terminal 1 — Backend:
```
cd ~/leadclaw-backend && node src/index.js
```
Runs on http://localhost:3000

Terminal 2 — Frontend:
```
cd /Users/vraj/.gemini/antigravity/scratch/leadclaw-app && npm run dev
```
Runs on http://localhost:5173

## Owner
Vraj Patel — Brampton, Ontario, Canada
Building Matchit as a side project while working at Oanda (IT Support)
Goal: 10 paying customers in 60 days then raise pre-seed funding
OpenClaw multi-agent team (Eleven, Nova, Max, Steve, Robin, Dustin, Will, Lucas, Mike) handles autonomous building

## Instructions For Any AI Reading This File
- Read this file first before making any changes
- Check actual files before assuming something is built
- Never add mock or fake data
- Never change the design system colours or fonts
- Always replace LeadClaw with Matchit if found in UI
- Run both servers before testing anything
- When in doubt about what is built, read the actual source files
