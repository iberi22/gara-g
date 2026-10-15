
  // SPA-safe (ViewTransitions): el drawer se reinicia en cada navegacion.
  //
  // Este script es de modulo, asi que sin el listener de abajo se ejecutaria
  // UNA vez. Con el ClientRouter de Astro, `document` sobrevive a la
  // navegacion pero los nodos del layout se sustituyen: los listeners
  // atados al antiguo DOM quedan apuntando a nodos que ya no existen y el
  // hamburguesa deja de abrir el menu en cuanto el usuario navega una vez.
  //
  // `astro:page-load` es el evento correcto y el patron que ya usan
  // ToastContainer.astro, InterfaceSwitcher.astro y notifications/index.astro.
  var MOBILE_MQ = '(max-width: 767px)';

  function sidebarIsOpen() {
    var shell = document.querySelector('.fleet-shell');
    return !!shell && shell.getAttribute('data-sidebar-open') === 'true';
  }

  // Cerrado en movil, el drawer sigue en el DOM (solo desplazado fuera de pantalla): `inert`
  // saca sus enlaces de la tabulacion y del arbol de accesibilidad. En escritorio es la barra
  // fija y nunca es inert.
  function syncSidebarInert() {
    var sidebar = document.querySelector('.fleet-sidebar');
    if (!sidebar) return;
    var mobile = window.matchMedia(MOBILE_MQ).matches;
    sidebar.inert = mobile && !sidebarIsOpen();
  }

  // opts.focus: devolver el foco al hamburguesa (cierre por teclado/boton). Al cerrar porque se
  // navega no se roba el foco al enlace que el usuario acaba de pulsar.
  function setSidebar(open, opts) {
    var shell = document.querySelector('.fleet-shell');
    if (!shell) return;
    var hamburger = document.querySelector('[data-testid="hamburger"]');
    var closeBtn = document.querySelector('[data-testid="sidebar-close"]');
    shell.setAttribute('data-sidebar-open', open ? 'true' : 'false');
    if (hamburger) hamburger.setAttribute('aria-expanded', open ? 'true' : 'false');
    document.body.style.overflow = open ? 'hidden' : '';
    syncSidebarInert();
    if (open) {
      if (closeBtn) closeBtn.focus({ preventScroll: true });
    } else if (opts && opts.focus && hamburger) {
      hamburger.focus({ preventScroll: true });
    }
  }

  function initSidebar() {
    var hamburger = document.querySelector('[data-testid="hamburger"]');
    var closeBtn = document.querySelector('[data-testid="sidebar-close"]');
    var backdrop = document.querySelector('[data-testid="sidebar-backdrop"]');

    // El guard evita duplicar listeners si `initSidebar` se llama dos veces
    // sobre el mismo DOM (ClientRouter dispara page-load tambien en el
    // before-swap de una navegacion que se cancela).
    if (hamburger && !hamburger.hasAttribute('data-bound')) {
      hamburger.setAttribute('data-bound', '1');
      hamburger.addEventListener('click', function () { setSidebar(true); });
    }
    if (closeBtn && !closeBtn.hasAttribute('data-bound')) {
      closeBtn.setAttribute('data-bound', '1');
      closeBtn.addEventListener('click', function () { setSidebar(false, { focus: true }); });
    }
    if (backdrop && !backdrop.hasAttribute('data-bound')) {
      backdrop.setAttribute('data-bound', '1');
      backdrop.addEventListener('click', function () { setSidebar(false, { focus: true }); });
    }

    // Cerrar al navegar (mobile UX), sin mover el foco
    document.querySelectorAll('.nav-item').forEach(function (link) {
      if (link.hasAttribute('data-bound')) return;
      link.setAttribute('data-bound', '1');
      link.addEventListener('click', function () {
        if (window.innerWidth < 768) setSidebar(false);
      });
    });

    syncSidebarInert();
  }

  // Los listeners globales se registran una sola vez (este script puede evaluarse de nuevo):
  // leen el estado actual del DOM, no un nodo capturado.
  if (!window.__garaSidebarGlobals) {
    window.__garaSidebarGlobals = true;

    document.addEventListener('keydown', function (e) {
      if (!sidebarIsOpen()) return;
      if (e.key === 'Escape') {
        setSidebar(false, { focus: true });
        return;
      }
      // Trampa de foco: con el drawer abierto, Tab y Shift+Tab ciclan dentro de el.
      if (e.key === 'Tab') {
        var sidebar = document.querySelector('.fleet-sidebar');
        if (!sidebar) return;
        var items = Array.prototype.filter.call(
          sidebar.querySelectorAll('a[href], button:not([disabled])'),
          function (el) { return el.offsetParent !== null || el === document.activeElement; }
        );
        if (!items.length) return;
        var first = items[0];
        var last = items[items.length - 1];
        var active = document.activeElement;
        if (!sidebar.contains(active)) {
          e.preventDefault();
          first.focus();
        } else if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    });

    // Al pasar a escritorio con el drawer abierto, se cierra; el inert se recalcula.
    window.matchMedia(MOBILE_MQ).addEventListener('change', function (ev) {
      if (!ev.matches && sidebarIsOpen()) setSidebar(false);
      else syncSidebarInert();
    });

    // Skeleton: solo aparece (superpuesta, sin empujar el contenido) mientras el router
    // carga la pagina siguiente; se quita al terminar la preparacion o al cargar.
    document.addEventListener('astro:before-preparation', function () {
      var sk = document.querySelector('[data-testid="loading-skeleton"]');
      if (sk) sk.classList.add('pending');
    });
    document.addEventListener('astro:after-preparation', function () {
      var sk = document.querySelector('[data-testid="loading-skeleton"]');
      if (sk) sk.classList.remove('pending');
    });
  }

  // Aviso de modo local: se descarta por sesion de pestaña (sessionStorage). El nodo del
  // layout se sustituye en cada navegacion, asi que se re-aplica en cada page-load.
  var GUEST_BANNER_KEY = 'gara:guest-banner-closed';
  function initGuestBanner() {
    var banner = document.querySelector('[data-testid="guest-banner"]');
    if (!banner) return;
    var closed = false;
    try { closed = sessionStorage.getItem(GUEST_BANNER_KEY) === '1'; } catch (e) {}
    if (closed) { banner.setAttribute('hidden', ''); return; }
    var btn = banner.querySelector('[data-testid="guest-banner-close"]');
    if (btn && !btn.hasAttribute('data-bound')) {
      btn.setAttribute('data-bound', '1');
      btn.addEventListener('click', function () {
        try { sessionStorage.setItem(GUEST_BANNER_KEY, '1'); } catch (e) {}
        banner.setAttribute('hidden', '');
      });
    }
  }

  // Aviso de sin conexion: se recalcula en cada page-load porque el nodo del
  // layout se sustituye con el ClientRouter, pero `navigator.onLine` y <html>
  // sobreviven. `data-bound` evita duplicar los listeners online/offline.
  function syncOfflineBanner() {
    document.documentElement.setAttribute('data-offline', navigator.onLine ? '0' : '1');
  }
  function initOfflineBanner() {
    syncOfflineBanner();
    if (!window.__garaOfflineBound) {
      window.__garaOfflineBound = true;
      window.addEventListener('online', syncOfflineBanner);
      window.addEventListener('offline', syncOfflineBanner);
    }
  }

  // Logout: purga la cache del service worker (incluido el HTML de las rutas)
  // antes de que la cookie de sesion se borre, para que el siguiente usuario de
  // este navegador no abra offline el panel del anterior.
  function initLogoutPurge() {
    var form = document.querySelector('form[action="/api/auth/logout"]');
    if (!form || form.hasAttribute('data-bound')) return;
    form.setAttribute('data-bound', '1');
    form.addEventListener('submit', function () {
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage('PURGE_CACHES');
      }
    });
  }

  document.addEventListener('astro:page-load', initSidebar);
  document.addEventListener('astro:page-load', initGuestBanner);
  document.addEventListener('astro:page-load', initOfflineBanner);
  document.addEventListener('astro:page-load', initLogoutPurge);
  initSidebar();
  initGuestBanner();
  initOfflineBanner();
  initLogoutPurge();
