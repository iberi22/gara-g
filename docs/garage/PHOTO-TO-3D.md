# De fotos a 3D en GARA-G: investigación de técnicas (Oct 2026)

**Contexto:** GARA-G es una PWA (Astro + Svelte + Cloudflare Workers, three.js r186 con WebGPURenderer) que hoy muestra el vehículo del usuario con **plantillas paramétricas genéricas**. Objetivo: que el usuario suba fotos normales de SU vehículo y obtenga un modelo más fiel. Preferencia del dueño: preferir técnicas **sin IA generativa**; toda técnica con redes neuronales va marcada explícitamente **[IA-GEN]**.

**Convenciones:** cada dato externo lleva URL; lo no confirmado va como *no verificado*; los esfuerzos en semanas-persona son **estimaciones mías**.

---

## 1. Fotogrametría clásica (SfM + MVS)

| Ítem | Hallazgo | Fuente |
|---|---|---|
| Motor COLMAP | SfM + MVS clásicos, sin red neuronal obligatoria. SIFT por defecto; ALIKED es *aprendido* y opcional | https://colmap.github.io/faq.html |
| Licencias | **COLMAP: New BSD** (comercial OK) · **OpenMVG: MPL 2.0** ("para maximizar su uso, incluso por socios comerciales") · **AliceVision/Meshroom: MPL 2.0** · ⚠️ **OpenMVS: AGPL v3** (copyleft fuerte) | https://colmap.github.io/license.html · https://github.com/openMVG/openMVG/blob/master/COPYRIGHT.md · https://github.com/alicevision/meshroom/blob/develop/COPYING.md · https://github.com/cdcseacave/openMVS/blob/develop/COPYRIGHT.md |
| GPU | Meshroom **exige GPU NVIDIA con CUDA (compute capability ≥ 2.0/3.0)** para MVS; el único fallback de CPU es para *draft meshing* | https://meshroom-manual.readthedocs.io/en/latest/install/requirements/requirements.html · https://meshroom-manual.readthedocs.io/en/latest/faq/needs-cuda/needs-cuda.html |
| CPU en COLMAP | Corre 100% en CPU (`--FeatureExtraction.use_gpu=false`), pero la doc advierte que el MVS denso "aún puede struggle"; 16 GB RAM es el mínimo razonable | https://colmap.github.io/faq.html · https://colmap.org/what-are-the-system-requirements-for-running-colmap/ |
| Nº de fotos | Cada punto necesita verse en ≥2 fotos; rango general **20–250** | https://centerlinedesign.eu/en/3d-scan-blog/photogrammetry-how-many-photos/ |

### Problema crítico: carro = superficie especular y sin textura

La SfM/MVS clásica **busca correspondencias de textura**. Un carro tiene pintura brillante, cromados, vidrios y zonas negras. El consenso de la comunidad es demoledor:

> "photogrammetry doesn't have a concept of glass or mirrors, it only does completely opaque surfaces. Reflections and gloss will throw it off" — https://www.reddit.com/r/photogrammetry/comments/1o0bdal/colmap_bad_results/

> "Cars are tricky because of glossy paint, glass, and chrome. Reflections can confuse the software. Using a matte spray (like removable chalk spray) or shooting on an overcast day helps reduce glare." — https://www.3dscanforum.org/viewtopic.php?t=2558

