This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
# mtgdeckbuilder

## WorkOS AuthKit and cloud decks

This app uses the client-side WorkOS AuthKit React SDK for sign-in, Convex JWT
auth for authenticated backend requests, and Convex tables for cloud deck
storage. The Next app is configured for static export so it can be hosted on
GitHub Pages.

1. Create or connect a Convex project:

```bash
npx convex dev
```

2. Add the generated deployment URL to `.env.local`:

```bash
CONVEX_DEPLOYMENT=dev:your-deployment-name
NEXT_PUBLIC_CONVEX_URL=https://your-deployment.convex.cloud
NEXT_PUBLIC_BASE_PATH=
NEXT_PUBLIC_MAGE_GATEWAY_URL=http://127.0.0.1:17888
```

For this project:

```bash
# Local development
CONVEX_DEPLOYMENT=dev:hidden-hedgehog-85
NEXT_PUBLIC_CONVEX_URL=https://hidden-hedgehog-85.convex.cloud
NEXT_PUBLIC_BASE_PATH=
NEXT_PUBLIC_MAGE_GATEWAY_URL=http://127.0.0.1:17888

# Production builds
CONVEX_DEPLOYMENT=dev:hidden-hedgehog-85
NEXT_PUBLIC_CONVEX_URL=https://hidden-hedgehog-85.convex.cloud
NEXT_PUBLIC_BASE_PATH=
NEXT_PUBLIC_MAGE_GATEWAY_URL=https://your-mage-gateway.example.com
```

`NEXT_PUBLIC_MAGE_GATEWAY_URL` should point at the MAGE web gateway wrapper. For
local development this is usually `http://127.0.0.1:17888`; for GitHub Pages it
must be the HTTPS Cloud Run service URL. The root `Dockerfile` is the Cloud Run
entrypoint. It uses `mage/` as an untouched upstream clone, copies the custom
gateway from `webgateway/Mage.WebGateway` only inside the Docker build stage,
and starts with `docker/mage-entrypoint.sh`. The container listens on the Cloud
Run `PORT` when present and otherwise falls back to `17888`.

The gateway does not use permanent storage. AI play keeps the live MAGE session
in container memory, while browser commands include the latest client-side game
view/prompt snapshot and reconnect/history responses include the latest full
state event when it is still available. Public-server gateway play continues to
use the selected public MAGE server and does not require persistent disk.
The Cloud Run workflow starts the bundled local MAGE server by default for AI
play (`MAGE_LOCAL_AI_SERVER=true`); human games can still select the public
MAGE servers through the gateway.

For push deploys, configure these GitHub repository variables/secrets:

- `NEXT_PUBLIC_MAGE_GATEWAY_URL`: HTTPS URL of the Cloud Run service.
- `NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_WORKOS_CLIENT_ID`,
  `NEXT_PUBLIC_WORKOS_REDIRECT_URI`, and optional `NEXT_PUBLIC_BASE_PATH`.
- `GCP_PROJECT_ID`, `GCP_REGION`, `CLOUD_RUN_SERVICE`, and
  `ARTIFACT_REGISTRY_REPOSITORY`. The workflow defaults Cloud Run memory to
  `1536Mi`; override `CLOUD_RUN_MEMORY` only if you intentionally change the JVM
  heap budget.
- Secrets `GCP_WORKLOAD_IDENTITY_PROVIDER` and `GCP_SERVICE_ACCOUNT`.

3. Configure WorkOS AuthKit in `.env.local`:

```env
WORKOS_CLIENT_ID=client_your_client_id_here
WORKOS_API_KEY=sk_test_your_api_key_here
NEXT_PUBLIC_WORKOS_CLIENT_ID=client_your_client_id_here
NEXT_PUBLIC_WORKOS_REDIRECT_URI=http://localhost:3000/callback/
NEXT_PUBLIC_WORKOS_DEV_MODE=true
```

For GitHub Pages, configure the WorkOS app with:

- Redirect URI: `https://magicaldeckgatherer.com/callback/`
- Sign-in endpoint: `https://magicaldeckgatherer.com/login/`
- CORS origin: `https://magicaldeckgatherer.com`

If you deploy under the repository URL instead of the custom domain, set
`NEXT_PUBLIC_BASE_PATH=/mtgdeckbuilder` and use
`https://davidkoplow.github.io/mtgdeckbuilder/callback/` as the WorkOS redirect
URI.

Set `NEXT_PUBLIC_WORKOS_API_HOSTNAME` if you configure a custom WorkOS
authentication domain. Without one, `NEXT_PUBLIC_WORKOS_DEV_MODE=true` stores
the browser refresh token in `localStorage`, which is the static-host fallback.

4. Sync WorkOS credentials and auth config to Convex:

```bash
npx convex env set WORKOS_CLIENT_ID <your-workos-client-id>
npx convex env set WORKOS_API_KEY <your-workos-api-key>
npx convex dev
```

The local WorkOS development redirect URI is `http://localhost:3000/callback/`.
`convex.json` configures that redirect URI, the app homepage, and CORS origin
for local development.

Decks are stored in `userDecks`, keyed by authenticated WorkOS subject. Each
deck document stores a compact `cards` list of `{ cardKey, quantity }`, where
`cardKey` is validated as a uint24-range integer and `quantity` is validated as
a uint8-range integer. Card display metadata is normalized into the shared
`cards` catalog table and keyed back to Scryfall ids.

## Official MTGJSON decks

Official deck imports use MTGJSON `DeckList.json` plus the individual deck
files under `https://mtgjson.com/api/v5/decks/`. The import is protected by a
shared token that must be present in both the shell running the script and the
Convex deployment:

```bash
npx convex env set MTGJSON_IMPORT_TOKEN <long-random-token>
MTGJSON_IMPORT_TOKEN=<long-random-token> npm run decks:import-mtgjson
```

The importer upserts public decks under the synthetic `official:mtgjson` user
and leaves user-owned decks untouched. It stores MTGJSON metadata such as deck
code, file name, type, source URL, release date, data version, sealed product
UUIDs, and the display author.

Convex validates WorkOS-issued JWTs in `convex/auth.config.ts`; protected Convex
functions should continue to use `ctx.auth.getUserIdentity()` and should not
trust client-provided user ids.
