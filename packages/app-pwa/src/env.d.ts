/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

/**
 * Importar un fichero como texto (`import script from './x.js?raw'`). Lo usan los
 * `<script is:inline set:html={...}>` de la app: el TEXTO tiene que ser una constante del
 * build para que la CSP pueda llevar su SHA-256 (ver src/lib/csp.ts).
 */
declare module '*?raw' {
  const content: string;
  export default content;
}

declare namespace App {
  interface Locals {
    user?: { email: string; role: string };
    /** Modo de uso que fija el middleware: `guest` (sin cuenta, datos locales) o `cloud` (con sesion). */
    mode?: 'guest' | 'cloud';
  }
}

/**
 * Bindings/secretos del Worker que lee el codigo con `env` de `cloudflare:workers`.
 * Solo se declaran aqui los de la malla de telemetria; el resto se tipa donde se usa.
 */
declare namespace Cloudflare {
  interface Env {
    /**
     * Secreto del que se derivan (HKDF) la sala y la clave AES de la replica de telemetria.
     * `wrangler secret put MESH_ROOM_SECRET` (>= 32 caracteres). Ver src/pages/api/mesh/room-key.ts.
     */
    MESH_ROOM_SECRET?: string;
    /** Id de la llave de Cloudflare TURN (opcional: sin ella la malla usa solo STUN). Ver src/pages/api/mesh/ice.ts. */
    TURN_KEY_ID?: string;
    /** Token de API de esa llave de TURN. `wrangler secret put TURN_KEY_API_TOKEN`. Nunca se devuelve ni se registra. */
    TURN_KEY_API_TOKEN?: string;
    /**
     * Entrega "solo flota": "true" (o ausente) oculta Mercado, Wallet, DePIN y V2V; "false" los
     * muestra. Se lee SOLO con isFleetOnly() de src/lib/features.ts.
     */
    FLEET_ONLY?: string;
  }
}
