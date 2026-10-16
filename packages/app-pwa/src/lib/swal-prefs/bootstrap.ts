/**
 * swal-prefs/bootstrap.ts — Script en linea que oculta lo desactivado antes de pintar.
 *
 * Igual que el bootstrap del tema: va en el <head>, lee las preferencias de localStorage y
 * escribe una hoja de estilo con
 *   [data-pref-module="x"], [data-pref-panel="y"] { display: none !important }
 * para cada modulo o panel apagado. Cualquier elemento marcado con esos atributos (una
 * entrada del menu, una seccion del dashboard) se oculta sin parpadeo y sin que su
 * componente sepa de preferencias. Se re-aplica con `swal:prefschange` (el store lo emite
 * al cargar o guardar) y tras `astro:after-swap` (navegacion con ClientRouter).
 *
 * La hoja es un CSSStyleSheet construido y adoptado por el documento, no un `<style>`: la
 * CSP (`style-src` con hashes, sin `'unsafe-inline'`) bloquea el contenido de un `<style>`
 * creado en ejecucion, pero no las hojas construidas. Se guarda en `window` para que una
 * re-ejecucion del script reutilice la misma. Sin soporte (navegadores viejos, jsdom) cae a
 * `<style id="swal-prefs-style">`.
 *
 * localStorage es solo cache: lo peor que puede hacer un valor manipulado es ocultarle algo
 * al propio usuario. Los modulos `required` ya vienen resueltos como activos.
 */
export interface PrefsBootstrapOptions {
  storageKey?: string;
  /** Atributos que se ocultan; por defecto data-pref-module y data-pref-panel. */
  moduleAttr?: string;
  panelAttr?: string;
}

export function prefsBootstrapScript(opts: PrefsBootstrapOptions = {}): string {
  const cfg = JSON.stringify({
    key: opts.storageKey ?? 'swal:prefs',
    mod: opts.moduleAttr ?? 'data-pref-module',
    pan: opts.panelAttr ?? 'data-pref-panel',
  });
  return `(function(){var C=${cfg};
function esc(s){return String(s).replace(/["\\\\]/g,'\\\\$&');}
function css(p){var sel=[];if(!p||typeof p!=='object')return '';
var m=p.modules||{};for(var k in m)if(m[k]===false)sel.push('['+C.mod+'="'+esc(k)+'"]');
var q=p.panels||{};for(var j in q)if(q[j]&&q[j].enabled===false)sel.push('['+C.pan+'="'+esc(j)+'"]');
return sel.length?sel.join(',')+'{display:none!important}':'';}
function apply(p){if(p===undefined){try{p=JSON.parse(localStorage.getItem(C.key)||'null');}catch(e){p=null;}}
write(css(p));}
function sheet(){if(window.__swalPrefsSheet!==undefined)return window.__swalPrefsSheet;var s=null;
try{if('adoptedStyleSheets' in document&&typeof CSSStyleSheet==='function'&&'replaceSync' in CSSStyleSheet.prototype)s=new CSSStyleSheet();}catch(e){s=null;}
window.__swalPrefsSheet=s;return s;}
function write(text){var s=sheet();
if(s){try{s.replaceSync(text);if(document.adoptedStyleSheets.indexOf(s)<0)document.adoptedStyleSheets=document.adoptedStyleSheets.concat([s]);return;}catch(e){}}
var el=document.getElementById('swal-prefs-style');if(!el){el=document.createElement('style');el.id='swal-prefs-style';document.head.appendChild(el);}
el.textContent=text;}
apply();
document.addEventListener('swal:prefschange',function(e){apply(e.detail);});
document.addEventListener('astro:after-swap',function(){apply();});
window.swalPrefs=window.swalPrefs||{};window.swalPrefs.apply=apply;})();`;
}
