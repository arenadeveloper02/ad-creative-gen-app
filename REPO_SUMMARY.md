# Repository Summary: Ad Creative Generator

> Auto-maintained by Sim Development. Last updated: 2026-10-22T09:54:38.720Z.

## Overview

A polished, modern Ad Creative Generator built with Next.js 16 App Router, React 19, and Tailwind CSS. Displays AI-generated ad copy and visuals for Arena Ad Creative (Instagram, Professional tone) with PNG export via html2canvas, dark/light mode, and export analytics logged to Neon Postgres via Prisma.

**Repository:** `ad-creative-generator`  
**File count:** 25

## Features

- Polished branded header with Ad Creative Generator logo
- Instagram-styled ad card with Headline, Body Copy, and CTA button
- Full-width generated ad visual rendered inside the card
- Platform Badge chip (Instagram)
- 'Why it works' breakdown section with insight cards
- Export card as PNG using html2canvas
- Export events logged to Postgres via Prisma server action
- Responsive, mobile-first design
- Dark/light mode toggle (class-based, no localStorage)

## Tech Stack

- Next.js 16.2.12 (App Router)
- React 19.0.0
- Tailwind CSS v3
- TypeScript
- Prisma + PostgreSQL (Neon on Vercel)

## Infrastructure

- **DATABASE_URL:** set on Vercel when Neon is connected — do not commit real credentials

## Routes & Pages

- `/` — `app/page.tsx`

## Database Models

- `ExportLog`

## Prisma Schema — STRICT: NEVER DROP OR DELETE COLUMNS

This section is binding on every edit. Vercel deploy runs `prisma db push` with **NO** `--accept-data-loss`. Dropping or altering a live column **fails the deploy**.

**FORBIDDEN (non-negotiable):**
- Do **not** delete, drop, omit, rename, or retype ANY existing column in `prisma/schema.prisma`
- Do **not** drop models or tables
- Do **not** "clean up", "simplify", or regenerate the schema from memory or from this summary
- Do **not** remove `createdAt` / `updatedAt` (or any other listed field) even if the UI no longer uses it

**ALLOWED:**
- ADD new models, columns, relations, or enums only
- New columns on existing models MUST be optional (`?`) or have `@default(...)`
- If the UI no longer needs a field, stop reading it in code — leave the column in the schema unchanged

**Immutable columns (must remain identical — same name, same type):**

- `ExportLog`: `id String`, `platform String`, `product String`, `createdAt DateTime`, `updatedAt DateTime`

## File Inventory

### App pages

- `app/error.tsx`
- `app/globals.css`
- `app/layout.tsx`
- `app/not-found.tsx`
- `app/page.tsx`

### Components

- `components/AdCard.tsx`
- `components/AdGeneratorClient.tsx`
- `components/Header.tsx`
- `components/PlatformBadge.tsx`
- `components/WhyItWorks.tsx`

### Libraries

- `lib/actions.ts`
- `lib/adData.ts`
- `lib/prisma.ts`
- `lib/types.ts`
- `prisma/schema.prisma`

### Config

- `.env.example`
- `.gitignore`
- `next-env.d.ts`
- `next.config.ts`
- `package.json`
- `postcss.config.mjs`
- `tailwind.config.ts`
- `tsconfig.json`

### Other

- `README.md`
- `REPO_SUMMARY.md`

## Complete File Index

- `.env.example`
- `.gitignore`
- `README.md`
- `REPO_SUMMARY.md`
- `app/error.tsx`
- `app/globals.css`
- `app/layout.tsx`
- `app/not-found.tsx`
- `app/page.tsx`
- `components/AdCard.tsx`
- `components/AdGeneratorClient.tsx`
- `components/Header.tsx`
- `components/PlatformBadge.tsx`
- `components/WhyItWorks.tsx`
- `lib/actions.ts`
- `lib/adData.ts`
- `lib/prisma.ts`
- `lib/types.ts`
- `next-env.d.ts`
- `next.config.ts`
- `package.json`
- `postcss.config.mjs`
- `prisma/schema.prisma`
- `tailwind.config.ts`
- `tsconfig.json`

## Latest Change

- **Updated at:** 2026-10-22T09:54:38.720Z
- **Request:** Build a beautiful, modern Ad Creative Generator web app using React + Tailwind CSS. Deploy it to Vercel as a public repo.

The app must display the following ad creative output:

AD COPY & IMAGE:
<Ad Copy & Image Agent.content>

Product: "Arena Ad Creative"
Platform: "Instagram"
Tone: "Professional"
CTA: "Try Now Free"

App features:
1. A polished header with 'Ad Creative Generator' branding
2. A card showing the Headline, Body Copy, and CTA button styled for the target platform
3. The generated ad image displayed full-width in the card
4. A 'Platform Badge' chip (e.g. Instagram, LinkedIn)
5. A 'Why it works' section at the bottom
6. Export button (downloads card as PNG using html2canvas)
7. Responsive, mobile-first design
8. Dark/light mode toggle

Use the ad copy and image URL extracted from the agent output above. Make it pixel-perfect and production-ready.
