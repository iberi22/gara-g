/**
 * bridge.ts — Contrato JS <-> Flutter para empujar telemetria en vivo desde el WebView.
 *
 * ───────────────────────────── CONTRATO COMPLETO ─────────────────────────────
 *
 * DIRECCION 1 — APK (Flutter) -> PWA (WebView)
 *
 *   La PWA instala `window.GaraBridge` al arrancar. Desde Dart:
 *
 * ```dart
 * // En tu WebViewController, tras cargar la pagina:
 * // a) Muestras en vivo, sin red: la PWA las pinta al instante.
 * _webViewController.runJavaScript('''
 *   window.GaraBridge.pushTelemetry({
 *     vin: "1HGCM82633A004352",
 *     ts: new Date().toISOString(),      // ISO 8601; no puede estar mas de 5 min en el futuro
 *     speedKmh: 42.5,
 *     rpm: 2300,
 *     coolantC: 88,
 *     fuelPct: 63,
 *     batteryV: 12.4,
 *     odometerKm: 45310,
 *     lat: 4.7110, lon: -74.0721,
 *     dtc: ["P0420"],                    // opcional, codigos OBD-II
 *     source: "apk"                      // 'apk' | 'obd2' | 'manual'
 *   });
 * ''');
 *
 * // b) Lote periodico por HTTP (para persistir en D1 y no perderlo al cerrar la app):
 * await http.post(
 *   Uri.parse("$baseUrl/api/garage/telemetry"),
 *   headers: {"content-type": "application/json", "cookie": sessionCookie},
 *   body: jsonEncode({"samples": [sample1, sample2]}),
 * );   // -> 200 {"accepted": 2, "rejected": {}}
 * ```
 *
 *   `pushTelemetry(sample)` valida con las MISMAS reglas que el servidor
 *   (telemetry/ingest.ts) y, si es valida, emite el evento DOM:
 *
 * ```js
 *   window.addEventListener("gara:telemetry", (e) => {
 *     console.log(e.detail);  // TelemetrySample normalizada
 *   });
 * ```
 *
 *   Devuelve `{ ok: true, sample }` o `{ ok: false, reason: "vin_invalido" | ... }`.
 *   Nunca lanza: el error se devuelve, no se propaga al `runJavaScript`.
 *
 * DIRECCION 2 — PWA -> APK (Flutter)
 *
 *   La PWA habla con el canal JS que inyecta Flutter:
 *
 * ```dart
 * _webViewController.addJavaScriptChannel(
 *   "GaraNative",                        // mismo nombre que window.GaraNative
 *   onMessage: (message) {
 *     final msg = jsonDecode(message);
 *     switch (msg["type"]) {
 *       case "garage:ready":    // La PWA monto el garage; ya se puede pedir foco.
 *       case "vehicle:changed": // El usuario cambio de vehiculo en el carrusel.
 *       case "part:focused":    // Toco una pieza: la APK puede mostrar su estado.
 *       case "dtc":             // Codigo de falla detectado.
 *       default: break;
 *     }
 *   },
 * );
 * ```
 *
 *   Y la PWA responde con `postToNative(type, payload)`, que serializa a JSON y lo
 *   manda por ese canal. Si el canal no existe (PWA abierta en un navegador normal),
 *   devuelve false y no rompe nada.
 *
 * `isEmbedded()` = estamos dentro de un WebView (User-Agent con `GaraGApp` o query
 * `?embed=app`). La UI la usa para esconder el cromo del sitio y activar el modo movil.
 *
 * NOTAS DE IMPLEMENTACION
 *  - `window.GaraBridge` se instala de forma idempotente: si la pagina se rehidrata, se
 *    reemplaza en vez de duplicar los listeners.
 *  - La validacion de `pushTelemetry` NO depende del servidor: si el telefono esta sin red
 *    (que es justo cuando mas se nota el modo en vivo), la muestra se pinta igual y se
 *    encola para el siguiente `POST` por parte de la PWA.
 *  - Este modulo no importa nada de three ni del navegador en el momento del import:
 *    `installGarageBridge()` se llama explicitamente desde el cliente (el Worker importa el
 *    fichero pero nunca lo ejecuta).
 * ─────────────────────────────────────────────────────────────────────────────
 */
