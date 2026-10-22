# Ad Creative Generator

A beautiful, modern Ad Creative Generator built with Next.js 16 (App Router), React 19, and Tailwind CSS. It showcases a generated ad creative for **Arena Ad Creative** — Instagram platform, professional tone, "Try Now Free" CTA — with PNG export and dark/light mode.

## Features

- Polished branded header with logo and dark/light mode toggle
- Instagram-styled ad card: headline, body copy, hashtags, and CTA button
- Full-width AI-generated ad visual (1:1 feed format)
- Platform badge chip (Instagram gradient)
- "Why it works" strategy breakdown section
- Export the ad card as a PNG via html2canvas
- Export events logged to Postgres (Prisma + Neon)
- Responsive, mobile-first design

## Tech Stack

- Next.js 16.2.12 (App Router) + React 19
- Tailwind CSS 3
- Prisma + Neon Postgres
- html2canvas, lucide-react

## Local Setup

1. Copy `.env.example` to `.env` and set `DATABASE_URL` to a Postgres connection string.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run the dev server:
   ```bash
   npm run dev
   ```
4. Open http://localhost:3000

## Build & Deploy

```bash
npm run build
```

The build script runs `prisma generate && prisma db push && next build`. On Vercel, connect a Neon database — `DATABASE_URL` is injected automatically.
