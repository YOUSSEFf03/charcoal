# Charcoal Accounting System — Setup Guide

> Follow this guide in order. Every step depends on the previous one.
> Stack: Next.js 14 + React Native (Expo) + PostgreSQL (Railway) + Clerk (auth) + Prisma (ORM)
> Monorepo managed by Turborepo.

---

## Prerequisites

Before starting, install the following on your machine:

- **Node.js 20+** — https://nodejs.org (download LTS version)
- **Git** — https://git-scm.com
- **VS Code** or **Cursor** — https://cursor.sh (recommended for AI-assisted development)
- A **GitHub account** — https://github.com
- A **Railway account** — https://railway.app
- A **Clerk account** — https://clerk.com
- An **Expo account** — https://expo.dev (for mobile app)

Verify Node and Git are installed:
```bash
node --version    # should print v20.x.x or higher
git --version     # should print git version x.x.x
```

---

## Step 1 — Create Railway Project + Database

Railway hosts your Next.js app and your PostgreSQL database.

### 1.1 Create a new Railway project

1. Go to https://railway.app and log in
2. Click **New Project**
3. Select **Empty Project**
4. Name it `charcoal-system`

### 1.2 Add a PostgreSQL database

1. Inside your Railway project, click **+ New**
2. Select **Database → PostgreSQL**
3. Wait for it to provision (about 30 seconds)
4. Click on the PostgreSQL service → **Variables** tab
5. Copy the `DATABASE_URL` value — you will need it in Step 4

It looks like this:
```
postgresql://postgres:PASSWORD@HOST:PORT/railway
```

---

## Step 2 — Create a Clerk Application

Clerk handles all authentication and user roles.

### 2.1 Create the application

1. Go to https://clerk.com and log in
2. Click **Add application**
3. Name it `Charcoal System`
4. Select sign-in methods: **Email + Password** only (no social login needed)
5. Click **Create application**

### 2.2 Copy your API keys

From the Clerk dashboard → **API Keys**:
- Copy `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- Copy `CLERK_SECRET_KEY`

Save both — you will need them in Step 4.

### 2.3 Set up roles in Clerk

Clerk stores roles as metadata on each user. You will assign roles manually for now and automate later.

Roles used in this system:
```
owner
accountant
sales_rep
worker
driver
```

You do not need to configure anything in Clerk for this yet — roles are set in Step 7.

---

## Step 3 — Scaffold the Monorepo

A monorepo keeps the web app, mobile app, and shared code in one repository.

### 3.1 Create the project

Open your terminal and run:

```bash
npx create-turbo@latest charcoal-system
cd charcoal-system
```

When prompted:
- Package manager: **npm**
- Select the default template

### 3.2 Clean up the default template

The default Turborepo template includes example apps. Remove them:

```bash
rm -rf apps/docs
rm -rf apps/web
```

### 3.3 Create the web app

```bash
cd apps
npx create-next-app@latest web --typescript --tailwind --eslint --app --src-dir --import-alias "@/*"
cd ..
```

### 3.4 Create the mobile app

```bash
cd apps
npx create-expo-app mobile --template blank-typescript
cd ..
```

### 3.5 Create shared packages

```bash
mkdir -p packages/database
mkdir -p packages/shared
```

Your folder structure should now look like this:

```
charcoal-system/
├── apps/
│   ├── web/          ← Next.js web app
│   └── mobile/       ← React Native + Expo
├── packages/
│   ├── database/     ← Prisma schema
│   └── shared/       ← Shared types and formulas
├── package.json
└── turbo.json
```

### 3.6 Push to GitHub

```bash
git init
git add .
git commit -m "initial scaffold"
gh repo create charcoal-system --private --push --source=.
```

> If you don't have the GitHub CLI (`gh`), create the repo manually on github.com and follow the push instructions.

---

## Step 4 — Environment Variables

### 4.1 Web app environment file

Create `apps/web/.env.local`:

```env
# Database
DATABASE_URL="postgresql://postgres:PASSWORD@HOST:PORT/railway"

# Clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="pk_test_..."
CLERK_SECRET_KEY="sk_test_..."

# Clerk redirect URLs
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/dashboard
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/dashboard
```

Replace the `DATABASE_URL` with the value you copied from Railway in Step 1.2.
Replace the Clerk keys with the values you copied in Step 2.2.

### 4.2 Mobile app environment file

Create `apps/mobile/.env`:

```env
EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY="pk_test_..."
EXPO_PUBLIC_API_URL="http://localhost:3000"
```

> In production, replace `http://localhost:3000` with your Railway deployment URL.

---

## Step 5 — Set Up Prisma

Prisma is the ORM. It connects to PostgreSQL and generates TypeScript types for all 18 entities.

### 5.1 Install Prisma in the database package

```bash
cd packages/database
npm init -y
npm install prisma @prisma/client
npx prisma init
```

This creates:
```
packages/database/
├── prisma/
│   └── schema.prisma    ← Define all entities here
└── .env                 ← Prisma reads DATABASE_URL from here
```

### 5.2 Add DATABASE_URL to Prisma env

Create `packages/database/.env`:

