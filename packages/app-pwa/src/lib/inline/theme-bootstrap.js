
  (function () {
    var KEY = 'swal:theme-mode';
    var THEMES = { light: 'taller', dark: 'taller-dark' };
    var media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

    function read() {
      try {
        var v = localStorage.getItem(KEY);
        if (v === 'light' || v === 'dark' || v === 'system') return v;
      } catch (e) {}
      return 'light';
    }
    function resolve(mode) {
      if (mode === 'system') return media && media.matches ? 'dark' : 'light';
      return mode;
    }
    function apply(mode) {
      var resolved = resolve(mode);
      var root = document.documentElement;
      root.setAttribute('data-theme', THEMES[resolved]);
      root.setAttribute('data-theme-mode', mode);
      root.style.colorScheme = resolved;
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', resolved === 'dark' ? '#0E1116' : '#E9ECEF');
      return resolved;
    }

    apply(read());

    if (!window.swalTheme) {
      window.swalTheme = {
        get: read,
        resolved: function () {
          return resolve(read());
        },
        set: function (mode) {
          if (mode !== 'light' && mode !== 'dark' && mode !== 'system') return;
          try {
            localStorage.setItem(KEY, mode);
          } catch (e) {}
          var resolved = apply(mode);
          document.dispatchEvent(new CustomEvent('swal:themechange', { detail: { mode: mode, resolved: resolved } }));
        },
      };
      document.addEventListener('astro:after-swap', function () {
        apply(read());
      });
      if (media && media.addEventListener) {
        media.addEventListener('change', function () {
          if (read() !== 'system') return;
          var resolved = apply('system');
          document.dispatchEvent(new CustomEvent('swal:themechange', { detail: { mode: 'system', resolved: resolved } }));
        });
      }
    }
  })();
