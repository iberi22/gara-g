
  // Vanilla sin imports: Astro inlinea este script en el HTML (sin submódulo
  // `?astro&type=script`), que es lo que workerd-dev falla en resolver
  // intermitentemente (952). Lógica espejo de lib/interfaceManager.ts:
  // MODES, localStorage 'gara_interface_mode' + cookie, gate ?game_enabled,
  // badge socio (tier default 'payg' → true salvo demo flag 'false').
  var INTERFACE_MODES = ['admin', 'aui', 'game'];
  var STORAGE_KEY = 'gara_interface_mode';
  var DEMO_SOCIO_KEY = 'gara_demo_socio';

  function isSocioInline() {
    try {
      var demoVal = window.localStorage.getItem(DEMO_SOCIO_KEY);
      if (demoVal === 'false') return false;
    } catch (e) {}
    return true; // tier default 'payg' → socio
  }

  function gameAllowedFromQuery() {
    try {
      var q = new URLSearchParams(window.location.search).get('game_enabled');
      if (q === null || q === '') return null;
      q = q.toLowerCase().trim();
      if (q === 'false' || q === '0') return false;
      if (q === 'true' || q === '1') return true;
    } catch (e) {}
    return null;
  }

  function dispatchToast(message, title, type) {
    window.dispatchEvent(
      new CustomEvent('gara-toast', {
        detail: { id: 'toast-' + Date.now(), message: message, title: title, type: type || 'info', duration: 4000 },
      })
    );
  }

  function initSwitcher() {
    document
      .querySelectorAll('.interface-switcher:not([data-bound])')
      .forEach(function (root) {
        root.dataset.bound = '1';
        var gameBtn = root.querySelector('[data-testid="switch-btn-game"]');
        var attrAllowed = gameBtn ? gameBtn.getAttribute('data-game-allowed') : null;
        var queryAllowed = gameAllowedFromQuery();
        var gameAllowed =
          attrAllowed !== null ? attrAllowed === 'true' : queryAllowed !== null ? queryAllowed : true;

        // Sync badge del tier (solo cliente): el nombre sale del atributo, no de un literal.
        var badge = root.querySelector('[data-testid="socio-badge"]');
        if (badge && isSocioInline()) {
          badge.textContent = badge.getAttribute('data-tier-label') || 'PAYG';
          badge.classList.add('socio');
        }

        root.querySelectorAll('[data-mode]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var mode = btn.getAttribute('data-mode');
            if (!mode || INTERFACE_MODES.indexOf(mode) === -1) return;
            if (mode === 'game' && !gameAllowed) {
              dispatchToast(
                'El modo Videojuego (Garaje NFS) está desactivado por configuración (GAME_UI_ENABLED=false).',
                'Modo no disponible',
                'warning'
              );
              return;
            }
            try {
              window.localStorage.setItem(STORAGE_KEY, mode);
            } catch (e) {}
            document.cookie = STORAGE_KEY + '=' + encodeURIComponent(mode) + '; path=/; max-age=31536000; SameSite=Lax';
            if (mode === 'admin') window.location.href = '/fleet';
            else if (mode === 'aui') window.location.href = '/fleet/aui';
            else if (mode === 'game') window.location.href = '/fleet/garage';
          });
        });
      });
  }

  document.addEventListener('astro:page-load', initSwitcher);
  initSwitcher();