```env
DATABASE_URL="postgresql://postgres:PASSWORD@HOST:PORT/railway"
```

Use the same value as Step 4.1.

### 5.3 Add the Prisma schema

Copy the `schema.prisma` file (see `schema.prisma` in this project) into `packages/database/prisma/schema.prisma`.

> The schema defines all 18 entities: Container, ContainerProductLine, ContainerExpense, ContainerDiscount, StockLot, BagType, BagPurchase, PackedStock, PackingSession, StockAdjustment, Client, ClientOrder, Shipment, DriverTrip, StockExit, Invoice, Payment, Worker, Supplier.

### 5.4 Run the first migration

```bash
cd packages/database
npx prisma migrate dev --name init
```

This creates all tables in your Railway PostgreSQL database.

### 5.5 Verify tables were created

```bash
npx prisma studio
```

This opens a browser UI showing all your tables. Confirm all 18 entities are present.

---

## Step 6 — Install Clerk in the Web App

### 6.1 Install the Clerk Next.js package

```bash
cd apps/web
npm install @clerk/nextjs
```

### 6.2 Add Clerk middleware

Create `apps/web/src/middleware.ts`:

```typescript
import { authMiddleware } from "@clerk/nextjs";

export default authMiddleware({
  publicRoutes: ["/sign-in", "/sign-up", "/api/webhooks/clerk"],
});

export const config = {
  matcher: ["/((?!.+\\.[\\w]+$)|/(api|trpc))(.*)"],
};
```

This protects every route except the login pages.

### 6.3 Wrap the app with ClerkProvider

Edit `apps/web/src/app/layout.tsx`:

```typescript
import { ClerkProvider } from "@clerk/nextjs";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body>{children}</body>
      </html>
    </ClerkProvider>
  );
}
```

### 6.4 Create sign-in page

Create `apps/web/src/app/sign-in/[[...sign-in]]/page.tsx`:

```typescript
import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <SignIn />
    </div>
  );
}
```

---

## Step 7 — Set Up User Roles

Roles are stored in Clerk's `publicMetadata` on each user object. The web app reads the role on every request.

### 7.1 Create a role helper

Create `apps/web/src/lib/roles.ts`:

```typescript
import { auth } from "@clerk/nextjs";

export type Role = "owner" | "accountant" | "sales_rep" | "worker" | "driver";

export function getRole(): Role | null {
  const { sessionClaims } = auth();
  return (sessionClaims?.metadata as { role?: Role })?.role ?? null;
}

export function requireRole(allowed: Role[]) {
  const role = getRole();
  if (!role || !allowed.includes(role)) {
    throw new Error("Unauthorized");
  }
  return role;
}
```

### 7.2 Assign a role to the first user (owner)

1. Go to https://dashboard.clerk.com
2. Click **Users** → find your user
3. Click on the user → **Metadata** tab
4. Under **Public metadata**, enter:
```json
{
  "role": "owner"
}
```
5. Save

Repeat for each user you create, assigning the correct role:
- `owner` — full access
- `accountant` — financial access, no profit
- `sales_rep` — orders, clients, invoices
- `worker` — packing sessions only
- `driver` — delivery only

### 7.3 Sync Clerk users to your database (webhook)

When a user is created in Clerk, you need a matching record in your database.

Create `apps/web/src/app/api/webhooks/clerk/route.ts`:

```typescript
import { Webhook } from "svix";
import { headers } from "next/headers";
import { WebhookEvent } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;
  if (!WEBHOOK_SECRET) throw new Error("Missing CLERK_WEBHOOK_SECRET");

  const headerPayload = headers();
  const svix_id = headerPayload.get("svix-id");
  const svix_timestamp = headerPayload.get("svix-timestamp");
  const svix_signature = headerPayload.get("svix-signature");

  const body = await req.text();
  const wh = new Webhook(WEBHOOK_SECRET);
  const evt = wh.verify(body, {
    "svix-id": svix_id!,
    "svix-timestamp": svix_timestamp!,
    "svix-signature": svix_signature!,
  }) as WebhookEvent;

  if (evt.type === "user.created") {
    await prisma.user.create({
      data: {
        clerkId: evt.data.id,
        email: evt.data.email_addresses[0].email_address,
        name: evt.data.first_name + " " + evt.data.last_name,
        role: evt.data.public_metadata.role as string ?? "sales_rep",
      },
    });
  }

  return new Response("OK", { status: 200 });
}
```

Add `CLERK_WEBHOOK_SECRET` to your `.env.local` — get this from Clerk dashboard → **Webhooks** → create endpoint pointing to `/api/webhooks/clerk`.

---

## Step 8 — Connect Web App to Database

### 8.1 Create a Prisma client singleton

Create `apps/web/src/lib/prisma.ts`:

```typescript
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ["query"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
```

### 8.2 Test the connection

Create `apps/web/src/app/api/health/route.ts`:

```typescript
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok", database: "connected" });
  } catch (error) {
    return NextResponse.json({ status: "error", database: "disconnected" }, { status: 500 });
  }
}
```

Run the app and visit `http://localhost:3000/api/health` — you should see `{ status: "ok", database: "connected" }`.

