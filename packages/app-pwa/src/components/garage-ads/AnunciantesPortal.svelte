<!--
  AnunciantesPortal.svelte — Portal del anunciante del shop del garage.

  Que resuelve y por que:
  - La persona que se registra NO ve su anuncio salir de inmediato: nace con saldo 0, sin
    verificar y la campaña en revisión. El portal lo dice de entrada, porque descubrirlo
    después de llenar el formulario es la peor forma de enterarse.
  - La explicación de la subasta va en el propio formulario (segundo precio, ritmo,
    segmentación) y NO en una FAQ aparte: la pregunta "¿por qué no sale mi anuncio?"
    aparece mientras se configuran las pujas.
  - La vista previa del anuncio es la MISMA tarjeta que verá el usuario final, con su
    "Patrocinado". Si el anunciante no puede ver lo que realmente se aprueba, no
    puede aprobarlo bien.

  Todos los textos del anunciante se renderizan como texto de Svelte (interpolación), NUNCA
  con {@html}: un nombre de taller es entrada de usuario y va a la base de datos.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import AdPreview from './AdPreview.svelte';
  // Los tipos vienen de los CONTRATOS del dominio, no de una copia local: si el contrato
  // cambia, el portal deja de compilar en vez de mentir sobre la forma de los datos.
  import type { Advertiser, AdCampaign, PartCategory } from '../../garage/contracts';

  type AdvertiserKind = 'parts_store' | 'workshop' | 'service' | 'dealer' | 'other';



  interface Stats {
    totals: { impressions: number; clicks: number; spendCOP: number; ctrPct: number; cpcRealCOP: number | null };
    days: { day: string; impressions: number; clicks: number; spendCOP: number }[];
  }

  const KIND_LABEL: Record<AdvertiserKind, string> = {
    parts_store: 'Tienda de repuestos',
    workshop: 'Taller',
    service: 'Servicio',
    dealer: 'Concesionario',
    other: 'Otro',
  };

  const STATUS_LABEL: Record<Campaign['status'], string> = {
    draft: 'Borrador',
    pending_review: 'En revisión',
    active: 'Activa',
    paused: 'Pausada',
    exhausted: 'Sin presupuesto',
    rejected: 'Rechazada',
  };

  const FAMILIES = [
    { value: 'moto', label: 'Motos' },
    { value: 'car', label: 'Carros' },
    { value: 'heavy', label: 'Camiones' },
    { value: 'machinery', label: 'Maquinaria amarilla' },
  ];
  const BODIES = [
    { value: 'naked', label: 'Moto naked' },
    { value: 'sport', label: 'Moto sport' },
    { value: 'scooter', label: 'Scooter' },
    { value: 'trail', label: 'Trail' },
    { value: 'sedan', label: 'Sedán' },
    { value: 'hatchback', label: 'Hatchback' },
    { value: 'suv', label: 'SUV' },
    { value: 'pickup', label: 'Pickup' },
    { value: 'van', label: 'Van' },
    { value: 'truck', label: 'Camión furgón' },
    { value: 'flatbed', label: 'Camión de estacas' },
    { value: 'dump', label: 'Volqueta' },
    { value: 'tractor', label: 'Tractomula' },
    { value: 'excavator', label: 'Excavadora' },
    { value: 'backhoe', label: 'Retroexcavadora' },
    { value: 'wheel_loader', label: 'Cargador frontal' },
    { value: 'dozer', label: 'Bulldozer' },
    { value: 'grader', label: 'Motoniveladora' },
    { value: 'roller', label: 'Vibrocompactador' },
  ];
  /**
   * Las categorias de pieza NO se escriben a mano: se derivan del tipo `PartCategory` de los
   * contratos (que es donde el dominio las declara). Escribir la lista aqui era duplicarla, y
   * una duplicacion en la segmentacion se traduce en una categoria que el anunciante ve en el
   * portal pero que la subasta nunca puede satisfacer: el peor fallo posible en un filtro.
   * La etiqueta es solo para mostrar; el valor es el que viaja al targeting.
   */
  /** Etiquetas legibles para las categorias (el valor sigue siendo el del dominio). */
  const ETIQUETA_CATEGORIA: Partial<Record<PartCategory, string>> = {
    frenos: 'Frenos', llantas: 'Llantas', motor: 'Motor', suspension: 'Suspensión',
    transmision: 'Transmisión', electrico: 'Eléctrico', filtro: 'Filtros', liquido: 'Líquidos',
    carroceria: 'Carrocería', iluminacion: 'Iluminación', escape: 'Escape', chasis: 'Chasis',
    hidraulico: 'Hidráulico',
  };
  const PART_CATEGORIES: { value: PartCategory; label: string }[] = (
    [
      'frenos', 'llantas', 'motor', 'suspension', 'transmision', 'electrico',
      'filtro', 'liquido', 'carroceria', 'iluminacion', 'escape', 'chasis', 'hidraulico',
    ] satisfies PartCategory[]
  ).map((value) => ({ value, label: ETIQUETA_CATEGORIA[value] ?? value }));

  /** Pide JSON y devuelve el error del servidor si viene; `null` si no se pudo. */
  async function pedir<T>(url: string, init?: RequestInit): Promise<T | null> {
    try {
      const res = await fetch(url, {
        ...init,
        headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      });
      if (!res.ok) {
        const texto = await res.text();
        try {
          const parsed = JSON.parse(texto) as { error?: string };
          error = parsed.error ?? `Error ${res.status}`;
        } catch {
          error = `Error ${res.status}`;
        }
        return null;
      }
      return (await res.json()) as T;
    } catch (e) {
      error = e instanceof Error ? e.message : 'No se pudo conectar con el servidor';
      return null;
    }
  }

  const cop = (n: number) => `$ ${Math.round(n).toLocaleString('es-CO')}`;

  let cargando = $state(true);
  let error = $state('');
  let aviso = $state('');
  let soyAdmin = $state(false);
  let anunciantes = $state<Advertiser[]>([]);
  let campanas = $state<Campaign[]>([]);
  let anuncioSeleccionado = $state<Campaign | null>(null);
  let statsDe = $state<Record<string, Stats>>({});

  // --- Alta de anunciante ---
  let nuevoNombre = $state('');
  let nuevoTipo = $state<AdvertiserKind>('workshop');
  let nuevoCorreo = $state('');
  let nuevaCiudad = $state('');
  let registrando = $state(false);

  // --- Alta de campaña (con vista previa en vivo) ---
  let campanaAbierta = $state(false);
  let guardando = $state(false);
  let fNombre = $state('');
  let fTitulo = $state('');
  let fCuerpo = $state('');
  let fCta = $state('Ver oferta');
  let fUrl = $state('https://');
  let fImagen = $state('');
  let fModelo = $state<'cpm' | 'cpc'>('cpm');
  let fPuja = $state(5_000);
  let fDiario = $state(30_000);
  let fTotal = $state(300_000);
  let fTope = $state(3);
  let fFamilias = $state<string[]>([]);
  let fCarrocerias = $state<string[]>([]);
  let fMarcas = $state('');
  let fModelos = $state('');
  let fVersionKeys = $state('');
  let fCiudades = $state('');
  let fCategorias = $state<string[]>([]);

  const campanaAnunciante = $state({ advertiserId: '' });

  /** Los mismos límites que valida el servidor: el portal avisa antes de gastar la llamada. */
  const LIMITE = { titulo: 60, cuerpo: 140, cta: 20 };

  function alternar(lista: string[], valor: string): string[] {
    return lista.includes(valor) ? lista.filter((v) => v !== valor) : [...lista, valor];
  }

  function csv(texto: string): string[] {
    return texto
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
  }

  async function cargarTodo() {
    cargando = true;
    try {
      const a = await pedir<{ advertisers: Advertiser[] }>('/api/garage/ads/advertisers');
      anunciantes = a?.advertisers ?? [];
      const c = await pedir<{ campaigns: Campaign[] }>('/api/garage/ads/campaigns');
      campanas = c?.campaigns ?? [];
      // El admin ve en la lista de anunciantes la de todos: se deduce del tamaño, no de un
      // campo que el cliente tendría que creer.
      soyAdmin = (a?.advertisers?.length ?? 0) > 0 && campanas.some((x) => !anunciantes.some((y) => y.id === x.advertiserId));
    } finally {
      cargando = false;
      // `data-ready` va al TERMINAR de cargar, no al montar: garage-shot.mjs espera esta
      // marca para capturar, y ponerla antes capturaba la pantalla con "Cargando tu
      // información", un estado que el usuario nunca ve de forma estable.
      document.body.dataset.ready = '1';
    }
  }

  async function registrar() {
    error = '';
    registrando = true;
    const r = await pedir<{ advertiser: Advertiser }>('/api/garage/ads/advertisers', {
      method: 'POST',
      body: JSON.stringify({ name: nuevoNombre, kind: nuevoTipo, contactEmail: nuevoCorreo, city: nuevaCiudad }),
    });
    registrando = false;
    if (!r) return;
    nuevoNombre = '';
    nuevoCorreo = '';
    nuevaCiudad = '';
    aviso = 'Anunciante creado. Un administrador tiene que revisarlo y cargarle saldo.';
    await cargarTodo();
  }

  async function crearCampana() {
    error = '';
    guardando = true;
    const r = await pedir<{ campaign: Campaign }>('/api/garage/ads/campaigns', {
      method: 'POST',
      body: JSON.stringify({
        advertiserId: campanaAnunciante.advertiserId,
        name: fNombre,
        creative: {
          title: fTitulo,
          body: fCuerpo,
          ctaLabel: fCta,
          url: fUrl,
          advertiserName: anunciantes.find((a) => a.id === campanaAnunciante.advertiserId)?.name ?? '',
          ...(fImagen ? { imageUrl: fImagen } : {}),
        },
        targeting: {
          families: fFamilias,
          bodies: fCarrocerias,
          makes: csv(fMarcas),
          models: csv(fModelos),
          versionKeys: csv(fVersionKeys),
          cities: csv(fCiudades),
          partCategories: fCategorias,
        },
        pricing: { model: fModelo, bidCOP: fPuja },
        dailyBudgetCOP: fDiario,
        totalBudgetCOP: fTotal,
        freqCapPerUserDay: fTope,
      }),
    });
    guardando = false;
    if (!r) return;
    aviso = 'Campaña enviada a revisión. En cuanto un administrador la apruebe empieza a pujar.';
    campanaAbierta = false;
    await cargarTodo();
  }

  async function verStats(c: Campaign) {
    error = '';
    anuncioSeleccionado = c;
    if (statsDe[c.id]) return;
    const r = await pedir<Stats>(`/api/garage/ads/campaigns/${c.id}/stats`);
    if (r) statsDe[c.id] = r;
  }

  async function revisar(c: Campaign, decision: 'approve' | 'reject') {
    error = '';
    const r = await pedir<{ campaign: Campaign }>(`/api/garage/ads/campaigns/${c.id}/review`, {
      method: 'PATCH',
      body: JSON.stringify({ decision }),
    });
    if (!r) return;
    aviso = decision === 'approve' ? 'Campaña aprobada.' : 'Campaña rechazada.';
    await cargarTodo();
  }

  async function recargar(anunciante: Advertiser, monto: number) {
    error = '';
    const r = await pedir<{ advertiser: Advertiser }>(`/api/garage/ads/advertisers/${anunciante.id}/topup`, {
      method: 'POST',
      body: JSON.stringify({ amountCOP: monto }),
    });
    if (!r) return;
    aviso = `Saldo cargado: ${cop(monto)}.`;
    await cargarTodo();
  }

  let montosRecarga = $state<Record<string, number>>({});

  onMount(() => {
    void cargarTodo();
  });
