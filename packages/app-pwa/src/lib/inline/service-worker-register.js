
      // El SW se registra aqui tambien: el modulo de flota usa este layout (no
      // BaseLayout), asi que entrar directo a /fleet en un navegador nuevo
      // dejaba la app sin service worker y recargar sin red fallaba con
      // ERR_INTERNET_DISCONNECTED aunque el SW supiera servir el shell.
      if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
          navigator.serviceWorker.register('/sw.js').catch(() => {});
        });
      }
    