# Hitster Party

A phone-friendly take on Hitster for parties. Whatever the host is playing on Spotify becomes the mystery card. Everyone guesses where it fits in their own timeline at the same time. A correct guess keeps the card and a wrong one loses it, and the first player to reach the target number of cards wins.

- **Host**: signs in with Spotify (PKCE, no secret) on a laptop or phone and shows the game code / QR. Each new song automatically starts a round and reveals the last one.
- **Players**: open the link, type a name, and place songs. No Spotify account is needed.
- **Year**: Spotify's album year is checked against MusicBrainz so remasters and compilations don't give a wrong answer. The host can also fix a year by hand.
- **No Spotify?** The host can type songs in manually instead.

Stack: Next.js 15 + Tailwind on Vercel, and Supabase (Postgres, Realtime, anonymous auth).

## Setup

### 1. Supabase
1. Create a free project at [supabase.com](https://supabase.com).
2. **SQL Editor**: paste and run `supabase/migrations/0001_init.sql`.
3. **Authentication → Sign In / Providers**: turn on **Allow anonymous sign-ins**.
4. **Project Settings → API**: copy the Project URL and the `anon` public key.

### 2. Spotify
1. Create an app at [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) and tick **Web API**.
2. Add redirect URIs: `http://127.0.0.1:3000/callback` for local dev and `https://<your-site>.vercel.app/callback` once deployed.
3. Copy the Client ID. In development mode, add each host's Spotify email under **User Management**. Up to 5 users are allowed, and the app owner needs Premium. Players don't count.

### 3. Run locally
```bash
cp .env.example .env.local   # fill in the three values
npm install
npm run dev                  # http://127.0.0.1:3000 (use 127.0.0.1, not localhost, for Spotify)
```

### 4. Deploy (so friends' phones can reach it)
Import the repo on [vercel.com](https://vercel.com), add the same three environment variables, deploy, and then add the Vercel URL's `/callback` to the Spotify app's redirect URIs.

## How the code is laid out

- `lib/`: everything that isn't UI (Spotify login and polling, Supabase calls, the live room hook). Redesigns shouldn't need to touch this.
- `components/` and `app/`: the screens. Swap these for designs from v0 or any other tool.
- `supabase/migrations/`: tables, security rules and the game logic (scoring, reveal, winner) as SQL functions, so players can't cheat from the browser.
- `supabase/tests/`: `game_test.sql` plays a short game against a plain Postgres:
  `psql -d test -f supabase/tests/shim.sql -f supabase/migrations/0001_init.sql -f supabase/tests/game_test.sql`
