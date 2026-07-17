/// <reference types="vite/client" />

// M4 Supabase 연동 env(Phase B3). 없으면 네트워크 계층은 no-op.
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
