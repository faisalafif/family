# Family Tracker MVP

Web-only family location prototype using React + Vite + Supabase + Leaflet/OpenStreetMap.

## 1. Supabase

Create a Supabase project, open SQL Editor, and run:

`supabase/schema.sql`

Then copy your project URL and anon key.

## 2. Local setup

```bash
npm install
copy .env.example .env
```

Edit `.env`:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
```

Run:

```bash
npm run dev
```

Open the dashboard URL shown by Vite.

## 3. How to test

1. Add a family member with name and phone number.
2. Select the member.
3. Copy the generated tracking link.
4. Open the link on the target phone.
5. Grant browser location permission once.
6. Keep the tracking page open while testing.
7. Open the dashboard and see the latest location on the map.

## Important MVP limitation

This version uses browser Geolocation API. It is not a 24/7 background tracker. If the browser page is closed or the operating system suspends it, location updates can stop.

For a later Android version, keep the same Supabase schema/API concept and replace the browser location collector with a native background location service.

## Security note

The included Supabase policies are intentionally open for a local/private MVP and are NOT suitable for a public production deployment. Before publishing, add Supabase Auth and restrict family data by authenticated user/family.
