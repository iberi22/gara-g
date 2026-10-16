/**
 * generic-table.js — script de GenericTableAstro.astro (buscador y exportacion CSV RFC4180
 * de las tablas server-rendered).
 *
 * Vive en su propio fichero, en vez de dentro del .astro, para que su TEXTO sea una
 * constante hasheable: la CSP de la app lleva el SHA-256 de este contenido (src/lib/csp.ts).
 * El `define:vars` que habia antes interpola los datos de la request dentro del propio
 * script, asi que su hash no existe hasta que la pagina se renderiza y ninguna politica
 * puede permitirlo: con una CSP sin `'unsafe-inline'` el buscador y el CSV de TODAS las
 * tablas de la app morian en silencio (y con `'unsafe-inline'` la CSP no sirve de nada).
 *
 * Los datos siguen llegando igual, pero por un `<script type="application/json"
 * data-gtable-config>` que emite el componente: ese bloque NO se ejecuta (no le aplica
 * `script-src`) y este fichero se queda estatico. Se lee aqui, en el momento de
 * ejecutarse, para que con navegacion del ClientRouter —el script se re-crea y se
 * re-ejecuta en el documento nuevo— los datos sean los de la pagina recien pintada.
 */

function initTable(__cfg) {
  var testId = __cfg.testId;
  var pagedRows = __cfg.pagedRows;
  var columns = __cfg.columns;
  var rows = __cfg.rows;
  var entity = __cfg.entity;
  var instanceId = __cfg.instanceId;


  // SPA-safe (ViewTransitions).
  //
  // El script es `is:inline` —necesita el texto literal para que la CSP pueda
  // hashearlo—, asi que el navegador lo ejecuta UNA vez por documento. Con el
  // ClientRouter, `document` sobrevive a la navegacion pero los nodos se
  // sustituyen: por eso se re-enlaza en `astro:page-load` (ver el final del
  // fichero) y no solo en la carga.
  //
  // Los guards `data-bound` evitan que esta función se ejecute dos veces sobre
  // el mismo DOM, que duplicaría los listeners. Es el patrón de EntityForm.astro.
    // Filter behavior
    const input = document.getElementById(`${testId}-search`);
    if (input && !input.hasAttribute('data-bound')) {
      input.setAttribute('data-bound', '1');
      input.addEventListener('input', () => {
        const q = input.value.toLowerCase().trim();
        const tbody = document.querySelector(`[data-testid="${testId}"] tbody`);
        if (!tbody) return;
        let visible = 0;
        tbody.querySelectorAll('tr[data-row-id]').forEach((tr) => {
          // Fila entera, sin la celda de acciones (sus iconos no son datos).
          const clone = tr.cloneNode(true);
          clone.querySelectorAll('.g-actions-cell').forEach((c) => c.remove());
          const val = (clone.textContent || '').toLowerCase();
          const show = !q || val.includes(q);
          (tr).style.display = show ? '' : 'none';
          if (show) visible++;
        });
        const noMatch = tbody.querySelector('tr.g-no-match');
        if (noMatch) noMatch.hidden = !(q && visible === 0);
        const count = document.querySelector(`[data-testid="${testId}-count"]`);
        if (count) {
          count.textContent = q
            ? `${visible} de ${pagedRows} resultado${pagedRows !== 1 ? 's' : ''} filtrado${visible !== 1 ? 's' : ''}`
            : `${pagedRows} resultado${pagedRows !== 1 ? 's' : ''}`;
        }
      });
    }

    // Client-side CSV export function
    function escapeCSVCell(val, delimiter) {
      if (val === null || val === undefined) return '';
      let str = typeof val === 'object' ? JSON.stringify(val) : String(val);
      const needsQuotes = str.includes(delimiter) || str.includes('"') || str.includes('\n') || str.includes('\r');
      return needsQuotes ? `"${str.replace(/"/g, '""')}"` : str;
    }

    const exportBtn = document.getElementById(`${testId}-export-btn`);
    if (exportBtn && !exportBtn.hasAttribute('data-bound')) {
      exportBtn.setAttribute('data-bound', '1');
      exportBtn.addEventListener('click', () => {
        const delimiter = ';';
        // Filter rows based on active search input across all columns and values
        // Script con define:vars: va tal cual al navegador, sin TypeScript (un `as` rompia
        // el script entero y con el la busqueda y el CSV de todas las tablas).
        const search = document.getElementById(`${testId}-search`);
        const q = search ? search.value.toLowerCase().trim() : '';
        const visibleRows = q
          ? rows.filter((r) =>
              columns.some((col) => String(r[col.key] ?? '').toLowerCase().includes(q)) ||
              Object.values(r).some((v) => String(v ?? '').toLowerCase().includes(q))
            )
          : rows;

        const header = columns.map((col) => escapeCSVCell(col.label, delimiter)).join(delimiter);
        const dataLines = visibleRows.map((r) =>
          columns.map((col) => escapeCSVCell(r[col.key], delimiter)).join(delimiter)
        );

        const csvContent = '\uFEFF' + [header, ...dataLines].join('\r\n');
        const filename = `${entity || 'export'}_${instanceId}.csv`;

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      });
    }
  }

/**
 * Inicializa todas las tablas de la pagina. Se vuelve a llamar en cada `astro:page-load`
 * porque con el ClientRouter el DOM es nuevo (hoy hay una tabla por pagina, pero el
 * recorrido cubre el caso de varias).
 */
function initAllTables() {
  var bloques = document.querySelectorAll('script[type="application/json"][data-gtable-config]');
  for (var i = 0; i < bloques.length; i++) {
    try {
      initTable(JSON.parse(bloques[i].textContent));
    } catch (e) {
      /* config ilegible: la tabla se queda sin buscador, pero la pagina no se rompe */
    }
  }
}

document.addEventListener('astro:page-load', initAllTables);
initAllTables();
