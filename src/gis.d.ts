// Minimal types for Google Identity Services (accounts.google.com/gsi/client), token model only.
declare namespace google.accounts.oauth2 {
  interface TokenResponse {
    access_token: string;
    expires_in: number | string;
    scope: string;
    error?: string;
    error_description?: string;
  }
  interface ClientConfigError {
    type: 'popup_failed_to_open' | 'popup_closed' | 'unknown';
    message?: string;
  }
  interface TokenClientConfig {
    client_id: string;
    scope: string;
    callback: (resp: TokenResponse) => void;
    error_callback?: (err: ClientConfigError) => void;
  }
  interface OverridableTokenClientConfig {
    prompt?: '' | 'none' | 'consent' | 'select_account';
    login_hint?: string;
  }
  interface TokenClient {
    requestAccessToken(config?: OverridableTokenClientConfig): void;
  }
  function initTokenClient(config: TokenClientConfig): TokenClient;
  function hasGrantedAllScopes(resp: TokenResponse, ...scopes: string[]): boolean;
  function revoke(token: string, done?: () => void): void;
}

interface ImportMetaEnv {
  readonly VITE_GOOGLE_CLIENT_ID?: string;
}
