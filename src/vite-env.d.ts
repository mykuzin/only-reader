/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** OAuth client ID (Web application) for Google sign-in; sign-in is hidden when unset. */
  readonly VITE_GOOGLE_CLIENT_ID?: string
}
