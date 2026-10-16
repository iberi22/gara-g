/**
 * confirmSubmit.ts — confirmacion antes de enviar los formularios con `data-confirm`.
 *
 * Sustituye a los `onsubmit="return confirm(...)"`: la CSP no permite manejadores en
 * atributos (los hashes de `script-src` no los cubren) y, con el handler bloqueado, el
 * formulario de borrar se enviaba sin preguntar. Un solo listener en `document`, en fase de
 * captura, sirve a los formularios presentes y a los que traiga el ClientRouter (cambia el
 * <body>, no el document).
 */
const FLAG = '__swalConfirmSubmit';

export function installConfirmSubmit(doc: Document = document): void {
  const win = doc.defaultView as (Window & typeof globalThis & { [FLAG]?: boolean }) | null;
  if (!win || win[FLAG]) return;
  win[FLAG] = true;
  doc.addEventListener(
    'submit',
    (e) => {
      const form = e.target;
      if (!(form instanceof win.HTMLFormElement)) return;
      const message = form.getAttribute('data-confirm');
      if (message && !win.confirm(message)) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    true,
  );
}
