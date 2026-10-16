
    // SPA-safe (ViewTransitions): `is:inline` se ejecuta UNA vez. Con el
    // ClientRouter el formulario se sustituye al navegar, así que el listener
    // quedaba en el nodo viejo y "Crear usuario" no enviaba nada si se llegaba
    // a la página por navegación interna. El guard evita duplicarlo.
    function notify(message, type) {
      // El toast local (ToastContainer, ya en FleetLayout) escucha este evento: no bloquea el
      // hilo como un dialogo nativo y la region viva lo anuncia.
      window.dispatchEvent(new CustomEvent('gara-toast', { detail: { message: message, type: type } }));
    }

    function bindCreateUser() {
      const form = document.getElementById('create-user-form');
      if (!form || form.hasAttribute('data-bound')) return;
      form.setAttribute('data-bound', '1');
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        // Envio en vuelo: un segundo clic o Enter no debe crear el usuario dos veces.
        if (form.dataset.submitting === '1') return;
        form.dataset.submitting = '1';
        const submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn) submitBtn.disabled = true;
        const formData = new FormData(form);
        const data = {
          email: formData.get('email'),
          password: formData.get('password'),
          role: formData.get('role'),
          active: formData.get('active') === 'on',
        };
        try {
          const res = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
          });
          const json = await res.json().catch(() => ({}));
          if (res.ok && json.ok) {
            notify('Usuario creado: ' + json.email, 'success');
            // La lista es SSR: se recarga, dejando ver el aviso un momento.
            setTimeout(() => location.reload(), 1200);
            return;
          }
          notify('No se pudo crear el usuario: ' + (json.error || 'error desconocido'), 'error');
        } catch {
          notify('No se pudo crear el usuario: sin conexión con el servidor', 'error');
        }
        form.dataset.submitting = '';
        if (submitBtn) submitBtn.disabled = false;
      });
    }

    document.addEventListener('astro:page-load', bindCreateUser);
    bindCreateUser();
  