Reportes de campo: 100 fotos en órbita de día nublado y el modelo sale "terrible" (https://www.reddit.com/r/photogrammetry/comments/hbrtbo/); Agisoft mantiene un foro dedicado al problema reflectivo en autos (https://www.agisoft.com/forum/index.php?topic=3283.0). **Conclusión: la fotogrametría clásica sin IA no es viable para un carro real** salvo con spray mate o fotos en condiciones muy controladas. Matiz clave: el problema está en la superficie, no en SfM — una malla de carro SÍ funciona si la plantilla define la forma y luego se proyecta la foto (ver §5).

### ¿Corre en un Cloudflare Worker? NO

| Límite de Cloudflare Workers | Valor |
|---|---|
| Memoria | **128 MB** (Free y Paid) |
| CPU time | 10 ms (Free) / 5 min (Paid) |
| Tamaño del Worker | **64 MiB** |
| Static Asset individual | 25 MiB |

Fuente: https://developers.cloudflare.com/workers/platform/limits/

COLMAP/OpenMVS no caben ni en memoria ni en tamaño: **descartados como backend en Worker**. Alternativas: contenedor propio (Cloud Run, Fly.io, VPS) o port WASM no oficial — existe uno (WASM + WebGPU) que en escritorio (Ryzen 7 5800X + RTX 3700) tarda ~1 min en SIFT y ~1.6 min en sparse mapping para 229 imágenes: https://offlinetools.io/colmap-landing/ — **no verificado** si escala a gama media ni su licencia.

Tiempo de cómputo: minutos en CPU para un auto (50-150 fotos); horas si se entrena 3DGS en GPU (1–4 h: https://www.spheron.network/blog/deploy-3d-gaussian-splatting-gpu-cloud/).

### Licencias: el detalle que importa

- **BSD (COLMAP)** y **MPL2 (OpenMVG, AliceVision/Meshroom)**: usables comercialmente.
- ⚠️ **AGPLv3 (OpenMVS)**: la trampa clásica — el copyleft puede alcanzar al servicio que lo enlaza. El propio autor: "OpenMVS is under AGPLv3... contact me for details" (https://github.com/cdcseacave/openMVS/issues/268). **Recomendación: usar COLMAP (BSD) + Meshroom/AliceVision (MPL2)** y evitar OpenMVS.

---

## 2. Gaussian Splatting (3DGS) y variantes

**¿Usa red neuronal generativa? NO.** 3DGS es optimización numérica (gradient descent sobre primitivas) con rasterizador tile-based. Fuentes:

> "3DGS does not use neural networks, relying instead on mathematical optimization and tile-based rasterization" — https://learnopencv.com/3d-gaussian-splatting/

> "without the reliance on neural networks, unlike NeRF" — https://www.sciencedirect.com/science/article/abs/pii/S0262885624004098 · https://en.wikipedia.org/wiki/Gaussian_splatting

⚠️ **Matiz:** el 3DGS *original* es sin red, pero (a) la init se apoya en COLMAP, (b) algunos extractores son **[IA-GEN]** (ALIKED, LightGlue con ONNX) y (c) las variantes que atacan reflexión/transparencia en carros usan modelos fundacionales: Car-GS alinea **Depth Anything V2** (red neuronal) y obtiene Chamfer 0.060: https://arxiv.org/html/2501.11020. Para "sin IA" hay que fijar 3DGS vanilla + SIFT.

### Librerías de render web (estado 2026)

| Librería | Licencia | Estado | Nota clave |
|---|---|---|---|
| **Spark** (@sparkjsdev/spark) | **MIT** | v2.3.0, ~299k descargas/sem, 3.7k estrellas | Renderiza splats **junto con mallas** en el mismo `render(scene, camera)`; `SplatMesh` es un `THREE.Object3D` con escala/rotación/animación por frame; **WebGL2, no requiere WebGPU**;Formats: PLY, SPZ, SPLAT, KSPLAT |
| mkkellogg/GaussianSplats3D | MIT | v0.4.7 (enero 2025), ~2-3k descargas/sem | Funciona, **mantenimiento limitado**; WebGPU |
| gsplat.js (huggingface) / gsplat (dylanebert) | MIT | activos (1.2.9) | Splat "como three.js" |
| SuperSplat (PlayCanvas) | MIT | activo | Editor + viewer open source |

Fuentes: https://sparkjs.dev/docs/overview/ · https://www.npmjs.com/package/@sparkjsdev/spark · https://github.com/mkkellogg/GaussianSplats3D/releases · https://github.com/huggingface/gsplat.js/ · https://playcanvas.com/products/supersplat

**Aviso de homónimos:** World Labs también llama "Spark" a su motor LoD 2.0 (https://www.worldlabs.ai/blog/spark-2.0) — mismo origen corporativo, no confundir con el paquete `gsplat` de npm.

### 60 fps en móvil: qué esperar

Spark es explícito y honesto:

> "Rendering millions of splats at 60+ fps can be a demanding task, especially for mobile-class GPUs... at around 1 million splats this becomes a bottleneck on some systems" — https://sparkjs.dev/docs/performance/

Presupuesto recomendado: 500K–2.5M splats, con LoD de "slices" para mantener frame constante (https://x.com/sparkjsdev/status/2044090530087469359). En gama media los 60 fps **no están garantizados**: Spark menciona "low-powered mobile devices" sin dar cifra. Los mejores números publicados son top-tier, no gama media: 116 fps en Snapdragon 8 Gen 3 **[IA-GEN: Mobile-GS]** (https://arxiv.org/html/2603.11531v1) y ~50 fps en un renderer Android nativo (https://github.com/DisplayXR/displayxr-demo-gaussiansplat/pull/44).

### Tamaño de archivo

- PLY original de Inria: 62 float32 por Gaussian ≈ **248 bytes** → 1M de splats ≈ **250 MB** sin comprimir. Fuente: https://www.utsubo.com/blog/gaussian-splatting-guide
- SPLAT: 32 bytes/splat exacto → 32 MB por 1M. Fuente: https://www.polyvia3d.com/formats/splat
- SPZ: ~11 MB una escena de 500K. Fuente: https://www.3dgsviewers.com/blog/gaussian-splatting-formats
- Rango práctico descomprimido: **200 MB – 2 GB**, comprimido **10–50 MB**. Fuente: https://www.polyvia3d.com/guides/optimize-gaussian-splatting-file-size

### La limitación que mata a 3DGS para GARA-G

**Un splat no es geometría.** No hay malla, topología, piezas, UV ni material PBR: "the main drawback of GS is the absence of a well[-defined mesh]" (https://arxiv.org/html/2402.01459v4, GaMeS) frente a mallas que "represent geometry as closed surfaces" (https://www.esri.com/arcgis-blog/products/arcgisrealitystudio/3d-gis/meshes-vs-gaussian-splats-which-reality-representation-should-you-choose).

Para GARA-G esto es **descartatorio**: si la app debe mostrar *estado por pieza* (llanta, espejo, pintura dañada, puerta), el splat es una nube ordenada por profundidad. Se puede recolorear por zonas ("real-time splat color editing": https://sparkjs.dev/docs/overview/), pero no hay identidad de pieza ni oclusión semántica confiable.

**Veredicto §2: 3DGS es excelente para "que se vea idéntico", e inservible para "saber qué pieza es cuál".**

---

## 3. Captura en el dispositivo

| Plataforma | Requisito | Estado / fuente |
|---|---|---|
| **Apple Object Capture** (RealityKit) | iOS 17+ / macOS 12+, **fotogrametría clásica** (no IA generativa), requiere A12 o posterior; se verifica en runtime con `ObjectCaptureSession.isSupported` | https://developer.apple.com/documentation/realitykit/realitykit-object-capture · https://developer.apple.com/documentation/realitykit/objectcapturesession/issupported |
| **ARCore Depth API** | **No requiere sensor ToF**: "A device does not need a ToF sensor to support the Depth API, as depth information is calculated from motion" | https://developers.google.com/ar/develop/java/depth/developer-guide |
| Cobertura Depth API | "As of May 2026, **over 88% of active devices support the Depth API**" | https://developers.google.com/ar/devices |
| **LiDAR** | Solo iPhone **Pro/Pro Max** del 12 al 17; ningún estándar/Plus/Air/SE. Android: solo gama alta | https://www.simplywise.com/blog/which-iphones-have-lidar/ |

**Realidad en gama media Colombia/LATAM:** la Depth API de ARCore es viable (88% de dispositivos activos, sin exigir ToF). LiDAR **no** es opción de masa — queda en los Pro de Apple y Android flagship. **No se puede depender de LiDAR**; el camino es monocular + silueta.

⚠️ Salvedad: Object Capture usa el kit de fotogrametría de Apple, pero produce una malla única texturizada (USDZ u OBJ+texturas), no partes separadas (https://developer.apple.com/videos/play/wwdc2021/10076/). Hay reportes de fallo en iPhone 17 Pro bajo iOS 26.x que no afectan iPhone 12 Pro (*no verificado* fuera del foro): https://developer.apple.com/forums/tags/object-capture.

---

## 4. APIs comerciales

| Servicio | Precio (verificado en su sitio) | Licencia del resultado | IA generativa |
|---|---|---|---|
| **KIRI Engine** | Basic $0 (escaneos ilimitados, hasta 150 fotos/2 GB); Pro **$17.99/mes** o **$79.99/año** | Free plan usable; "Featureless Object Scan" para objetos brillantes (Pro) | Parcial: PBR y Featureless usan IA **[IA-GEN]** |
| **Polycam** | Free $0 (solo export GLTF); Basic $150/año ($30/mes); Business $400/usuario/año; Enterprise $1200/usuario/año (mín. 3) | Enterprise: "Your organization retains full ownership... Polycam does not claim any rights" | Sí: "Unlimited AI generated captures", AI Spatial Report **[IA-GEN]** |
| **RealityScan** (Epic) | Gratis si ingresos < **$1M USD/año**; si no, **$1,250/asiento/año**. RealityScan Mobile gratis | App móvil: "it's free, including for commercial use"; **⚠️ por defecto da a Epic permiso para usar tus scans para entrenar productos**, con opt-out en la app | No (fotogram+MVS clásica) |
| **Meshy** | Free / Pro / Studio / Enterprise (los importes exactos **no verificados**: la página no los renderiza en el texto extraído) | Premium: **tú posees** los assets; Free: licencia **CC BY 4.0** | **Sí, íntegramente [IA-GEN]** (difusión) |
| **Tripo AI** | Free $0 (200 créditos ≈13 modelos, **no comercial**); Pro $20/mes o $240/año (3000 créd ≈200 modelos); Max $90/mes; Team $55/usuario/mes | Pro+ = "Private Models · Commercial Use"; Free = **solo no comercial** | **Sí [IA-GEN]** (difusión 3D nativa) |
| **Luma** | Plus $30/mes (10k créd), Pro $90/mes (40k), Pro+ $300/mes (150k). **Precio por captura 3D: no encontrado** (la tabla de precios solo lista video) | Plus incluye "Commercial use" | **Sí [IA-GEN]** ("Neural Radiance Fields") |

Fuentes: https://www.kiriengine.app/pricing · https://poly.cam/pricing · https://learn.poly.cam/hc/en-us/articles/27756102599572-What-File-Types-Can-Polycam-Export · https://www.realityscan.com/license · https://www.cgchannel.com/2025/06/epic-games-to-rebrand-realitycapture-as-realityscan-2-0/ · https://www.realityscan.com/eula-mobile · https://www.meshy.ai/en/pricing · https://www.tripo3d.ai/pricing · https://www.tripo3d.ai/game-development/3d-assets-license-game-development · https://lumalabs.ai/pricing

⚠️ **Descartados por preferencia del dueño**: Meshy, Tripo, Luma — además, un generador no devuelve nada paramétrico ni garantiza fidelidad métrica.

⚠️ **Cuidado con RealityScan**: gratis por debajo de $1M, pero la cláusula de entrenamiento con tus fotos es incompatible con una PWA de usuario final, y el usuario tendría que instalar la app de Epic aparte.

---

## 5. LA ALTERNATIVA: ajuste de plantilla paramétrica a fotos (sin IA) ⭐

### El método, y por qué es el correcto para GARA-G

Esto es **analysis-by-synthesis**: la plantilla es la variable, la foto es el dato. Los antecedentes existen y son de dos familias.

**Clásicos (sin redes neuronales):**

- **Payet & Todorovic, ICCV 2011 — "From Contours to 3D Object Detection and Pose Estimation"**: ajustan un modelo 3D paramétrico a las siluetas con optimización no lineal iterativa. https://mlanthology.org/iccv/2011/payet2011iccv-contours/
- **Szymczak, Hoff & Mahfouz (SPIE 2010) — "3D shape from silhouette points in registered 2D images using conjugate gradient method"**: "a simple and robust algorithm for estimating 3D shape given... silhouette points obtained from two or more viewpoints and a **parametric model of the shape**... minimizes (in the least squares sense) the distances". https://www.spiedigitallibrary.org/conference-proceedings-of-spie/7623/1/3D-shape-from-silhouette-points-in-registered-2D-images-using/10.1117/12.843885.short
- **Mono-Truck (ASCE, J. Computing in Civil Engineering 2022)**: *el antecedente más cercano al caso GARA-G*. Ajusta progresivamente las variables de un modelo paramétrico de camión (TPM) para maximizar el alineamiento de las vistas sintéticas con una imagen objetivo, desde **una sola imagen monocular**. Error reportado: **10.1% en dimensiones, 6.7 mm, 0.7° en orientación**. https://ascelibrary.org/doi/10.1061/%28ASCE%29CP.1943-5487.0001041 — acceso al texto completo falló; cifras vía snippet de Google Scholar y ResearchGate (**parcialmente no verificado**, no pude abrir el PDF).
- **Active Shape Model for Vehicle Modeling (Siemens, US 2008/0294401)**: modelo genérico de vehículo derivado por PCA de un subconjunto de vehículos, construido desde una imagen. https://www.freepatentsonline.com/y2008/0294401.html
- **Vehicle shape recovery using generic models**: PCA sobre formas genéricas de vehículo (*no verificado*, solo snippet).

**Con deep learning (marcados, no los queremos):** GSNet (ECCV 2020, https://ar5iv.labs.arxiv.org/html/2007.13124) — su abstract admite que la etapa 2, "iterative non-linear optimization", es lenta; VERTEX (https://ar5iv.labs.arxiv.org/html/2011.14642); DreamCar (https://ar5iv.labs.arxiv.org/html/2407.16988); 3D car desde contour sketch con GAN (https://link.springer.com/article/10.1007/s00371-020-02024-y); View2CAD (https://arxiv.org/html/2504.04000). **Todos son [IA-GEN]** y ninguno aporta lo que necesitamos: control paramétrico + escala métrica real.

### La escala: la llanta como regla métrica

La medida de llanta da la escala absoluta **exacta**, sin ambigüedad de perspectiva monocular:

`205/55R16` → 16 × 25.4 = 406.4 mm de llanta; flanco = 205 × 0.55 = 112.75 mm; **diámetro exterior = 406.4 + 2 × 112.75 = 631.9 mm ≈ 24.88"** (verificado por cálculo propio). Fuentes de la fórmula: https://www.wheel-size.com/tire/205-55r16/ · https://pressbooks.bccampus.ca/tradeskillsforsuccessnumeracy/chapter/tire-sizes-and-calculations/

Si el template parametriza la rueda por radio, **fijar radio = 315.95 mm fija toda la escala**. El error de escala cae a ~0: la llanta es el único elemento cuya dimensión el usuario conoce con certeza. Y el template actual ya pide la medida de llanta para elegir variante — es el mismo input.

### Viabilidad técnica en navegador

| Componente | Opción | Estado |
|---|---|---|
| Silueta | **OpenCV.js `cv.grabCut`** (API existe en JS), o chroma-key con fondo liso, o **el usuario ajusta el contorno a mano** (la más robusta y la recommendada para el MVP) | https://docs.opencv.org/3.4/dd/dfc/tutorial_js_grabcut.html · https://answers.opencv.org/question/234301/opencvjs-grabcut-and-gc_init-with_mask/ |
| Licencia OpenCV | **Apache 2** desde 4.5.0 (antes BSD-3) → comercial OK | https://opencv.org/license/ |
| Vectorizar contorno | Douglas-Peucker / ajuste de B-splines (clásico, no IA) | https://cad-journal.net/files/vol_8/CAD_8(1)_2011_3-21.pdf |
| Optimizador | **CMA-ES** (BSD-3, ref. Hansen 2006; `pycma` tiene versión minimalista sin numpy) — ideal porque no necesita Jacobiano analítico. Alternativas: Nelder-Mead, o LM con finite-differences | https://cma-es.github.io/cmaes_sourcecode_page.html · https://github.com/CMA-ES/pycma · https://treese41528.github.io/VirtualHumans/lecture_06_1_SMPL_optimization.html |
| Precedente | SMPLify / SMALFitter hacen exactamente esto con modelos paramétricos (pero **con red neuronal pretrained para keypoints** [IA-GEN]) | https://github.com/Uness10/SMILify |
| Render de la silueta sintética | Three.js r186 `WebGPURenderer` con material de override; ⚠️ "In r186, rendering an **uninitialized** WebGPURenderer throws" — hay que esperar init | https://github.com/mrdoob/three.js/releases/tag/r186 · https://www.utsubo.com/blog/webgpu-threejs-migration-guide |
| Precisión esperada | Dimensional **~1-3%**: Mono-Truck reporta 10.1% *sin* escala métrica conocida; con la llanta como ancla la escala deja de ser la fuente de error. Textura: tan fiel como la segmentación. | *Estimación propia* |

**Esfuerzo estimado (semana-persona, estimación mía):**

| Componente | sp |
|---|---|
| Captura guiada de 3-5 fotos + validación de solapamiento | 1 |
| Segmentación de silueta (manual + GrabCut como sugerencia) | 2 |
| Escala desde llanta + calibración de cámara (homografía) | 1.5 |
| Pipeline de render de silueta del template por pose de cámara | 2 |
| Bucle CMA-ES con IoU/chamfer + caché de siluetas | 3 |
| Proyección de textura/color sobre la malla | 3 |
| UI de refinamiento + persistencia + tests en gama media | 2 |
| **Total MVP** | **~14.5 sp** |

Reduce a **~8 sp** si en la Fase 1 solo se ajustan **dimensiones globales** (entre ejes, huella, altura, sección de rueda) en la vista **lateral ortográfica** (donde la perspectiva se minimiza), sin textura.

---

## 6. Recomendación final

| # | Opción | (a) Celular gama media | (b) Costo | (c) Piezas separadas | (d) Riesgo de marcas | (e) Esfuerzo |
|---|---|---|---|---|---|---|
| 1 | **Template fitting sin IA (Fase 1-2)** | ✅ 5/5 — 3-5 fotos, aritmética ligera | ✅ $0 | ✅ **5/5 — la plantilla ya las tiene** | 🟡 2/5 — ver abajo | ~14.5 sp |
| 2 | Template fitting + textura proyectada | ✅ 4/5 | ✅ $0 | ✅ 5/5 | 🟡 2/5 | (incluido en #1) |
| 3 | Apple Object Capture como *complemento iOS* | 🟡 2/5 — solo A12+, un solo mesh | ✅ $0 | ❌ 1/5 — malla única | 🟡 2/5 | ~3 sp (integración) |
| 4 | ARCore Depth como apoyo de escala/pose | 🟡 3/5 — 88% cobertura | ✅ $0 | ❌ 2/5 | 🟡 2/5 | ~4 sp |
| 5 | Fotogrametría clásica (COLMAP/Meshroom) | ❌ 1/5 — 128 MB RAM en Worker | 🟡 $ (contenedor propio) | 🟡 3/5 — malla sí, partes no | 🔴 4/5 | ~8 sp + infra |
| 6 | 3DGS / Spark | 🟡 3/5 — 500K splats, 60fps no garantizado | 🟡 $ (GPU p/ entrenar) | ❌ **0/5** | 🔴 4/5 | ~6 sp |
| 7 | Meshy / Tripo / Luma | ✅ 5/5 | 🔴 $0.09-0.16/modelo | 🟡 2/5 | 🔴 4/5 | ~2 sp |

### (d) Riesgo legal de marcas — **NO ES ASESORÍA LEGAL**

La protección de la **forma del automóvil** es real y nadie lo discute: *trade dress* registrado sobre la apariencia exterior en EE.UU. (Ferrari: https://cyber.harvard.edu/IPCoop/91ferr1.html; https://www.dlapiper.com/en-us/insights/publications/intellectual-property-news/2022/ipt-news-july-2022-trade-dress-protects-auto-design), **design patent** en EE.UU. (~15 años) y **diseño registrado** en la UE (RCD 5 años, renovable hasta **25 años**; sin registro solo **3 años** — https://www.euipo.europa.eu/en/help-centre/design/faq-basic-questions). En Colombia, la SIC registra diseños industriales que protegen "la forma desde su apariencia misma" (https://www.sic.gov.co/disenos-industriales) y advierte que copiar un diseño ya registrado en Colombia "supone una denegación de la solicitud" (https://www.sic.gov.co/node/29).

**¿Cambia algo el hecho de que lo haga el propio usuario para su uso personal?** Argumentos a favor (no concluyentes): (a) la app aporta una plantilla genérica preexistente — el parecido del modelo es una constante controlada por GARA-G, no por el usuario; (b) el uso es privado/no comercial; (c) la arquitectura de §5 **no puede** copiar fielmente un diseño protegido: ~15 parámetros paramétricos no tienen resolución para reproducir su identidad, así que el riesgo de *infringimiento por el modelo* es bajo; (d) el riesgo residual real es la **foto que el usuario subió** (copyright de la foto, no del auto) y cualquier uso social posterior.

**Mitigaciones baratas:** (i) sin marca, logo, emblema ni patente en el render; (ii) sin compartir el modelo en público en la Fase 1 — solo privado; (iii) el resultado es siempre "aproximación paramétrica", nunca "réplica"; (iv) aviso en la UI. Con eso, el riesgo de la **Opción 1 es manejable**; las Opción 5/6 lo escalan.

### Arquitectura por fases

**Fase 0 — Línea base (1 sp).** Congelar el contrato del template actual (qué parámetros existen, qué es "pieza" en el código de estado) y fijar la métrica de éxito (error de dimensión longitudinal/lateral vs. ficha técnica real).

**Fase 1 — Ajuste dimensional, 2 fotos, sin textura (4 sp).** Solo vista **lateral ortográfica** (celular contra una pared; la app genera la homografía). Flujo: 2 fotos (lateral + medida de llanta) → silueta manual/GrabCut → escala desde llanta → **CMA-ES sobre 6-8 parámetros globales** (entre ejes, longitud, altura, sección de rueda, voladizos) minimizando IoU de silueta. Salida: las **dimensiones correctas del vehículo del usuario**, con las piezas intactas. **Esta fase ya entrega el 80% del valor** ("mi moto mide 2.05 m y mi entre ejes es 1.42 m").

**Fase 2 — 5 fotos y textura proyectada (6 sp).** Extender a frontal / trasera / 3-4; cada vista aporta su silueta al optimizador multiobjetivo (suma ponderada de IoUs) más optimización de pose de cámara por vista. Proyectar color/textura sobre la malla con mapeo UV o triplanar. Persistir el **vector de parámetros** por usuario (no la malla: se guarda el *fit* y se re-renderiza desde la plantilla).

**Fase 3 — Refinamiento guiado por el usuario (2.5 sp).** Sliders de parámetros + comparación overlay con la foto. Detección de desajuste (si IoU < umbral → pedir más fotos). Esto es barato y corrige el 100% de los fallos de segmentación.

**Fase 4 (opcional) — Splat como "foto real" sobre el modelo (2.5 sp).** Realismo fotográfico: correr COLMAP-lite o 3DGS sobre las fotos que el usuario ya subió (costo marginal ~0) y renderizar el splat con Spark como capa *decorativa*, sin prometer piezas. **Decisión clave: el estado por pieza sigue viniendo SIEMPRE de la malla paramétrica, nunca del splat.** Así el splat deja de ser un callejón sin salida y pasa a ser un complemento.

**Dejar explícitamente fuera de alcance:** Meshy/Tripo/Luma (IA generativa, contra la preferencia del dueño), y OpenMVS (AGPL).

---

## Fuentes

**Fotogrametría / SfM-MVS**
- https://colmap.github.io/faq.html
- https://colmap.github.io/license.html
- https://colmap.github.io/tutorial.html
- https://colmap.github.io/install
- https://github.com/colmap/colmap
- https://colmap.org/what-are-the-system-requirements-for-running-colmap/
- https://github.com/openMVG/openMVG/blob/master/COPYRIGHT.md
- https://imagine.enpc.fr/~marletr/publi/RRPR-2016-Moulon-et-al.pdf
- https://github.com/cdcseacave/openMVS/blob/develop/COPYRIGHT.md
- https://github.com/cdcseacave/openMVS/blob/develop/LICENSE
- https://github.com/cdcseacave/openMVS/issues/268
- https://github.com/alicevision/meshroom/blob/develop/COPYING.md
- https://github.com/alicevision/alicevision/blob/develop/COPYING.md
- https://meshroom-manual.readthedocs.io/en/latest/install/requirements/requirements.html
- https://meshroom-manual.readthedocs.io/en/latest/faq/needs-cuda/needs-cuda.html
- https://meshroom-manual.readthedocs.io/en/latest/features/
- https://alicevision.org/view/meshroom.html
- https://github.com/alicevision/Meshroom/blob/develop/bin/meshroom_batch
- https://www.reddit.com/r/photogrammetry/comments/1o0bdal/colmap_bad_results/
- https://www.3dscanforum.org/viewtopic.php?t=2558
- https://www.reddit.com/r/photogrammetry/comments/hbrtbo/looking_for_some_basic_suggestions_to_create_a/
- https://www.agisoft.com/forum/index.php?topic=3283.0
- https://centerlinedesign.eu/en/3d-scan-blog/photogrammetry-how-many-photos/
- https://www.aeroyantra.com/blog/what-is-photogrammetry-3d-models-from-photos
- https://offlinetools.io/colmap-landing/
- https://offlinetools.io/colmap/
- https://news.ycombinator.com/item?id=49715142
- https://www.spheron.network/blog/deploy-3d-gaussian-splatting-gpu-cloud/

**Gaussian Splatting**
- https://learnopencv.com/3d-gaussian-splatting/
- https://en.wikipedia.org/wiki/Gaussian_splatting
- https://www.sciencedirect.com/science/article/abs/pii/S0262885624004098
- https://arxiv.org/html/2402.01459v4 (GaMeS)
- https://arxiv.org/html/2501.11020 (Car-GS, usa Depth Anything V2)
- https://www.esri.com/arcgis-blog/products/arcgisrealitystudio/3d-gis/meshes-vs-gaussian-splats-which-reality-representation-should-you-choose
- https://sparkjs.dev/docs/overview/
- https://sparkjs.dev/docs/performance/
- https://sparkjs.dev/docs/
- https://github.com/sparkjsdev/spark
- https://www.npmjs.com/package/@sparkjsdev/spark
- https://github.com/mkkellogg/GaussianSplats3D
- https://github.com/mkkellogg/GaussianSplats3D/releases
- https://www.npmjs.com/package/@mkkellogg/gaussian-splats-3d
- https://github.com/huggingface/gsplat.js/
- https://github.com/dylanebert/splat.js
- https://www.npmjs.com/package/gsplat
- https://playcanvas.com/products/supersplat
- https://github.com/playcanvas/supersplat
- https://blog.playcanvas.com/supersplat-3dgs-viewer-is-now-open-source/
- https://www.worldlabs.ai/blog/spark-2.0
- https://x.com/sparkjsdev/status/2044090530087469359
- https://www.polyvia3d.com/guides/optimize-gaussian-splatting-file-size
- https://www.polyvia3d.com/formats/splat
- https://www.3dgsviewers.com/blog/gaussian-splatting-formats
- https://www.utsubo.com/blog/gaussian-splatting-guide
- https://arxiv.org/html/2603.11531v1 (Mobile-GS, [IA-GEN])
- https://github.com/DisplayXR/displayxr-demo-gaussiansplat/pull/44
- https://docs.nerf.studio/nerfology/methods/splat.html
- https://github.com/nerfstudio-project/gsplat

**Captura en dispositivo**
- https://developer.apple.com/documentation/realitykit/realitykit-object-capture
- https://developer.apple.com/documentation/realitykit/objectcapturesession/issupported
- https://developer.apple.com/documentation/realitykit/objectcaptureview
- https://developer.apple.com/augmented-reality/object-capture/
- https://developer.apple.com/videos/play/wwdc2023/10191/
- https://developer.apple.com/videos/play/wwdc2021/10076/
- https://developer.apple.com/forums/tags/object-capture
- https://developers.google.com/ar/devices
- https://developers.google.com/ar/develop/java/depth/developer-guide
- https://codelabs.developers.google.com/codelabs/arcore-rawdepthapi
- https://github.com/rolandsmeenk/ARCore-devices
- https://www.simplywise.com/blog/which-iphones-have-lidar/
- https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0314560
- https://isprs-archives.copernicus.org/articles/XLVIII-2-W8-2024/211/2024/

**APIs comerciales**
- https://www.kiriengine.app/pricing
- https://www.kiriengine.app/faq/is-kiri-engine-free
- https://radiancefields.com/platforms/kiri-engine
- https://poly.cam/pricing
- https://poly.cam/pricing/enterprise-plan
- https://poly.cam/legal/terms-of-service
- https://learn.poly.cam/hc/en-us/articles/27756102599572-What-File-Types-Can-Polycam-Export
- https://www.realityscan.com/license
- https://www.realityscan.com/eula
- https://www.realityscan.com/eula-mobile
- https://www.realityscan.com/mobile
- https://www.cgchannel.com/2025/06/epic-games-to-rebrand-realitycapture-as-realityscan-2-0/
- https://www.meshy.ai/en/pricing
- https://www.meshy.ai/terms-of-use
- https://docs.meshy.ai/en/webapp/pricing
- https://www.tripo3d.ai/pricing
- https://www.tripo3d.ai/game-development/3d-assets-license-game-development
- https://www.tripo3d.ai/features/image-to-3d-model
- https://lumalabs.ai/pricing
- https://apps.apple.com/jm/app/luma-3d-capture/id1615849914
- https://fast.io/resources/luma-ai-review-2026/

**Template fitting / analysis-by-synthesis**
- https://mlanthology.org/iccv/2011/payet2011iccv-contours/
- https://www.spiedigitallibrary.org/conference-proceedings-of-spie/7623/1/3D-shape-from-silhouette-points-in-registered-2D-images-using/10.1117/12.843885.short
- https://www.researchgate.net/publication/253873492_3D_Shape_from_Silhouette_Points_in_Registered_2D_Images_Using_Conjugate_Gradient_Method
- https://ascelibrary.org/doi/10.1061/%28ASCE%29CP.1943-5487.0001041 (Mono-Truck)
- https://www.researchgate.net/publication/362096776_Monocular_Vision-Enabled_3D_Truck_Reconstruction
- https://www.freepatentsonline.com/y2008/0294401.html (Active Shape Model for Vehicle Modeling, Siemens)
- https://www.ecva.net/papers/eccv_2020/papers_ECCV/papers/123600511.pdf (GSNet)
- https://ar5iv.labs.arxiv.org/html/2007.13124 (GSNet)
- https://ar5iv.labs.arxiv.org/html/2011.14642 (VERTEX)
- https://ar5iv.labs.arxiv.org/html/2407.16988 (DreamCar)
- https://link.springer.com/article/10.1007/s00371-020-02024-y (GAN + lazy learning)
- https://arxiv.org/html/2504.04000 (View2CAD)
- https://treese41528.github.io/VirtualHumans/lecture_06_1_SMPL_optimization.html
- https://github.com/Uness10/SMILify
- https://cma-es.github.io/cmaes_sourcecode_page.html
- https://github.com/CMA-ES/pycma
- https://pypi.org/project/cma/
- https://ojs.aaai.org/index.php/AAAI/article/download/37505/41467 (GIoU para formas paramétricas)
- https://cad-journal.net/files/vol_8/CAD_8(1)_2011_3-21.pdf (B-spline contour fitting)
- https://link.springer.com/article/10.1007/s10851-026-01282-0 (Bézier silhouette vectorization)

**Navegador / infraestructura**
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/workers/runtime-apis/webassembly/
- https://opencv.org/license/
- https://docs.opencv.org/3.4/dd/dfc/tutorial_js_grabcut.html
- https://docs.opencv.org/4.x/d4/da1/tutorial_js_setup.html
- https://answers.opencv.org/question/234301/opencvjs-grabcut-and-gc_init-with_mask/
- https://github.com/mrdoob/three.js/releases/tag/r186
- https://www.utsubo.com/blog/webgpu-threejs-migration-guide

**Ruedas / escala**
- https://www.wheel-size.com/tire/205-55r16/
- https://pressbooks.bccampus.ca/tradeskillsforsuccessnumeracy/chapter/tire-sizes-and-calculations/
- https://www.performanceplustire.com/Blog/what-size-tire-is-a-205-55r16

**Legal (NO ES ASESORÍA LEGAL)**
- https://www.sic.gov.co/disenos-industriales
- https://www.sic.gov.co/node/29
- https://www.sic.gov.co/propiedad-Industrial
- https://cyber.harvard.edu/IPCoop/91ferr1.html
- https://www.dlapiper.com/en-us/insights/publications/intellectual-property-news/2022/ipt-news-july-2022-trade-dress-protects-auto-design
- https://www.murgitroyd.com/us/insights/patents/how-intellectual-property-rights-can-protect-automotive-designs
- https://www.euipo.europa.eu/en/help-centre/design/faq-basic-questions
- https://europa.eu/youreurope/business/running-business/intellectual-property/design-protection/index_en.htm
- https://digitalcommons.lmu.edu/cgi/viewcontent.cgi?article=1518&context=ilr
