/**
 * api.ts — Cliente tipado de la API del Garage 3D (/api/garage/*) con degradación elegante.
 *
 * Si los endpoints del backend aún no existen o fallan (404, 401, error de red),
 * cada llamada degrada con gracia hacia datos de demostración (MOCK_SNAPSHOT y mockPanels),
 * guardando y recuperando snapshots en localStorage ('garage:snapshot:v1').
 */
import type {
  ForumPost,
  ForumThread,
  GarageSnapshot,
  MonitoringState,
  ServedAd,
  ShopFeed,
  VehicleDetail,
  WikiPage,
} from '../../garage/contracts';
import { getClientMode } from '../../lib/appMode';
import { MOCK_SNAPSHOT } from '../../garage/mock';
import {
  MOCK_FORUM_POSTS,
  MOCK_FORUM_THREADS,
  MOCK_SERVED_ADS,
  MOCK_SHOP_FEED,
  getMockHistory,
  getMockWiki,
} from './mockPanels';

export const SNAPSHOT_CACHE_KEY = 'garage:snapshot:v1';

/**
 * Modo invitado (sin cuenta): el garage vive en IndexedDB y NUNCA toca la red. Lo que necesita
 * cuenta (telemetria en vivo, wiki, foro, tienda, anuncios) devuelve vacio sin hacer peticiones,
 * y un 401 jamas manda a /login. Los datos locales no se mezclan con MOCK_SNAPSHOT ni con la
 * cache 'garage:snapshot:v1', que son de la nube.
 */
function isGuest(): boolean {
  return getClientMode() === 'guest';
}

const emptyWikiPage = (versionKey: string): WikiPage => ({
  versionKey,
  version: { key: versionKey, make: '', model: '', label: versionKey },
  sections: [],
  revision: 0,
  updatedAt: new Date().toISOString(),
});

const emptyThread = (threadId: string): ForumThread => ({
  id: threadId,
  versionKey: '',
  title: '',
  body: '',
  authorId: '',
  authorName: '',
  createdAt: new Date().toISOString(),
  lastActivityAt: new Date().toISOString(),
  replyCount: 0,
  tags: [],
});

const NEEDS_ACCOUNT = 'Disponible con cuenta';

/**
 * Las rutas de la comunidad (wiki y foro) responden con el sobre `{ ok: true, page | thread | post }`
 * (garage/community/auth.ts:ok). El cliente leia la respuesta como si fuera el objeto pelado, y el
 * panel Wiki reventaba con datos reales ("Cannot read properties of undefined (reading 'label')").
 * Se desenvuelve aqui; si algun dia la ruta devuelve el objeto sin sobre, tambien sirve.
 */
function unwrap<T>(data: unknown, key: string): T {
  if (data && typeof data === 'object' && key in data) return (data as Record<string, unknown>)[key] as T;
  return data as T;
}

export class GarageApiClient {
  private offline = false;

  get isOffline(): boolean {
    return this.offline;
  }

  set isOffline(val: boolean) {
    this.offline = val;
  }

  /**
   * Ejecuta peticiones HTTP delegando en fetch con credenciales same-origin.
   */
  private async request(url: string, init?: RequestInit): Promise<Response> {
    return fetch(url, {
      credentials: 'same-origin',
      ...init,
      headers: init?.headers,
    });
  }

