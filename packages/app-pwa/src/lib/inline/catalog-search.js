/**
 * catalog-search.js — script de src/pages/fleet/catalog.astro (buscador de modelos y
 * calculadora del proximo servicio).
 *
 * Vive en su propio fichero, en vez de dentro del .astro, para que su TEXTO sea una
 * constante hasheable: la CSP de la app lleva el SHA-256 de este contenido (src/lib/csp.ts).
 * El `define:vars` que habia antes interpola los datos de la request (el catalogo entero,
 * el locale del mercado, las etiquetas) dentro del propio script, asi que su hash no existe
 * hasta que la pagina se renderiza: con una CSP sin `'unsafe-inline'` el buscador y la
 * calculadora quedaban muertos.
 *
 * Los datos siguen llegando igual, pero por un `<script type="application/json"
 * data-catalog-config>` que emite la pagina: ese bloque NO se ejecuta (no le aplica
 * `script-src`) y este fichero se queda estatico. Se lee aqui, al ejecutarse, para que con
 * navegacion del ClientRouter los datos sean los de la pagina recien pintada.
 */

function initCatalog(__cfg) {
  var catalogJson = __cfg.catalogJson;
  var marketLocale = __cfg.marketLocale;
  var soapLabel = __cfg.soapLabel;
  var rtLabel = __cfg.rtLabel;


  // SPA-safe (ViewTransitions): re-vincula en cada astro:page-load.
  // Guard por elemento (no global: al volver por SPA el DOM es nuevo).
    const searchInput = document.getElementById('catalog-search');
    if (!searchInput || searchInput.dataset.bound) return;
    searchInput.dataset.bound = '1';
  const results = document.getElementById('catalog-results');
  if (searchInput && results) {
    searchInput.addEventListener('input', () => {
      const q = searchInput.value.toLowerCase().trim();
      const makes = results.querySelectorAll('.make-block');
      makes.forEach((make) => {
        let visible = 0;
        make.querySelectorAll('.model-card').forEach((card) => {
          const match = card.dataset.model?.toLowerCase().includes(q) || make.dataset.make?.toLowerCase().includes(q);
          card.style.display = match ? '' : 'none';
          if (match) visible++;
        });
        make.style.display = visible > 0 || q === '' ? '' : 'none';
      });
    });
  }

  // Calculadora de próximo servicio
  const calcMake = document.getElementById('calc-make');
  const calcModel = document.getElementById('calc-model');
  const calcKm = document.getElementById('calc-km');
  const calcResult = document.getElementById('calc-result');

  // Hydrate model options from server-rendered data via JSON
  // catalogJson viene serializado en el frontmatter e inyectado vía define:vars
  const catalogData = JSON.parse(catalogJson);

  if (calcMake && calcModel && calcKm && calcResult) {
    function updateModels() {
      const make = calcMake.value;
      const found = catalogData.find((m) => m.name === make);
      calcModel.innerHTML = found ? found.models.map((md) => `<option value="${md.model}">${md.model}</option>`).join('') : '';
      updateResult();
    }

    function updateResult() {
      const km = parseInt(calcKm.value || '0', 10);
      if (!km || km <= 0) {
        calcResult.className = 'calc-result';
        calcResult.textContent = '';
        return;
      }
      const make = calcMake.value;
      const model = calcModel.value;
      const found = catalogData.find((m) => m.name === make);
      const md = found?.models.find((md) => md.model === model);
      if (!md) return;

      const nextRev = Math.ceil(km / md.revisionPeriodKm) * md.revisionPeriodKm + md.revisionPeriodKm;
      const remainingRev = nextRev - km;
      const nextOil = Math.ceil(km / md.oilChangeKm) * md.oilChangeKm + md.oilChangeKm;
      const remainingOil = nextOil - km;
      const soat = md.soatDefaultCOP;
      const tecno = md.tecnoManualCOP;

      calcResult.className = remainingRev < 0 || remainingOil < 0 ? 'calc-result active overdue' : 'calc-result active';
      // Formato con el locale del mercado (es-CL) y los nombres de documento del mercado.
      const num = (n) => n.toLocaleString(marketLocale);
      const money = (n) => `$${n.toLocaleString(marketLocale)}`;
      calcResult.innerHTML = `
        <div class="calc-grid">
          <div><strong>Próxima revisión:</strong> <span style="color: var(--swal-accent-text)">${num(nextRev)} km</span>
            <br/><small style="color: var(--swal-text-faint)">${remainingRev < 0 ? `⚠️ VENCIDO hace ${num(Math.abs(remainingRev))} km` : `faltan ${num(remainingRev)} km`}</small></div>
          <div><strong>Próx. cambio aceite:</strong> <span style="color: var(--swal-accent-text)">${num(nextOil)} km</span>
            <br/><small style="color: var(--swal-text-faint)">${remainingOil < 0 ? `⚠️ VENCIDO hace ${num(Math.abs(remainingOil))} km` : `faltan ${num(remainingOil)} km`}</small></div>
          <div><strong>${soapLabel} est.:</strong> <span style="color: var(--swal-accent-text)">${money(soat)}</span></div>
          <div><strong>${rtLabel}:</strong> <span style="color: var(--swal-accent-text)">${money(tecno)}</span></div>
        </div>
      `;
    }

    calcMake.addEventListener('change', updateModels);
    calcKm.addEventListener('input', updateResult);
    updateResult();
  }
  } // initCatalog

/** Re-inicializa el buscador con los datos de la pagina pintada. Idempotente. */
function initAllCatalog() {
  var bloque = document.querySelector('script[type="application/json"][data-catalog-config]');
  if (!bloque) return;
  try {
    initCatalog(JSON.parse(bloque.textContent));
  } catch (e) {
    /* config ilegible: el buscador se queda sin datos, pero la pagina no se rompe */
  }
}

document.addEventListener('astro:page-load', initAllCatalog);
initAllCatalog();
