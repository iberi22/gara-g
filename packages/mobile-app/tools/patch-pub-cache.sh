#!/usr/bin/env bash
# tools/patch-pub-cache.sh — arregla plugins del pub cache que no compilan con
# las herramientas actuales.
#
# `pub cache clean` (o una maquina nueva) deshace esto, asi que este script
# forma parte del bootstrap: se ejecuta antes de `flutter build apk`.
#
# Por que hace falta:
#
#   `mic_stream` 0.7.2 usa `io.flutter.plugin.common.PluginRegistry.Registrar`,
#   que Flutter elimino al pasar a AGP 8. Aparece en DOS ficheros:
#
#     android/src/main/kotlin/.../mic_stream/MicStreamPlugin.kt
#       — solo un import sin usar; el plugin ya va con
#         FlutterPlugin.FlutterPluginBinding.
#     android/src/main/java/.../micstream/MicStreamPlugin.java
#       — el metodo `registerWith(Registrar)`, el registro legacy de antes de
#         AGP 1.12. El plugin ya se registra en
#         `onAttachedToEngine(FlutterPluginBinding)`, asi que ese metodo no lo
#         llama nadie.
#
#   Dart llega hasta aqui porque el paquete es federado y compila todas sus
#   plataformas para cualquier destino: el fallo sale al construir el APK
#   aunque `mic_stream` no se use en Android. Y `telemetry_service.dart` lo usa
#   para el RMS del microfono en segundo plano, asi que no se puede quitar.
#
#   Su autor no ha publicado version estable compatible (la 0.7.3 sigue en
#   -dev), asi que el arreglo va aqui.
#
# Que hace falta para arreglarlo de raiz: que mic_stream saque el import y el
# metodo legacy. Si aparece una version estable posterior a 0.7.2, borra el
# parche de este script.

set -euo pipefail

log() { printf '  %s\n' "$*"; }
warn() { printf '  AVISO: %s\n' "$*" >&2; }

# Localiza los ficheros de un plugin federado, en cualquier version instalada.
plugin_files() {
  local base="${PUB_CACHE:-$HOME/.pub-cache}/hosted/pub.dev"
  local dir
  for dir in "$base"/"$1"-*; do
    [ -d "$dir" ] || continue
    find "$dir/android/src/main" \( -name '*.kt' -o -name '*.java' \) 2>/dev/null || true
  done
}

parche_mic_stream() {
  local parcheados=0
  local f

  while IFS= read -r f; do
    [ -f "$f" ] || continue
    grep -q 'PluginRegistry\.Registrar' "$f" || continue

    # 1) el import, que es una linea propia. Con o sin punto y coma: el .kt
    #    lo escribe sin el, el .java con el.
    sed -i -E '/^[[:space:]]*import[[:space:]]+io\.flutter\.plugin\.common\.PluginRegistry\.Registrar[[:space:]]*;?[[:space:]]*$/d' "$f"

    # 2) el metodo legacy `registerWith(Registrar registrar) { ... }`, que ya no
    #    lo llama nadie: el plugin se registra en onAttachedToEngine
    if grep -q 'Registrar registrar' "$f"; then
      perl -0pi -e 's{[ \t]*(?:///[^\n]*\n[ \t]*)*[ \t]*(?:public|private|protected)?\s*void\s+registerWith\s*\(\s*Registrar\s+\w+\s*\)\s*\{[^{}]*\}\n}{}' "$f"
    fi

    if grep -q '\bRegistrar\b' "$f"; then
      warn "mic_stream: quedan usos de Registrar en $f; revisa a mano"
      continue
    fi

    log "mic_stream: $(basename "$f") limpio de Registrar"
    parcheados=$((parcheados + 1))
  done < <(plugin_files mic_stream)

  if [ "$parcheados" -eq 0 ]; then
    log "mic_stream: nada que parchear"
  fi
}

parche_solana() {
  local base="${PUB_CACHE:-$HOME/.pub-cache}/hosted/pub.dev"
  local f

  # AGP 8 prohibio `package="..."` en el AndroidManifest de una biblioteca: el
  # namespace va en build.gradle. `android/build.gradle.kts` de este proyecto ya
  # lo fija para solana_wallet_adapter_android, asi que quitar el atributo es
  # seguro y es lo que recomienda el propio AGP.
  for f in "$base"/solana_wallet_adapter_android-*/android/src/main/AndroidManifest.xml; do
    [ -f "$f" ] || continue
    grep -q 'package=' "$f" || continue
    perl -0777 -pi -e 's{(<manifest\b[^>]*?)\s+package="[^"]*"}{${1}}s' "$f"
    log "solana_wallet_adapter_android: quitado package= de $(basename "$(dirname "$(dirname "$(dirname "$(dirname "$f")")")")")"
  done
}

main() {
  echo "[patch-pub-cache] revisando plugins federados"
  parche_mic_stream
  parche_solana
  echo "[patch-pub-cache] listo"
}

main "$@"