  /**
   * Obtiene la lista de vehículos del tenant con snapshot general.
   * Maneja redirección a 401, caché local ('garage:snapshot:v1') en fallos de red o 5xx,
   * y fallback a MOCK_SNAPSHOT únicamente cuando no hay caché ni red (primera carga/offline).
   */
  async getVehicles(): Promise<{ snapshot: GarageSnapshot; isOffline: boolean }> {
    if (isGuest()) {
      this.offline = false;
      try {
        const { loadLocalSnapshot } = await import('./guestGarage');
        return { snapshot: await loadLocalSnapshot(), isOffline: false };
      } catch {
        // IndexedDB bloqueado (navegacion privada antigua): garage vacio, nunca el mock.
        return { snapshot: { vehicles: [], generatedAt: new Date().toISOString() }, isOffline: false };
      }
    }
    try {
      const res = await this.request('/api/garage/vehicles');
      if (res.status === 401) {
        if (typeof window !== 'undefined' && window.location) {
          window.location.href = '/login?redirect=/fleet/garage';
        }
        return {
          snapshot: { vehicles: [], generatedAt: new Date().toISOString() },
          isOffline: false,
        };
      }

      if (res.ok) {
        const data = (await res.json()) as GarageSnapshot;
        this.saveSnapshotCache(data);
        this.offline = false;
        return { snapshot: data, isOffline: false };
      }
    } catch {
      // Error de red, continuar a degradación
    }

    this.offline = true;
    const cached = this.loadSnapshotCache();
    if (cached) {
      return { snapshot: cached, isOffline: true };
    }

    return { snapshot: MOCK_SNAPSHOT, isOffline: true };
  }

  /**
   * Obtiene el detalle de un vehículo específico con su historial.
   * 404 devuelve historial vacío.
   */
  async getVehicleDetail(id: string): Promise<VehicleDetail> {
    if (isGuest()) {
      const { loadLocalDetail } = await import('./guestGarage');
      const detail = await loadLocalDetail(id);
      if (!detail) throw new Error('Vehículo no encontrado');
      return detail;
    }
    const currentVehicles = this.loadSnapshotCache()?.vehicles ?? MOCK_SNAPSHOT.vehicles;
    const vehicle = currentVehicles.find((v) => v.id === id) ?? currentVehicles[0];

    try {
      const res = await this.request(`/api/garage/vehicle/${encodeURIComponent(id)}`);
      if (res.ok) {
        return (await res.json()) as VehicleDetail;
      }
      if (res.status === 404) {
        return { vehicle, history: [] };
      }
    } catch {
      // Error de red
    }

    const history = this.offline ? getMockHistory(id) : [];
    return { vehicle, history };
  }

  /**
   * Consulta el estado de telemetría y monitoreo para un VIN.
   * Si la API responde 404 o no hay muestras, devuelve estado sin muestras (sin telemetría ficticia).
   * Datos de ejemplo únicamente en modo offline/mock.
   */
  async getTelemetry(vin: string): Promise<MonitoringState> {
    if (isGuest()) return { vin, connected: false, series: [] };
    try {
      const res = await this.request(`/api/garage/telemetry/${encodeURIComponent(vin)}`);
      if (res.ok) {
        return (await res.json()) as MonitoringState;
      }
      if (res.status === 404) {
        return {
          vin,
          connected: false,
          series: [],
        };
      }
    } catch {
      // Error de red
    }

    if (this.offline) {
      return {
        vin,
        connected: false,
        lastSeen: new Date().toISOString(),
        latest: {
          vin,
          ts: new Date().toISOString(),
          speedKmh: 42,
          rpm: 3400,
          coolantC: 86,
          batteryV: 14.1,
          dtc: [],
          source: 'apk',
        },
        series: [],
      };
    }

    return {
      vin,
      connected: false,
      series: [],
    };
  }