import type { TelemetrySample } from '../contracts';
import { isValidVin, normalizeSample } from './ingest';

/** Version del contrato: si Flutter la compara, sabe si su lado esta viejo. */
export const BRIDGE_VERSION = '1.0.0';

/** Evento DOM que emite el puente (lo escucha la tira de monitoreo del HUD). */
export const TELEMETRY_EVENT = 'gara:telemetry';

/** Canal JS que Flutter inyecta (WebViewController.addJavaScriptChannel). */
export const NATIVE_CHANNEL = 'GaraNative';

export type BridgePushResult =
  | { ok: true; sample: TelemetrySample }
  | { ok: false; reason: string; detail?: string };

export interface GaraBridge {
  version: string;
  pushTelemetry(sample: unknown): BridgePushResult;
  isEmbedded(): boolean;
}

declare global {
  interface Window {
    GaraBridge?: GaraBridge;
    GaraNative?: { postMessage(message: string): void };
  }
}

/** Emite `gara:telemetry` con la muestra en `detail`. */
export function dispatchTelemetry(sample: TelemetrySample): void {
  if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') return;
  window.dispatchEvent(new CustomEvent(TELEMETRY_EVENT, { detail: sample }));
}

/**
 * Manda un mensaje a la APK por el canal JS de Flutter. Devuelve false si no hay WebView:
 * en un navegador normal no hay a quien mandarlo y no debe ser un error.
 */
export function postToNative(type: string, payload: Record<string, unknown> = {}): boolean {
  if (typeof window === 'undefined') return false;
  const channel = window.GaraNative;
  if (!channel || typeof channel.postMessage !== 'function') return false;
  try {
    channel.postMessage(
      JSON.stringify({ type, payload, version: BRIDGE_VERSION, at: new Date().toISOString() }),
    );
    return true;
  } catch {
    // Un canal roto (WebView destruido) no debe tumbar la pagina.
    return false;
  }
}

/** Estamos dentro de la APK: User-Agent propio o el flag `?embed=app` de la URL. */
export function isEmbedded(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const ua = window.navigator?.userAgent ?? '';
    if (/GaraGApp/i.test(ua)) return true;
    return new URLSearchParams(window.location?.search ?? '').get('embed') === 'app';
  } catch {
    return false;
  }
}

/**
 * Instala `window.GaraBridge`. Idempotente. Devuelve el puente instalado (util para los
 * tests y para el HUD, que lo consulta para saber si hay puente).
 */
export function installGarageBridge(): GaraBridge {
  const bridge: GaraBridge = {
    version: BRIDGE_VERSION,
    isEmbedded,
    pushTelemetry(raw: unknown): BridgePushResult {
      if (!raw || typeof raw !== 'object' || (raw as { vin?: unknown }).vin === undefined) {
        return { ok: false, reason: 'no_objeto' };
      }
      if (!isValidVin((raw as { vin: unknown }).vin)) {
        return { ok: false, reason: 'vin_invalido' };
      }
      // Si la APK no manda ts (o lo manda en epoch), se sella con la hora de la PWA: en vivo
      // el instante de recepcion es el que vale.
      const candidate =
        (raw as { ts?: unknown }).ts === undefined
          ? { ...(raw as Record<string, unknown>), ts: new Date().toISOString() }
          : raw;
      const res = normalizeSample(candidate, Date.now());
      if (!res.ok) return { ok: false, reason: res.reason, detail: res.detail };
      dispatchTelemetry(res.sample);
      return { ok: true, sample: res.sample };
    },
  };

  if (typeof window !== 'undefined') {
    window.GaraBridge = bridge;
    // Avisa a la APK de que el garage ya puede pedir foco. Sin canal, no pasa nada.
    postToNative('garage:ready', { version: BRIDGE_VERSION });
  }
  return bridge;
}