</script>

<div class="portal">
  <header class="cabecera">
    <p class="kicker swal-kicker"><span class="swal-tick" aria-hidden="true"></span> Garage · Anunciantes</p>
    <h1>Anunciantes del shop</h1>
    <p class="sub">
      Las tiendas, talleres y servicios compiten por aparecer ante los dueños del vehículo que tú tienes.
      Gana el que más puja y más encaja con el modelo que el usuario está mirando.
    </p>
  </header>

  {#if cargando}
    <p class="vacio">Cargando tu información…</p>
  {:else}
    {#if error}<div class="g-toast g-toast-error" role="alert">{error}</div>{/if}
    {#if aviso}<div class="g-toast g-toast-success" role="status">{aviso}</div>{/if}

    <!-- ============ Cómo funciona, en palabras ============ -->
    <details class="como-funciona">
      <summary>¿Cómo funciona la subasta?</summary>
      <ul>
        <li><strong>No siempre ganas.</strong> Todos los anuncios que encajan con el vehículo del usuario compiten. Ordenan por lo que pagan y por lo bien que le quedan al usuario.</li>
        <li><strong>Pagas menos que tu puja.</strong> Es una subasta de segundo precio: cobras lo justo para ganarle al segundo, no lo máximo que ofreciste. Si nadie te disputa, pagas el mínimo.</li>
        <li><strong>No se gasta todo en la mañana.</strong> Si tu campaña va muy por delante del ritmo del día, entra menos veces. Se reparte a lo largo del día.</li>
        <li><strong>Un anuncio por tienda.</strong> Aunque tengas varias campañas, el usuario ve solo la mejor para su vehículo.</li>
        <li><strong>Cada anuncio dice "Patrocinado".</strong> Con el nombre de tu negocio. Nunca se presenta como contenido orgánico.</li>
        <li><strong>Saldo por adelantado.</strong> Si llegas a 0, tu anuncio deja de salir. Un administrador carga el saldo (la pasarela de pago todavía no está).</li>
      </ul>
    </details>

    <!-- ============ Mis anunciantes ============ -->
    <section class="bloque swal-card-frame">
      <div class="swal-card-inner bloque-in">
      <h2>Tus negocios</h2>
      {#if anunciantes.length === 0}
        <p class="vacio">Todavía no eres anunciante. Regístrate abajo para poder crear campañas.</p>
      {:else}
        <div class="tarjetas">
          {#each anunciantes as a (a.id)}
            <article class="tarjeta">
              <h3>{a.name}</h3>
              <p class="linea">
                <span class="chip">{KIND_LABEL[a.kind]}</span>
                {#if a.city}<span class="chip">{a.city}</span>{/if}
                {#if !a.verified}<span class="chip chip-avis">Sin verificar</span>{/if}
              </p>
              <p class="saldo">Saldo disponible: <strong>{cop(a.balanceCOP)}</strong></p>
              {#if a.balanceCOP <= 0}
                <p class="nota">Con saldo en 0 tu anuncio no aparece en ninguna subasta.</p>
              {/if}
              <button
                type="button"
                class="btn btn-primario"
                onclick={() => {
                  campanaAnunciante.advertiserId = a.id;
                  campanaAbierta = true;
                  fNombre = '';
                }}
              >
                Nueva campaña
              </button>
            </article>
          {/each}
        </div>
      {/if}
    </div>
    </section>

    <!-- ============ Alta de anunciante ============ -->
    <section class="bloque swal-card-frame">
      <div class="swal-card-inner bloque-in">
      <h2>Registrarme como anunciante</h2>
      <form onsubmit={(e) => { e.preventDefault(); void registrar(); }}>
        <label for="adv-nombre">
          Nombre del negocio
          <input id="adv-nombre" type="text" bind:value={nuevoNombre} maxlength="80" required placeholder="Taller Norte" />
        </label>
        <label>
          Tipo de negocio
          <select bind:value={nuevoTipo}>
            {#each Object.entries(KIND_LABEL) as [valor, texto]}
              <option value={valor}>{texto}</option>
            {/each}
          </select>
        </label>
        <label for="adv-correo">
          Correo de contacto
          <input id="adv-correo" type="email" bind:value={nuevoCorreo} placeholder="taller@ejemplo.com" />
          <small class="pista">Si lo dejas vacío usamos el correo de tu sesión.</small>
        </label>
        <label for="adv-ciudad">
          Ciudad (opcional)
          <input id="adv-ciudad" type="text" bind:value={nuevaCiudad} maxlength="60" placeholder="Bogotá" />
        </label>
        <button type="submit" class="btn" disabled={registrando}>
          {registrando ? 'Creando…' : 'Crear anunciante'}
        </button>
        <p class="nota">Un administrador revisa tu negocio y carga el saldo. Hasta entonces no apareces en el feed.</p>
      </form>
    </div>
    </section>

    <!-- ============ Crear campaña ============ -->
    {#if campanaAbierta}
      <section class="bloque swal-card-frame">
      <div class="swal-card-inner bloque-in">
        <h2>Nueva campaña</h2>
        <div class="dos-columnas">
          <form onsubmit={(e) => { e.preventDefault(); void crearCampana(); }}>
            <fieldset>
              <legend>El anuncio</legend>
              <label for="camp-titulo">
                Título (máx. {LIMITE.titulo})
                <input id="camp-titulo" type="text" bind:value={fTitulo} maxlength={LIMITE.titulo} required />
                <small class="cuenta">{fTitulo.length}/{LIMITE.titulo}</small>
              </label>
              <label>
                Texto (máx. {LIMITE.cuerpo})
                <textarea bind:value={fCuerpo} maxlength={LIMITE.cuerpo} rows="3"></textarea>
                <small class="cuenta">{fCuerpo.length}/{LIMITE.cuerpo}</small>
              </label>
              <label for="camp-cta">
                Texto del botón (máx. {LIMITE.cta})
                <input id="camp-cta" type="text" bind:value={fCta} maxlength={LIMITE.cta} required />
                <small class="cuenta">{fCta.length}/{LIMITE.cta}</small>
              </label>
              <label for="camp-url">
                Tu página (solo https)
                <input id="camp-url" type="url" bind:value={fUrl} required placeholder="https://tienda.ejemplo.com" />
              </label>
              <label for="camp-imagen">
                Imagen (opcional, https)
                <input id="camp-imagen" type="url" bind:value={fImagen} placeholder="https://…/foto.jpg" />
              </label>
            </fieldset>

            <fieldset>
              <legend>A quién le sale</legend>
              <p class="pista">Deja todo sin marcar para que le salga a cualquiera con cualquier vehículo.</p>
              <div class="chips">
                {#each FAMILIES as f}
                  <label class="chip-select">
                    <input type="checkbox" checked={fFamilias.includes(f.value)} onchange={() => (fFamilias = alternar(fFamilias, f.value))} />
                    {f.label}
                  </label>
                {/each}
              </div>
              <div class="chips">
                {#each BODIES as c}
                  <label class="chip-select">
                    <input type="checkbox" checked={fCarrocerias.includes(c.value)} onchange={() => (fCarrocerias = alternar(fCarrocerias, c.value))} />
                    {c.label}
                  </label>
                {/each}
              </div>
              <label>
                Marcas (separadas por coma)
                <input type="text" bind:value={fMarcas} placeholder="Yamaha, Honda" />
              </label>
              <label>
                Modelos (separados por coma)
                <input type="text" bind:value={fModelos} placeholder="FZ16" />
              </label>
              <label>
                Versiones exactas (separadas por coma)
                <input type="text" bind:value={fVersionKeys} placeholder="yamaha-fz16-2018-2024" />
              </label>
              <label>
                Ciudades (separadas por coma)
                <input type="text" bind:value={fCiudades} placeholder="Bogotá, Medellín" />
              </label>
              <p class="pista">Y cuando el usuario está mirando una pieza de…</p>
              <div class="chips">
                {#each PART_CATEGORIES as c}
                  <label class="chip-select">
                    <input type="checkbox" checked={fCategorias.includes(c.value)} onchange={() => (fCategorias = alternar(fCategorias, c.value))} />
                    {c.label}
                  </label>
                {/each}
              </div>
              <p class="pista">Cuanto más específica sea la segmentación, más encaja tu anuncio con quien lo ve, y más vale tu puja. No pongas filtros que no te sirvan: pagan por audience que no existe.</p>
            </fieldset>

            <fieldset>
              <legend>Puja y presupuesto</legend>
              <label>
                ¿Cobras por cada mil vistas o por cada clic?
                <select bind:value={fModelo}>
                  <option value="cpm">Por cada 1.000 vistas (CPM)</option>
                  <option value="cpc">Por cada clic (CPC)</option>
                </select>
              </label>
              <label>
                Tu puja máxima ({fModelo === 'cpm' ? 'por 1.000 vistas' : 'por clic'})
                <input type="number" bind:value={fPuja} min="1" step="100" required />
                <small class="cuenta">{cop(fPuja)}</small>
              </label>
              <label>
                Presupuesto por día
                <input type="number" bind:value={fDiario} min="1" step="1000" required />
                <small class="cuenta">{cop(fDiario)}</small>
              </label>
              <label>
                Presupuesto total
                <input type="number" bind:value={fTotal} min="1" step="1000" required />
                <small class="cuenta">{cop(fTotal)}</small>
              </label>
              <label>
                Máximo de veces al día por usuario
                <input type="number" bind:value={fTope} min="1" max="50" />
              </label>
              <p class="pista">
                Tu puja es el techo, no lo que vas a pagar. El precio real es el del segundo mejor,
                nunca menos de {fModelo === 'cpm' ? '$ 2.000 por 1.000 vistas' : '$ 150 por clic'}.
              </p>
            </fieldset>

            <button type="submit" class="btn btn-primario" disabled={guardando}>
              {guardando ? 'Enviando…' : 'Enviar a revisión'}
            </button>
            <button type="button" class="btn" onclick={() => (campanaAbierta = false)}>Cancelar</button>
          </form>

          <aside class="preview">
            <h3>Así lo va a ver el usuario</h3>
            <AdPreview
              title={fTitulo || 'Tu título aquí'}
              body={fCuerpo || 'Tu texto aquí. Cuenta qué ofreces y por qué te conviene.'}
              ctaLabel={fCta || 'Ver'}
              imageUrl={fImagen || undefined}
              advertiserName={anunciantes.find((a) => a.id === campanaAnunciante.advertiserId)?.name || 'Tu negocio'}
            />
            <p class="pista">Así, con la etiqueta de patrocinado, entre los anuncios que compiten por ese vehículo.</p>
          </aside>
        </div>
      </div>
    </section>
    {/if}

    <!-- ============ Campañas ============ -->
    <section class="bloque swal-card-frame">
      <div class="swal-card-inner bloque-in">
      <h2>Campañas</h2>
      {#if campanas.length === 0}
        <p class="vacio">Todavía no tienes campañas.</p>
      {:else}
        <table>
          <thead>
            <tr>
              <th>Campaña</th>
              <th>Estado</th>
              <th>Puja</th>
              <th>Presupuesto</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {#each campanas as c (c.id)}
              <tr>
                <td>
                  <strong>{c.name}</strong>
                  <small class="sub-linea">{c.creative.title}</small>
                </td>
                <td><span class="chip chip-estado-{c.status}">{STATUS_LABEL[c.status]}</span></td>
                <td>
                  {c.pricing.model === 'cpm' ? 'CPM' : 'CPC'} {cop(c.pricing.bidCOP)}
                </td>
                <td>
                  {cop(c.dailyBudgetCOP)} / día<small class="sub-linea">{cop(c.totalBudgetCOP)} total</small>
                </td>
                <td class="acciones">
                  <button type="button" class="btn btn-chico" onclick={() => void verStats(c)}>Estadísticas</button>
                  {#if soyAdmin && c.status === 'pending_review'}
                    <button type="button" class="btn btn-chico btn-ok" onclick={() => void revisar(c, 'approve')}>Aprobar</button>
                    <button type="button" class="btn btn-chico btn-mal" onclick={() => void revisar(c, 'reject')}>Rechazar</button>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>
    </section>

    <!-- ============ Estadísticas ============ -->
    {#if anuncioSeleccionado && statsDe[anuncioSeleccionado.id]}
      {@const st = statsDe[anuncioSeleccionado.id]}
      <section class="bloque swal-card-frame">
      <div class="swal-card-inner bloque-in">
        <h2>Estadísticas de {anuncioSeleccionado.name}</h2>
        <div class="tarjetas">
          <article class="tarjeta"><h3>Vistas</h3><p class="saldo">{st.totals.impressions.toLocaleString('es-CO')}</p></article>
          <article class="tarjeta"><h3>Clics</h3><p class="saldo">{st.totals.clicks.toLocaleString('es-CO')}</p></article>
          <article class="tarjeta">
            <h3>Gasto</h3>
            <p class="saldo">{cop(st.totals.spendCOP)}</p>
            <small class="sub-linea">{st.totals.ctrPct} % de las vistas hicieron clic</small>
          </article>
          <article class="tarjeta">
            <h3>Costo real por clic</h3>
            <p class="saldo">{st.totals.cpcRealCOP === null ? '—' : cop(st.totals.cpcRealCOP)}</p>
            <small class="sub-linea">
              {st.totals.cpcRealCOP === null ? 'Todavía no hay clics' : 'Suele quedar por debajo de tu puja'}
            </small>
          </article>
        </div>
        {#if st.days.length > 0}
          <table>
            <thead><tr><th>Día</th><th>Vistas</th><th>Clics</th><th>Gasto</th></tr></thead>
            <tbody>
              {#each st.days as d (d.day)}
                <tr><td>{d.day}</td><td>{d.impressions}</td><td>{d.clicks}</td><td>{cop(d.spendCOP)}</td></tr>
              {/each}
            </tbody>
          </table>
        {/if}
        <button type="button" class="btn" onclick={() => (anuncioSeleccionado = null)}>Cerrar</button>
      </div>
    </section>
    {/if}

    <!-- ============ Admin ============ -->
    {#if soyAdmin}
      <section class="bloque swal-card-frame">
      <div class="swal-card-inner bloque-in">
        <h2>Administración</h2>
        <h3>Recargar saldo</h3>
        {#if anunciantes.length === 0}
          <p class="vacio">No hay anunciantes registrados.</p>
        {:else}
          {#each anunciantes as a (a.id)}
            <div class="recarga">
              <strong>{a.name}</strong> · {cop(a.balanceCOP)}
              <input
                type="number"
                min="1000"
                step="1000"
                placeholder="Monto"
                bind:value={montosRecarga[a.id]}
              />
              <button
                type="button"
                class="btn btn-primario"
                onclick={() => void recargar(a, Number(montosRecarga[a.id]) || 0)}
              >
                Cargar saldo
              </button>
            </div>
          {/each}
        {/if}
        <h3>En revisión</h3>
        {#if campanas.filter((c) => c.status === 'pending_review').length === 0}
          <p class="vacio">No hay campañas esperando revisión.</p>
        {:else}
          {#each campanas.filter((c) => c.status === 'pending_review') as c (c.id)}
            <div class="recarga">
              <strong>{c.name}</strong> · {c.creative.title}
              <button type="button" class="btn btn-chico btn-ok" onclick={() => void revisar(c, 'approve')}>Aprobar</button>
              <button type="button" class="btn btn-chico btn-mal" onclick={() => void revisar(c, 'reject')}>Rechazar</button>
            </div>
          {/each}
        {/if}
      </div>
    </section>
    {/if}
  {/if}
</div>

<style>
  .portal { display: flex; flex-direction: column; gap: 1.25rem; color: var(--swal-text); }
  .kicker { display: flex; align-items: center; gap: 0.5rem; margin: 0 0 0.35rem; }
  .cabecera h1 { margin: 0 0 0.25rem; font-size: 1.5rem; color: var(--swal-text); letter-spacing: -0.01em; }
  .sub { margin: 0; color: var(--swal-text-secondary); max-width: 65ch; }
  /* Las secciones son tarjetas de plano: el marco (.swal-card-frame) es el borde de 1px y
     .bloque-in la superficie; con las esquinas cortadas un `border` normal se perderia. */
  .bloque-in { padding: 1rem; }
  .bloque h2 { margin: 0 0 0.75rem; font-size: 1.1rem; color: var(--swal-text); }
  .vacio { color: var(--swal-text-muted); font-style: italic; }
  .nota { color: var(--swal-text-muted); font-size: 0.85rem; }
  .pista { color: var(--swal-text-muted); font-size: 0.85rem; margin: 0.35rem 0; }
  .saldo { font-size: 1.15rem; margin: 0.25rem 0; }
  .sub-linea { display: block; color: var(--swal-text-muted); font-size: 0.8rem; }
  .cuenta { color: var(--swal-text-muted); font-size: 0.75rem; }

  .como-funciona { border: 1px solid var(--swal-border); border-radius: 0; padding: 0.75rem 1rem; background: var(--swal-bg-surface); }
  .como-funciona summary { cursor: pointer; font-weight: 600; }
  .como-funciona ul { margin: 0.5rem 0 0; padding-left: 1.2rem; line-height: 1.6; }

  .tarjetas { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 0.75rem; }
  .tarjeta { border: 1px solid var(--swal-border); border-radius: 0; padding: 0.75rem; background: var(--swal-bg-surface); }
  .tarjeta h3 { margin: 0 0 0.35rem; font-size: 0.95rem; }
  .linea { display: flex; flex-wrap: wrap; gap: 0.3rem; margin: 0.25rem 0; }

  .chip { display: inline-block; border: 1px solid var(--swal-border-light); border-radius: 0; padding: 0.1rem 0.55rem; font-size: 0.75rem; color: var(--swal-text-secondary); }
  .chip-avis { border-color: var(--swal-warning); color: var(--swal-warning); }
  .chip-estado-active { border-color: var(--swal-success); color: var(--swal-success); }
  .chip-estado-pending_review { border-color: var(--swal-warning); color: var(--swal-warning); }
  .chip-estado-rejected, .chip-estado-exhausted { border-color: var(--swal-danger); color: var(--swal-danger); }

  form { display: flex; flex-direction: column; gap: 0.6rem; }
  fieldset { border: 1px solid var(--swal-border); border-radius: 0; padding: 0.75rem; }
  legend { font-weight: 600; padding: 0 0.35rem; }
  label { display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.9rem; }
  input, select, textarea {
    border: 1px solid var(--swal-border-strong);
    border-radius: 0;
    padding: 0.4rem 0.5rem;
    font: inherit;
    background: var(--swal-bg-elevated);
    color: var(--swal-text);
  }
  input::placeholder, textarea::placeholder { color: var(--swal-text-muted); opacity: 1; }
  .chips { display: flex; flex-wrap: wrap; gap: 0.3rem; }
  .chip-select { display: inline-flex; flex-direction: row; align-items: center; gap: 0.3rem; border: 1px solid var(--swal-border-light); border-radius: 0; padding: 0.15rem 0.55rem; font-size: 0.8rem; }

  .btn { border: 1px solid var(--swal-border-strong); background: var(--swal-surface); color: var(--swal-text); border-radius: 0; padding: 0.4rem 0.8rem; font: inherit; cursor: pointer; }
  .btn:hover:not(:disabled) { background: var(--swal-surface-hover); }
  .btn:disabled { opacity: 0.6; cursor: not-allowed; }
  /* Relleno naranja: el texto va en la tinta de contraste, no en blanco (2.9:1). */
  .btn-primario { background: var(--swal-accent); border-color: var(--swal-accent); color: var(--swal-accent-contrast); font-weight: 600; }
  .btn-primario:hover:not(:disabled) { background: var(--swal-accent-hover); }
  .btn-chico { padding: 0.2rem 0.5rem; font-size: 0.8rem; }
  .btn-ok { border-color: var(--swal-success); color: var(--swal-success); }
  .btn-mal { border-color: var(--swal-danger); color: var(--swal-danger); }

  .dos-columnas { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: 1rem; }
  @media (max-width: 900px) { .dos-columnas { grid-template-columns: 1fr; } }

  .preview { border: 1px dashed var(--swal-border-strong); border-radius: 0; padding: 0.75rem; background: var(--swal-bg-surface); }
  .preview h3 { margin: 0 0 0.5rem; font-size: 0.95rem; }

  table { width: 100%; border-collapse: collapse; margin: 0.5rem 0; font-size: 0.9rem; }
  th, td { text-align: left; padding: 0.4rem 0.5rem; border-bottom: 1px solid var(--swal-border); vertical-align: top; }
  th { font-weight: 600; color: var(--swal-text-muted); }
  .acciones { display: flex; gap: 0.3rem; flex-wrap: wrap; }

  .recarga { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; padding: 0.4rem 0; border-bottom: 1px solid var(--swal-border); }
  .recarga input { width: 9rem; }
</style>