  /**
   * Consulta las secciones de la Wiki para una versión vehicular.
   * 404 devuelve estructura vacía sin secciones ficticias.
   */
  async getWiki(versionKey: string): Promise<WikiPage> {
    if (isGuest()) return emptyWikiPage(versionKey);
    try {
      const res = await this.request(`/api/garage/wiki/${encodeURIComponent(versionKey)}`);
      if (res.ok) {
        return unwrap<WikiPage>(await res.json(), 'page');
      }
      if (res.status === 404) {
        return {
          versionKey,
          version: {
            key: versionKey,
            make: '',
            model: '',
            label: versionKey,
          },
          sections: [],
          revision: 0,
          updatedAt: new Date().toISOString(),
        };
      }
    } catch {
      // Fallback
    }

    if (this.offline) {
      return getMockWiki(versionKey);
    }

    return {
      versionKey,
      version: {
        key: versionKey,
        make: '',
        model: '',
        label: versionKey,
      },
      sections: [],
      revision: 0,
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Actualiza el contenido de una sección editable de la comunidad en la Wiki.
   */
  async updateWikiSection(
    versionKey: string,
    sectionId: string,
    body: string,
    baseRevision: number,
  ): Promise<WikiPage> {
    if (isGuest()) throw new Error(NEEDS_ACCOUNT);
    try {
      const res = await this.request(
        `/api/garage/wiki/${encodeURIComponent(versionKey)}/${encodeURIComponent(sectionId)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body, baseRevision }),
        },
      );
      if (res.ok) {
        return unwrap<WikiPage>(await res.json(), 'page');
      }
    } catch {
      // Fallback
    }

    // Actualización optimista local en el mock
    const page = getMockWiki(versionKey);
    const sec = page.sections.find((s) => s.id === sectionId);
    if (sec && sec.editable) {
      sec.body = body;
      sec.updatedAt = new Date().toISOString();
      page.revision += 1;
    }
    return page;
  }

  /**
   * Consulta los hilos de discusión del foro para una versión vehicular.
   * 404 devuelve lista vacía.
   */
  async getForumThreads(versionKey: string): Promise<ForumThread[]> {
    if (isGuest()) return [];
    try {
      const res = await this.request(`/api/garage/forum/${encodeURIComponent(versionKey)}`);
      if (res.ok) {
        const data = (await res.json()) as { threads: ForumThread[] };
        return data.threads ?? [];
      }
      if (res.status === 404) {
        return [];
      }
    } catch {
      // Fallback
    }

    if (this.offline) {
      return MOCK_FORUM_THREADS.filter((t) => t.versionKey === versionKey || !t.versionKey);
    }
    return [];
  }

  /**
   * Obtiene el detalle de un hilo de discusión con sus respuestas.
   */
  async getForumThreadDetail(threadId: string): Promise<{ thread: ForumThread; posts: ForumPost[] }> {
    if (isGuest()) return { thread: emptyThread(threadId), posts: [] };
    try {
      const res = await this.request(`/api/garage/forum/thread/${encodeURIComponent(threadId)}`);
      if (res.ok) {
        return (await res.json()) as { thread: ForumThread; posts: ForumPost[] };
      }
      if (res.status === 404) {
        return {
          thread: {
            id: threadId,
            versionKey: '',
            title: 'Hilo no encontrado',
            body: '',
            authorId: '',
            authorName: '',
            createdAt: new Date().toISOString(),
            lastActivityAt: new Date().toISOString(),
            replyCount: 0,
            tags: [],
          },
          posts: [],
        };
      }
    } catch {
      // Fallback
    }

    if (this.offline) {
      const thread = MOCK_FORUM_THREADS.find((t) => t.id === threadId) ?? MOCK_FORUM_THREADS[0];
      const posts = MOCK_FORUM_POSTS[threadId] ?? [];
      return { thread, posts };
    }

    return {
      thread: {
        id: threadId,
        versionKey: '',
        title: 'Hilo no encontrado',
        body: '',
        authorId: '',
        authorName: '',
        createdAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        replyCount: 0,
        tags: [],
      },
      posts: [],
    };
  }

  /**
   * Crea un nuevo hilo de discusión en el foro.
   */
  async createForumThread(
    versionKey: string,
    title: string,
    body: string,
    tags: string[] = [],
  ): Promise<ForumThread> {
    if (isGuest()) throw new Error(NEEDS_ACCOUNT);
    try {
      const res = await this.request(`/api/garage/forum/${encodeURIComponent(versionKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, body, tags }),
      });
      if (res.ok) {
        return unwrap<ForumThread>(await res.json(), 'thread');
      }
    } catch {
      // Fallback
    }

    const newThread: ForumThread = {
      id: `thread-local-${Date.now()}`,
      versionKey,
      title,
      body,
      authorId: 'usr-local',
      authorName: 'Tú (Conductor)',
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      replyCount: 0,
      tags,
    };
    MOCK_FORUM_THREADS.unshift(newThread);
    return newThread;
  }

  /**
   * Añade una respuesta a un hilo de discusión.
   */
  async createForumPost(threadId: string, body: string): Promise<ForumPost> {
    if (isGuest()) throw new Error(NEEDS_ACCOUNT);
    try {
      const res = await this.request(`/api/garage/forum/thread/${encodeURIComponent(threadId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      if (res.ok) {
        return unwrap<ForumPost>(await res.json(), 'post');
      }
    } catch {
      // Fallback
    }

    const newPost: ForumPost = {
      id: `post-local-${Date.now()}`,
      threadId,
      versionKey: '',
      body,
      authorId: 'usr-local',
      authorName: 'Tú (Conductor)',
      createdAt: new Date().toISOString(),
    };
    if (!MOCK_FORUM_POSTS[threadId]) {
      MOCK_FORUM_POSTS[threadId] = [];
    }
    MOCK_FORUM_POSTS[threadId].push(newPost);
    return newPost;
  }

  /**
   * Consulta el feed del Shop (anuncios patrocinados + publicaciones orgánicas).
   * 404 devuelve estado vacío.
   */
  async getShop(vehicleId?: string): Promise<ShopFeed> {
    if (isGuest()) return { sponsored: [], posts: [] };
    try {
      const url = vehicleId
        ? `/api/garage/shop?vehicleId=${encodeURIComponent(vehicleId)}`
        : '/api/garage/shop';
      const res = await this.request(url);
      if (res.ok) {
        return (await res.json()) as ShopFeed;
      }
      if (res.status === 404) {
        return { sponsored: [], posts: [] };
      }
    } catch {
      // Fallback
    }

    if (this.offline) {
      return MOCK_SHOP_FEED;
    }
    return { sponsored: [], posts: [] };
  }

  /**
   * Pide anuncios contextuales para una ranura y/o categoría de repuesto.
   * 404 devuelve lista vacía.
   */
  async serveAd(opts: {
    slot: string;
    vehicleId?: string;
    partCategory?: string;
  }): Promise<ServedAd[]> {
    if (isGuest()) return [];
    try {
      const params = new URLSearchParams({ slot: opts.slot });
      if (opts.vehicleId) params.set('vehicleId', opts.vehicleId);
      if (opts.partCategory) params.set('partCategory', opts.partCategory);

      const res = await this.request(`/api/garage/ads/serve?${params.toString()}`);
      if (res.ok) {
        const data = (await res.json()) as { ads: ServedAd[] };
        return data.ads ?? [];
      }
      if (res.status === 404) {
        return [];
      }
    } catch {
      // Fallback
    }

    if (this.offline) {
      return MOCK_SERVED_ADS;
    }
    return [];
  }

  /**
   * Registra una impresión de anuncio cumplido el requisito de visibilidad (>=50% por >=1s).
   */
  async recordImpression(token: string): Promise<boolean> {
    if (isGuest()) return false;
    try {
      const res = await this.request('/api/garage/ads/impression', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      return res.status === 204 || res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Genera el enlace de clic auditado a través del endpoint de redirección.
   */
  getAdClickUrl(token: string): string {
    return `/api/garage/ads/click?t=${encodeURIComponent(token)}`;
  }

  // --- Manejo de caché en localStorage ---

  private saveSnapshotCache(snapshot: GarageSnapshot): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(SNAPSHOT_CACHE_KEY, JSON.stringify(snapshot));
    } catch {
      // Ignorar si el almacenamiento está bloqueado o lleno
    }
  }

  private loadSnapshotCache(): GarageSnapshot | null {
    if (typeof localStorage === 'undefined') return null;
    try {
      const raw = localStorage.getItem(SNAPSHOT_CACHE_KEY);
      if (raw) {
        return JSON.parse(raw) as GarageSnapshot;
      }
    } catch {
      // Ignorar fallo de parseo
    }
    return null;
  }
}

export const garageApi = new GarageApiClient();