---

## Step 9 — Install Clerk in the Mobile App

### 9.1 Install dependencies

```bash
cd apps/mobile
npx expo install @clerk/clerk-expo expo-secure-store
```

### 9.2 Wrap the app with ClerkProvider

Edit `apps/mobile/App.tsx`:

```typescript
import { ClerkProvider, useAuth } from "@clerk/clerk-expo";
import * as SecureStore from "expo-secure-store";

const tokenCache = {
  async getToken(key: string) {
    return SecureStore.getItemAsync(key);
  },
  async saveToken(key: string, value: string) {
    return SecureStore.setItemAsync(key, value);
  },
};

export default function App() {
  return (
    <ClerkProvider
      tokenCache={tokenCache}
      publishableKey={process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY!}
    >
      <RootNavigator />
    </ClerkProvider>
  );
}
```

---

## Step 10 — Deploy to Railway

### 10.1 Connect GitHub to Railway

1. Go to your Railway project
2. Click **+ New** → **GitHub Repo**
3. Select your `charcoal-system` repository
4. Set the root directory to `apps/web`
5. Set the build command to `npm run build`
6. Set the start command to `npm run start`

### 10.2 Add environment variables to Railway

In Railway → your web service → **Variables** tab, add all variables from your `.env.local`:

```
DATABASE_URL
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
CLERK_SECRET_KEY
NEXT_PUBLIC_CLERK_SIGN_IN_URL
NEXT_PUBLIC_CLERK_SIGN_UP_URL
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL
CLERK_WEBHOOK_SECRET
```

### 10.3 Deploy

Railway auto-deploys on every push to your main branch. Trigger the first deploy:

```bash
git add .
git commit -m "production setup"
git push origin main
```

Watch the build logs in Railway. When it shows **Active**, your app is live.

### 10.4 Get your production URL

Railway assigns a URL like `https://charcoal-system-production.up.railway.app`.

Update `apps/mobile/.env`:
```env
EXPO_PUBLIC_API_URL="https://charcoal-system-production.up.railway.app"
```

---

## Step 11 — Build and Test the Mobile App

### 11.1 Start the Expo development server

```bash
cd apps/mobile
npx expo start
```

### 11.2 Test on your phone

1. Install **Expo Go** on your iOS or Android phone
2. Scan the QR code shown in terminal
3. The app loads on your phone instantly

### 11.3 Build for production (when ready)

```bash
npx eas build --platform all
```

This builds a real iOS and Android app. Requires an Expo account and (for iOS) an Apple Developer account ($99/year).

---

## Step 12 — First-Run App Setup (Owner)

Once deployed, the owner must complete setup before the system can be used:

1. **Log in** as owner
2. **Create bag types** — define every bag size used (2kg, 5kg, 10kg, 1.9kg...) with nominal weight, cost per bag, and worker rate per bag
3. **Add suppliers** — name, country, contact, charcoal types they supply, bank details
4. **Set worker rates** — go to Worker settings, set rate per bag type
5. **Create first container or add stock directly** — this creates the first stock lots
6. **Create client profiles** — add restaurants, shops, walk-ins with their currency and type
7. **Invite team members** — add users in Clerk dashboard with correct roles

---

## Local Development Commands

Run from the monorepo root:

```bash
# Start web app
npm run dev --filter=web

# Start mobile app
npm run dev --filter=mobile

# Run database migrations
cd packages/database && npx prisma migrate dev

# Open Prisma Studio (visual DB browser)
cd packages/database && npx prisma studio

# Run all apps simultaneously
npm run dev
```

---

## Troubleshooting

**`DATABASE_URL` connection error**
- Check that Railway PostgreSQL is running (green status in Railway dashboard)
- Make sure the `DATABASE_URL` in `.env.local` matches exactly what Railway shows

**Clerk redirect loops**
- Make sure all 4 `NEXT_PUBLIC_CLERK_*` URL variables are set in `.env.local`
- Make sure `middleware.ts` is in `src/` not in `app/`

**Prisma migration fails**
- Run `npx prisma generate` before `npx prisma migrate dev`
- Check that `packages/database/.env` has the correct `DATABASE_URL`

**Expo can't connect to API**
- On physical device, `localhost` does not work — use your computer's local IP (e.g. `192.168.1.x:3000`) during development
- In production, use the Railway URL

---

## File Checklist

Before going live, confirm these files exist and are configured:

- [ ] `apps/web/.env.local` — all environment variables set
- [ ] `apps/mobile/.env` — Clerk key and API URL set
- [ ] `packages/database/.env` — DATABASE_URL set
- [ ] `packages/database/prisma/schema.prisma` — all 18 entities defined
- [ ] `apps/web/src/middleware.ts` — Clerk auth middleware
- [ ] `apps/web/src/lib/prisma.ts` — Prisma client singleton
- [ ] `apps/web/src/lib/roles.ts` — role helper
- [ ] First migration run — all tables exist in Railway PostgreSQL
- [ ] Owner user created in Clerk with `role: "owner"` in metadata

---

*End of setup guide. See `SPEC.md` for full system specification and `schema.prisma` for the database schema.*
