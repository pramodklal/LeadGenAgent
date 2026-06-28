# Insurance Lead Intelligence Generator (Next.js Frontend)

This project is a Next.js frontend-first solution for discovering, reviewing, storing, and querying insurance lead data.

It provides:

- A lead discovery UI (state, distance, and customer count filters)
- Server-side API routes for lead analysis and Azure AI Search persistence
- A chat assistant that answers from indexed lead data (RAG-style retrieval from Azure AI Search)

## Functional Overview

### 1) Find Potential Customers

Users can search by:

- USA state
- Distance radius (miles)
- Customer count limit (25/50/75/100)

The app returns potential customer rows with:

- Company
- Industry
- Contact details (name/title/email/phone/LinkedIn)
- Why Match explanation
- Confidence tag when available

### 2) Download Results

Users can export the current results to CSV using **Download Potential Customers**.

### 3) Add in DB (Azure AI Search)

Users can store selected lead results in Azure AI Search with **Add in DB**.

Behavior includes:

- Startup/index existence checks
- Auto-create index if missing
- Lead document upsert with deterministic IDs
- Optional assistant index enrichment content

### 4) Lead Assistant Chat

The floating chat widget allows users to ask natural language questions over indexed lead data.

Examples:

- "What is the industry of Acrisure LLC?"
- "Tell me top insurance brokers of New York"

Key behavior:

- Answers are generated from Azure AI Search matches
- If no relevant match: returns exactly `I don't have information`
- Conversation memory persists in browser localStorage
- **Clear Chat** button resets saved memory on demand

## Technical Architecture

### Frontend Stack

- Next.js 15 (App Router)
- React 19
- TypeScript
- CSS (global styles)

### Backend-for-Frontend (BFF) via Next.js Route Handlers

The frontend uses same-origin APIs in `web/app/api`:

- `POST /api/analyze`
  - Runs lead generation/analysis logic
  - Returns normalized lead list and scoring metadata

- `POST /api/leads/store`
  - Validates Azure AI Search configuration
  - Ensures primary index exists
  - Stores lead records into the configured index

- `POST /api/leads/assistant`
  - Queries Azure AI Search index
  - Builds concise response text by question type
  - Returns top matches plus synthesized answer

### UI Components

- `web/app/page.tsx`: main dashboard page and lead actions
- `web/components/FloatingChatWidget.tsx`: chat assistant with local memory and clear-chat control
- `web/app/globals.css`: page, table, controls, chat, and footer styles

## Data Model (Lead Row)

Main lead object fields used by the UI and storage layer:

- `company_name`
- `website`
- `industry`
- `why_match`
- `contact_name`
- `contact_title`
- `contact_email`
- `contact_phone`
- `contact_linkedin`
- `contact_confidence`

Stored index metadata includes:

- `state`
- `stored_at`
- `id` (derived, stable key)

## Environment Configuration

Create `web/.env.local` (based on `web/.env.local.example`) and set at minimum:

### Required for lead analysis route

- `AZURE_OPENAI_ENDPOINT`
- `AZURE_OPENAI_API_KEY`
- `AZURE_OPENAI_DEPLOYMENT_NAME`
- `AZURE_OPENAI_API_VERSION` (default is supported if omitted)

### Required for Azure AI Search store/assistant routes

- `AZURE_SEARCH_ENDPOINT`
- `AZURE_SEARCH_API_KEY`
- `AZURE_SEARCH_INDEX_NAME`

### Optional

- `AZURE_SEARCH_ASSISTANT_INDEX_NAME`
- `ALLOW_DEMO_FALLBACK`
- `HUNTER_API_KEY`
- `HUNTER_ENRICH_LIMIT`

## Local Development

```bash
cd web
npm install
npm run dev
```

Open:

`http://localhost:3000`

Useful commands:

```bash
npm run build
npm start
npx tsc --noEmit
```

## Frontend-Only Deployment (Azure App Service)

Recommended deployment for this solution:

- Azure App Service Web App
- Publish: Code
- Runtime stack: Node.js (LTS)
- OS: Linux

Basic flow:

1. Create App Service Web App.
2. Deploy the `web` application code (GitHub deployment center or zip deploy).
3. Configure app settings with your Azure OpenAI and Azure AI Search values.
4. Restart app and validate `/` and API routes.

## User Journey Summary

1. User selects state, distance, and customer count.
2. User clicks **Find Potential Customers** to load lead rows.
3. User may export CSV or click **Add in DB** to persist to Azure AI Search.
4. User asks questions in chat; assistant responds from indexed data.
5. User can clear persisted chat with **Clear Chat**.

## Notes

- The repository also contains Python assets from the original pipeline, but the active user-facing experience is the Next.js frontend in the `web` folder.
- Before sharing or deploying, ensure secrets are rotated and stored securely (for example, App Service settings/Key Vault) rather than committed files.

Deisgn & Developed by Code Insights
