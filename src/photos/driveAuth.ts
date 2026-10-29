import { useSyncExternalStore } from 'react';
import { getMeta, setMeta } from '../db';

/*
 * Google sign-in for Drive using the Google Identity Services token flow (browser only, no backend).
 * - Scope is drive.readonly.
 * - The access token lives in memory only, never in storage (NFR-04). It lasts about an hour.
 * - Getting a new token opens a Google popup, which browsers only allow from a click, so an
 *   expired session shows a one-click "Reconnect" instead of failing silently.
 */

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() ?? '';
const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const GIS_SRC = 'https://accounts.google.com/gsi/client';
const ACCOUNT_KEY = 'gdrive.account';
const EXPIRY_MARGIN_MS = 60_000;

export interface DriveAccount {
  email: string;
  name: string;
}

interface AuthState {
  configured: boolean;
  signedIn: boolean;
  /** Remembered between sessions so reconnecting can skip the account chooser. */
  account?: DriveAccount;
  busy: boolean;
}

let state: AuthState = { configured: !!CLIENT_ID, signedIn: false, busy: false };
let token: { value: string; expiresAt: number } | null = null;
let expiryTimer: number | undefined;
const listeners = new Set<() => void>();

function update(patch: Partial<AuthState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export const useDriveAuth = () =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => state,
  );

getMeta<DriveAccount>(ACCOUNT_KEY).then((account) => account && update({ account }));

let gisLoading: Promise<void> | null = null;
function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  gisLoading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      gisLoading = null;
      reject(new Error('Could not load Google sign-in. Check your internet connection.'));
    };
    document.head.appendChild(s);
  });
  return gisLoading;
}

// Load the script early so the click-to-popup path stays synchronous enough for popup blockers.
if (CLIENT_ID) loadGis().catch(() => {});

/** Valid token or null. Never opens a popup. */
export function currentToken(): string | null {
  if (token && Date.now() < token.expiresAt - EXPIRY_MARGIN_MS) return token.value;
  return null;
}

/** Called when Drive answers 401: the token is no longer good. */
export function invalidateToken() {
  token = null;
  clearTimeout(expiryTimer);
  if (state.signedIn) update({ signedIn: false });
}

/**
 * Opens Google's sign-in popup. Call from a click handler.
 * With a remembered account and earlier consent the popup closes by itself.
 */
export async function signIn(opts: { chooseAccount?: boolean } = {}): Promise<boolean> {
  if (!CLIENT_ID) throw new Error('Add VITE_GOOGLE_CLIENT_ID to .env.local, then restart the dev server.');
  await loadGis();
  update({ busy: true });
  try {
    const resp = await new Promise<google.accounts.oauth2.TokenResponse>((resolve, reject) => {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPE,
        callback: (r) => (r.error ? reject(new Error(r.error_description || r.error)) : resolve(r)),
        error_callback: (e) =>
          reject(new Error(e.type === 'popup_closed' ? 'Sign-in was cancelled.' : 'The Google sign-in window was blocked. Allow pop-ups for localhost and try again.')),
      });
      client.requestAccessToken({
        prompt: opts.chooseAccount || !state.account ? 'select_account' : '',
        login_hint: opts.chooseAccount ? undefined : state.account?.email,
      });
    });
    if (!google.accounts.oauth2.hasGrantedAllScopes(resp, SCOPE)) {
      throw new Error('Drive access wasn’t granted. Tick the Google Drive box when signing in.');
    }
    const ms = Number(resp.expires_in) * 1000;
    token = { value: resp.access_token, expiresAt: Date.now() + ms };
    clearTimeout(expiryTimer);
    expiryTimer = window.setTimeout(invalidateToken, Math.max(0, ms - EXPIRY_MARGIN_MS));

    const account = await fetchAccount(resp.access_token);
    await setMeta(ACCOUNT_KEY, account);
    update({ signedIn: true, account });
    return true;
  } finally {
    update({ busy: false });
  }
}

export async function signOut() {
  const t = token?.value;
  invalidateToken();
  await setMeta(ACCOUNT_KEY, undefined);
  update({ account: undefined });
  if (t) {
    await loadGis();
    google.accounts.oauth2.revoke(t);
  }
}

async function fetchAccount(accessToken: string): Promise<DriveAccount> {
  const r = await fetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName)', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) return { email: '', name: 'Google account' };
  const { user } = await r.json();
  return { email: user?.emailAddress ?? '', name: user?.displayName ?? user?.emailAddress ?? 'Google account' };
}

declare global {
  interface Window {
    google?: { accounts?: { oauth2?: unknown } };
  }
}
