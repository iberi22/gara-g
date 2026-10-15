
  function initThemeSwitch() {
    document.querySelectorAll('.theme-mode-switch:not([data-bound])').forEach(function (root) {
      root.setAttribute('data-bound', '1');
      var btns = root.querySelectorAll('.theme-btn');

      function updateActive() {
        var current = window.swalTheme ? window.swalTheme.get() : 'light';
        btns.forEach(function (btn) {
          var mode = btn.getAttribute('data-mode');
          var isActive = mode === current;
          if (isActive) {
            btn.classList.add('active');
            btn.setAttribute('aria-pressed', 'true');
          } else {
            btn.classList.remove('active');
            btn.setAttribute('aria-pressed', 'false');
          }
        });
      }

      btns.forEach(function (btn) {
        btn.addEventListener('click', function () {
          var mode = btn.getAttribute('data-mode');
          if (mode && window.swalTheme) {
            window.swalTheme.set(mode);
          }
        });
      });

      updateActive();
      document.addEventListener('swal:themechange', updateActive);
    });
  }

  document.addEventListener('astro:page-load', initThemeSwitch);
  initThemeSwitch();
