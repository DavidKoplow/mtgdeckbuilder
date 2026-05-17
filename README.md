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
```

For this project:

```bash
# Local development
CONVEX_DEPLOYMENT=dev:hidden-hedgehog-85
NEXT_PUBLIC_CONVEX_URL=https://hidden-hedgehog-85.convex.cloud
NEXT_PUBLIC_BASE_PATH=

# Production builds
CONVEX_DEPLOYMENT=prod:superb-goshawk-593
NEXT_PUBLIC_CONVEX_URL=https://superb-goshawk-593.convex.cloud
NEXT_PUBLIC_BASE_PATH=/mtgdeckbuilder
```

3. Configure WorkOS AuthKit in `.env.local`:

```env
WORKOS_CLIENT_ID=client_your_client_id_here
WORKOS_API_KEY=sk_test_your_api_key_here
NEXT_PUBLIC_WORKOS_CLIENT_ID=client_your_client_id_here
NEXT_PUBLIC_WORKOS_REDIRECT_URI=http://localhost:3000/callback/
NEXT_PUBLIC_WORKOS_DEV_MODE=true
```

For GitHub Pages, configure the WorkOS app with:

- Redirect URI:
  `https://your-github-user.github.io/mtgdeckbuilder/callback/`
- Sign-in endpoint:
  `https://your-github-user.github.io/mtgdeckbuilder/login/`
- CORS origin: `https://your-github-user.github.io`

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

Convex validates WorkOS-issued JWTs in `convex/auth.config.ts`; protected Convex
functions should continue to use `ctx.auth.getUserIdentity()` and should not
trust client-provided user ids.
