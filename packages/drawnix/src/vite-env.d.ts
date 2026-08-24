/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TUZI_EMBEDDED_MODE?: string;
  readonly VITE_TUZI_API_BASE_URL?: string;
  readonly VITE_TUZI_PARENT_ORIGIN?: string;
}

declare const __APP_VERSION__: string;
