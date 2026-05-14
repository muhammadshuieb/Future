/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** When the panel is not served behind the same origin as the API (e.g. dev on :5173 hitting :3000). No trailing slash. */
  readonly VITE_PUBLIC_API_BASE?: string;
}
