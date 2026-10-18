// Spotify Authorization Code + PKCE, entirely in the host's browser. No client secret.

// user-modify-playback-state lets the host skip songs from the game.
const SCOPES = "user-read-currently-playing user-read-playback-state user-modify-playback-state";
const TOKEN_KEY = "spotify_tokens";
const VERIFIER_KEY = "spotify_pkce_verifier";

type Tokens = { access_token: string; refresh_token: string; expires_at: number; scope?: string };

export type NowPlaying = {
  id: string;
  title: string;
  artist: string;
  albumYear: number | null;
  isrc: string | null;
  imageUrl: string | null;
  isPlaying: boolean;
};

function clientId(): string {
  const id = process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID;
  if (!id) throw new Error("Spotify isn't configured: set NEXT_PUBLIC_SPOTIFY_CLIENT_ID.");
  return id;
}

function redirectUri(): string {
  return `${window.location.origin}/callback`;
}

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return btoa(String.fromCharCode(...arr)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function startLogin(): Promise<void> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = base64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  localStorage.setItem(VERIFIER_KEY, verifier);
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId(),
    scope: SCOPES,
    code_challenge_method: "S256",
    code_challenge: challenge,
    redirect_uri: redirectUri(),
  });
  window.location.href = `https://accounts.spotify.com/authorize?${params}`;
}

async function requestTokens(body: Record<string, string>): Promise<Tokens> {
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId(), ...body }),
  });
  if (!res.ok) throw new Error(`Spotify token request failed (${res.status})`);
  const json = await res.json();
  const tokens: Tokens = {
    access_token: json.access_token,
    // Spotify may or may not rotate the refresh token.
    refresh_token: json.refresh_token ?? body.refresh_token,
    expires_at: Date.now() + json.expires_in * 1000,
    scope: json.scope ?? (JSON.parse(localStorage.getItem(TOKEN_KEY) ?? "{}") as Partial<Tokens>).scope,
  };
  localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
  return tokens;
}

export async function finishLogin(code: string): Promise<void> {
  const verifier = localStorage.getItem(VERIFIER_KEY);
  if (!verifier) throw new Error("Login expired, try again.");
  await requestTokens({ grant_type: "authorization_code", code, redirect_uri: redirectUri(), code_verifier: verifier });
  localStorage.removeItem(VERIFIER_KEY);
}

export function isLoggedIn(): boolean {
  return !!localStorage.getItem(TOKEN_KEY);
}

/** Whether the host connected with permission to skip songs (older logins didn't ask for it). */
export function canSkip(): boolean {
  try {
    const t: Tokens = JSON.parse(localStorage.getItem(TOKEN_KEY) ?? "{}");
    return !!t.scope?.includes("user-modify-playback-state");
  } catch {
    return false;
  }
}

/** Skips to the next song on whatever device Spotify is playing on. */
export async function skipToNext(): Promise<void> {
  const res = await fetch("https://api.spotify.com/v1/me/player/next", {
    method: "POST",
    headers: { Authorization: `Bearer ${await accessToken()}` },
  });
  if (res.status === 403) throw new Error("Spotify won't let this account skip (it needs Premium, or reconnect Spotify).");
  if (res.status === 404) throw new Error("Spotify isn't playing on any device right now.");
  if (!res.ok && res.status !== 204) throw new Error(`Couldn't skip (${res.status})`);
}

export function logout(): void {
  localStorage.removeItem(TOKEN_KEY);
}

async function accessToken(): Promise<string> {
  const raw = localStorage.getItem(TOKEN_KEY);
  if (!raw) throw new Error("Not connected to Spotify");
  let tokens: Tokens = JSON.parse(raw);
  if (Date.now() > tokens.expires_at - 60_000) {
    tokens = await requestTokens({ grant_type: "refresh_token", refresh_token: tokens.refresh_token });
  }
  return tokens.access_token;
}

export async function getNowPlaying(): Promise<NowPlaying | null> {
  const res = await fetch("https://api.spotify.com/v1/me/player/currently-playing", {
    headers: { Authorization: `Bearer ${await accessToken()}` },
  });
  if (res.status === 204) return null;
  if (res.status === 401) {
    logout();
    throw new Error("Spotify session expired, connect again.");
  }
  if (!res.ok) throw new Error(`Spotify error (${res.status})`);
  const json = await res.json();
  const item = json.item;
  if (!item || json.currently_playing_type !== "track") return null;
  return { ...toTrack(item), isPlaying: !!json.is_playing };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toTrack(item: any): Omit<NowPlaying, "isPlaying"> {
  const year = parseInt(String(item.album?.release_date ?? "").slice(0, 4), 10);
  return {
    id: item.id,
    title: item.name,
    artist: (item.artists ?? []).map((a: { name: string }) => a.name).join(", "),
    albumYear: Number.isFinite(year) ? year : null,
    isrc: item.external_ids?.isrc ?? null,
    imageUrl: item.album?.images?.[0]?.url ?? null,
  };
}

/** The next few tracks in the host's queue, so their years can be looked up before they play. */
export async function getQueue(limit = 2): Promise<Omit<NowPlaying, "isPlaying">[]> {
  const res = await fetch("https://api.spotify.com/v1/me/player/queue", {
    headers: { Authorization: `Bearer ${await accessToken()}` },
  });
  if (!res.ok) return [];
  const json = await res.json();
  return (json.queue ?? [])
    .filter((t: { type?: string; id?: string }) => t?.type === "track" && t.id)
    .slice(0, limit)
    .map(toTrack);
}
