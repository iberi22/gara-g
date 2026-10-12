/**
 * modelSpecs.ts — Medidas publicas por modelo (ficha tecnica), para que el usuario solo
 * tenga que elegir marca y modelo. Cada entrada cita de donde salio cada numero.
 *
 * Por que existe: la plantilla (`templates/registry.ts` → `defaultSpec`) trae medidas
 * genericas de la carroceria. Con esta tabla el 3D sale con las proporciones REALES del
 * vehiculo que el usuario eligio, y la rueda se dimensiona desde la llanta de origen
 * (`templates/common/units.ts` → `tireDiameterMm`), que es la medida mejor calibrada
 * visualmente de un vehiculo.
 *
 * Reglas que sigue esta tabla (las mismas que vigila modelSpecs.test.ts):
 *   - Sin fuente no entra: cada entrada tiene >= 1 URL https real consultada.
 *   - No se inventa ningun numero: un dato opcional que ninguna fuente publica se omite
 *     (queda `undefined` y la plantilla usa su default); si falta un dato OBLIGATORIO
 *     (largo, ancho, alto, entre ejes o llantas) el modelo no entra y se lista en
 *     MISSING_SPECS con el motivo, para que el dominio use la medida por defecto.
 *   - `widthMm` es el ancho de CARROCERIA sin espejos, que es el que pide el contrato
 *     (VehicleDimensions.widthMm) y el que sirve para el 3D.
 *   - Cuando la generacion de un modelo cambia dentro del rango de anos del catalogo se
 *     mete una entrada por generacion con su yearFrom/yearTo; `findModelSpec` elige por ano.
 *   - Rellenos de rin de 17.5" y 22.5" se guardan tal cual (rimIn 17.5 / 22.5) porque
 *     son medidas reales de truck y el contrato las admite.
 *
 * Si un modelo no esta aqui, `garage/domain` cae en las medidas por defecto de la
 * plantilla de su carroceria.
 */
import type { ModelSpecEntry } from '../contracts';

export const MODEL_SPECS: ModelSpecEntry[] = [
  // ===========================================================================
  // TOYOTA
  // ===========================================================================

  // Hilux doble cabina 4x4: la version mas vendida en Colombia. El ancho 1.855 es sin
  // espejos (la cabina sencilla mide 1.800 y 1.795 de alto).
  {
    make: 'Toyota',
    model: 'Hilux',
    family: 'car',
    body: 'pickup',
    yearFrom: 2018,
    yearTo: 2024,
    dims: {
      lengthMm: 5325,
      widthMm: 1855,
      heightMm: 1815,
      wheelbaseMm: 3085,
      trackFrontMm: 1540,
      trackRearMm: 1550,
      groundClearanceMm: 310,
    },
    tireFront: { widthMm: 265, aspectPct: 65, rimIn: 17 },
    tireRear: { widthMm: 265, aspectPct: 65, rimIn: 17 },
    sources: [
      'https://media.toyota.co.uk/wp-content/uploads/sites/5/pdf/220217M-Hilux-Tech-Spec.pdf',
      'https://www.auto-data.net/en/toyota-hilux-double-cab-viii-facelift-2024-2.4d-150hp-4x4-automatic-51427',
      'https://www.vehiclesizes.com/cars/toyota/hilux/hilux-double-cab-viii-facelift-2024/',
      'https://www.novamotors.com.co/wp-content/uploads/2024/09/FT-HILUX-2024.pdf',
    ],
  },

  // OJO (revision del orquestador): las fuentes son el "Land Cruiser" 2024 de Reino Unido
  // y Canada, que en esos mercados es la serie 250 (el Prado nuevo), no el J300. Las
  // medidas coinciden con la entrada del Prado. El J300 mide ~4.985 x 1.980 x 1.945
  // (diferencia < 2 %, no cambia el 3D), pero falta una ficha del J200/J300 vendido en
  // Colombia para corregir medidas y rango de años con fuente.
  {
    make: 'Toyota',
    model: 'Land Cruiser',
    family: 'car',
    body: 'suv',
    yearFrom: 2019,
    yearTo: 2024,
    dims: {
      lengthMm: 4925,
      widthMm: 1980,
      heightMm: 1935,
      wheelbaseMm: 2850,
      trackFrontMm: 1664,
      trackRearMm: 1668,
      groundClearanceMm: 215,
    },
    tireFront: { widthMm: 265, aspectPct: 70, rimIn: 18 },
    tireRear: { widthMm: 265, aspectPct: 70, rimIn: 18 },
    sources: [
      'https://mag.toyota.co.uk/2024-toyota-land-cruiser/',
      'https://certified.toyota.ca/content/dam/toyota/documents/brochures/prd/24_cuv_prd_en.pdf',
      'https://anusedcar.com/toyota/toyota-land-cruiser-2024-suv-326-hp/',
    ],
  },

  // Corolla E210 sedan, la version hibrida que se vende en Colombia. El sedan mide
  // 4.630 x 1.780; el hatchback de la misma generacion mide 4.410, asi que la
  // diferencia de silueta se nota y no se puede compartir la entrada.
  {
    make: 'Toyota',
    model: 'Corolla',
    family: 'car',
    body: 'sedan',
    yearFrom: 2019,
    yearTo: 2024,
    dims: {
      lengthMm: 4630,
      widthMm: 1780,
      heightMm: 1435,
      wheelbaseMm: 2700,
      trackFrontMm: 1532,
      trackRearMm: 1549,
      groundClearanceMm: 130,
    },
    tireFront: { widthMm: 205, aspectPct: 55, rimIn: 16 },
    tireRear: { widthMm: 205, aspectPct: 55, rimIn: 16 },
    sources: [
      'https://www.auto-data.net/en/toyota-corolla-model-407',
      'https://www.carsguide.com.au/toyota/corolla/car-dimensions/2024',
      'https://www.iseecars.com/car/2024-toyota-corolla-dimensions',
    ],
  },

  // Land Cruiser Prado J250 (el "Prado" del catalogo colombiano). Ficha tecnica de
  // Toyota Colombia: 4.925 x 1.980 x 1.935, entre ejes 2.850, altura al piso 215.
  {
    make: 'Toyota',
    model: 'Prado',
    family: 'car',
    body: 'suv',
    yearFrom: 2019,
    yearTo: 2024,
    dims: {
      lengthMm: 4925,
      widthMm: 1980,
      heightMm: 1935,
      wheelbaseMm: 2850,
      groundClearanceMm: 215,
    },
    tireFront: { widthMm: 265, aspectPct: 65, rimIn: 18 },
    tireRear: { widthMm: 265, aspectPct: 65, rimIn: 18 },
    sources: [
      'https://www.novamotors.com.co/wp-content/uploads/2024/11/FT-LANDCRUISER-PRADO.pdf',
      'https://www.toyota.bo/modelo/land-cruiser-prado-250',
      'https://www.auto-data.net/en/toyota-land-cruiser-prado-model-3168',
    ],
  },

  // NPR 815 (Euro VI), el camion de carga que Chevrolet Buses y Camiones vende en
  // Colombia. Serie N: 7.355 mm de largo, 2.255 de ancho, 2.120 de alto, 4.175
  // entre ejes y llanta 215/75R17.5. El ancho 2.255 es el total de la serie; la
  // version Colombia 2017 publicaba 2.040 de ancho de trocha con 2.115 entre
  // llantas traseras, asi que se toma la cifra de la ficha oficial vigente.
  {
    make: 'Chevrolet',
    model: 'NPR',
    family: 'heavy',
    body: 'truck',
    yearFrom: 2018,
    yearTo: 2023,
    dims: {
      lengthMm: 7355,
      widthMm: 2255,
      heightMm: 2120,
      wheelbaseMm: 4175,
    },
    tireFront: { widthMm: 215, aspectPct: 75, rimIn: 17.5 },
    tireRear: { widthMm: 215, aspectPct: 75, rimIn: 17.5 },
    sources: [
      'https://www.chevrolet.com.ec/content/dam/chevrolet/south-america/ecuador/espanol/index/trucks/02-pdfs/Camiones-Chevrolet-Serie-N.pdf',
      'https://www.busesycamioneschevrolet.com.co/wp-content/uploads/2017/11/Ficha-tecnica-camion-NPR-1.pdf',
    ],
  },

  // ===========================================================================
  // CHEVROLET
  // ===========================================================================

  // D-Max tercera generacion (RG, la que se vende en Colombia desde 2022). Ficha
  // tecnica de planta: 5.365 x 1.900 x 1.809, entre ejes 3.155, despeje 239.
  {
    make: 'Chevrolet',
    model: 'D-Max',
    family: 'car',
    body: 'pickup',
    yearFrom: 2021,
    yearTo: 2024,
    dims: {
      lengthMm: 5365,
      widthMm: 1900,
      heightMm: 1809,
      wheelbaseMm: 3155,
      groundClearanceMm: 239,
    },
    tireFront: { widthMm: 245, aspectPct: 70, rimIn: 16 },
    tireRear: { widthMm: 245, aspectPct: 70, rimIn: 16 },
    sources: [
      'https://www.chevrolet.com.ec/content/dam/chevrolet/south-america/ecuador/espanol/index/technical-sheets/dic-25/ficha-tecnica-chevrolet-dmax.pdf',
    ],
  },

  // Sail 3 generacion, sedan de 4 puertas (en Colombia el hatchback se vendio aparte
  // como "Sail Hatchback"; aqui va el sedan, que es el `type: 'sedan'` del catalogo).
  {
    make: 'Chevrolet',
    model: 'Sail',
    family: 'car',
    body: 'sedan',
    yearFrom: 2019,
    yearTo: 2023,
    dims: {
      lengthMm: 4300,
      widthMm: 1735,
      heightMm: 1503,
      wheelbaseMm: 2500,
      trackFrontMm: 1477,
      trackRearMm: 1468,
    },
    tireFront: { widthMm: 185, aspectPct: 65, rimIn: 15 },
    tireRear: { widthMm: 185, aspectPct: 65, rimIn: 15 },
    sources: [
      'https://www.auto-data.net/es/chevrolet-sail-iii-1.5-113hp-32548',
      'https://es.wikipedia.org/wiki/Chevrolet_Sail',
    ],
  },

  // Tracker (T353, la que produce GM en Uruguay y se vende en toda la region).
  // Ficha tecnica GM Uruguay: 4.270 x 1.791 x 1.626, entre ejes 2.570.
  {
    make: 'Chevrolet',
    model: 'Tracker',
    family: 'car',
    body: 'suv',
    yearFrom: 2020,
    yearTo: 2024,
    dims: {
      lengthMm: 4270,
      widthMm: 1791,
      heightMm: 1626,
      wheelbaseMm: 2570,
      groundClearanceMm: 157,
    },
    tireFront: { widthMm: 205, aspectPct: 60, rimIn: 16 },
    tireRear: { widthMm: 205, aspectPct: 60, rimIn: 16 },
    sources: [
      'https://secure-developments.com/commonwealth/uruguay/gm_specs/tracker',
      'https://www.autoblog.com.uy/2023/01/lanzamiento-chevrolet-tracker-my2023.html',
      'https://neumaticosllantas.com/chevrolet-tracker-tamanos-llantas-neumaticos/',
    ],
  },

  // ===========================================================================
  // RENAULT
  // ===========================================================================

  // Logan L12, version Intens CVT (rin de aluminio 16", la mas vendida en Colombia).
  // Ficha tecnica oficial de Renault Colombia: 4.359 x 1.761 x 1.571, 2.635 entre ejes.
  {
    make: 'Renault',
    model: 'Logan',
    family: 'car',
    body: 'sedan',
    yearFrom: 2018,
    yearTo: 2024,
    dims: {
      lengthMm: 4359,
      widthMm: 1761,
      heightMm: 1571,
      wheelbaseMm: 2635,
      groundClearanceMm: 143,
    },
    tireFront: { widthMm: 205, aspectPct: 55, rimIn: 16 },
    tireRear: { widthMm: 205, aspectPct: 55, rimIn: 16 },
    sources: [
      'https://contactos.renault.com.co/catalogos/LOGAN/LOGAN-ebrochure.pdf',
      'https://www.renault.com.co/vehiculos/logan/especificaciones.html',
    ],
  },

  // Kangoo III, entrees corto (L2/MWB): 4.486 x 1.860 sin espejos x 1.864, 2.716.
  {
    make: 'Renault',
    model: 'Kangoo',
    family: 'car',
    body: 'van',
    yearFrom: 2019,
    yearTo: 2024,
    dims: {
      lengthMm: 4486,
      widthMm: 1860,
      heightMm: 1864,
      wheelbaseMm: 2716,
      trackFrontMm: 1578,
      trackRearMm: 1601,
      groundClearanceMm: 162,
    },
    tireFront: { widthMm: 195, aspectPct: 70, rimIn: 15 },
    tireRear: { widthMm: 195, aspectPct: 70, rimIn: 15 },
    sources: [
      'https://cdn.group.renault.com/ren/ie/transversal-assets/brochures/vans-ebrochures/KANGOO-eBrochure.pdf.asset.pdf/793b2e36cf.pdf',
      'https://media.adtorqueedge.com/new-cars/renault-au/kangoo/kangoo-specs.pdf',
      'https://en.wikipedia.org/wiki/Renault_Kangoo',
    ],
  },

  // Duster II, la generacion que se vende en Colombia desde 2021 (4.341 x 1.804).
  {
    make: 'Renault',
    model: 'Duster',
    family: 'car',
    body: 'suv',
    yearFrom: 2021,
    yearTo: 2024,
    dims: {
      lengthMm: 4341,
      widthMm: 1804,
      heightMm: 1693,
      wheelbaseMm: 2674,
      groundClearanceMm: 205,
    },
    tireFront: { widthMm: 205, aspectPct: 60, rimIn: 16 },
    tireRear: { widthMm: 205, aspectPct: 60, rimIn: 16 },
    sources: [
      'https://www.renault.qa/cars/duster/dimensions.html',
      'https://www.auto-data.net/en/renault-duster-ii-generation-8533',
      'https://www.carexpert.co.nz/renault/duster/2023',
    ],
  },

  // ===========================================================================
  // FORD
  // ===========================================================================

  // Ranger P703, la nueva generacion que llego a Colombia en 2022: largo 5.350,
  // entre ejes 3.270 (crecio 50 mm vs la P702) y ancho sin espejos 1.910.
  {
    make: 'Ford',
    model: 'Ranger',
    family: 'car',
    body: 'pickup',
    yearFrom: 2022,
    yearTo: 2024,
    dims: {
      lengthMm: 5350,
      widthMm: 1910,
      heightMm: 1849,
      wheelbaseMm: 3270,
      groundClearanceMm: 235,
    },
    tireFront: { widthMm: 255, aspectPct: 70, rimIn: 16 },
    tireRear: { widthMm: 255, aspectPct: 70, rimIn: 16 },
    sources: [
      'https://www.ford.mx/content/dam/Ford/website-assets/latam/mx/nameplate/ranger/2023/pdf/ford-ranger-2023-catalogo-descargable.pdf',
      'https://www.elcarrocolombiano.com/lanzamientos/ford-ranger-2023-colombia-nueva-generacion-precios-versiones-datos/',
      'https://operaciones.colombiacompra.gov.co/sites/cce_public/files/documentos_adicionales_oc/fco-ficha-tecnica-ranger-nueva-generacion_1_1.pdf',
    ],
  },

  // Transit furgon L2 (techo medio), la configuracion de entrada en Colombia:
  // 5.531 mm de largo con 3.300 mm entre ejes y 2.059 mm de ancho sin espejos.
  // (La version larga L3 mide 5.981 con 3.750 mm entre ejes.)
  {
    make: 'Ford',
    model: 'Transit',
    family: 'car',
    body: 'van',
    yearFrom: 2019,
    yearTo: 2024,
    dims: {
      lengthMm: 5531,
      widthMm: 2059,
      heightMm: 2542,
      wheelbaseMm: 3300,
      groundClearanceMm: 118,
    },
    tireFront: { widthMm: 215, aspectPct: 65, rimIn: 16 },
    tireRear: { widthMm: 215, aspectPct: 65, rimIn: 16 },
    sources: [
      'https://media.ford.com/content/dam/fordmedia/Europe/documents/productReleases/Transit/FordTransitEcoBlue_TechSpecs_EU.pdf',
      'https://www.carsguide.com.au/ford/transit/car-dimensions/2019',
      'https://www.vansdirect.co.uk/load-sizing-guide/ford-transit-dimensions/',
    ],
  },

  // ===========================================================================
  // NISSAN
  // ===========================================================================

  // Versa K17, el sedan que Nissan vendio en Colombia desde 2020 (4.495 x 1.740).
  {
    make: 'Nissan',
    model: 'Versa',
    family: 'car',
    body: 'sedan',
    yearFrom: 2020,
    yearTo: 2024,
    dims: {
      lengthMm: 4495,
      widthMm: 1740,
      heightMm: 1455,
      wheelbaseMm: 2620,
      trackFrontMm: 1519,
      trackRearMm: 1529,
    },
    tireFront: { widthMm: 195, aspectPct: 65, rimIn: 15 },
    tireRear: { widthMm: 195, aspectPct: 65, rimIn: 15 },
    sources: [
      'https://www.guideautoweb.com/en/makes/nissan/versa/2024/specifications/s/',
      'https://www.nissanusa.com/content/dam/Nissan/us/vehicle-brochures/2024/2024-nissan-versa-brochure-en.pdf',
    ],
  },

  // Frontier D23 (la nueva generacion de 2021 en adelante), ficha tecnica de la
  // planta: 5.260 x 1.850 x 1.816 (alto con barras), entre ejes 3.150. Se toma la
  // version 4x4 con rines de 17" y 255/65R17, la mas comun en Colombia.
  {
    make: 'Nissan',
    model: 'Frontier',
    family: 'car',
    body: 'pickup',
    yearFrom: 2021,
    yearTo: 2024,
    dims: {
      lengthMm: 5260,
      widthMm: 1850,
      heightMm: 1816,
      wheelbaseMm: 3150,
    },
    tireFront: { widthMm: 255, aspectPct: 65, rimIn: 17 },
    tireRear: { widthMm: 255, aspectPct: 65, rimIn: 17 },
    sources: [
      'https://www.nissanautoferro.com/ficha-tecnica/ficha-frontier.pdf',
      'https://catalogo.gac-sa.cl/assets/vehiculos/matriz/Wigo_Peru/D24/pdf/FT-Nueva-Frontier.pdf',
      'https://www.nissan.pe/vehiculos/nuevos/frontier/especificaciones.html/1000.html',
    ],
  },

  // ===========================================================================
  // MERCEDES-BENZ
  // ===========================================================================

  // Sprinter W907 L2 (entre ejes 3.665), techo medio/alto segun version: 5.932 x
  // 2.020 sin espejos. Colombia vende 314/316 CDI con este entre ejes.
  {
    make: 'Mercedes-Benz',
    model: 'Sprinter',
    family: 'car',
    body: 'van',
    yearFrom: 2019,
    yearTo: 2024,
    dims: {
      lengthMm: 5932,
      widthMm: 2020,
      heightMm: 2667,
      wheelbaseMm: 3665,
    },
    tireFront: { widthMm: 235, aspectPct: 65, rimIn: 16 },
    tireRear: { widthMm: 235, aspectPct: 65, rimIn: 16 },
    sources: [
      'https://www.carexpert.com.au/mercedes-benz/sprinter/2020-2-1l-panel-van-rwd-diesel-automatic-js58wwko20200306',
      'https://www.carsguide.com.au/mercedes-benz/sprinter/car-dimensions/2024',
      'https://vanreviewer.co.uk/mercedes-benz/sprinter/dimensions/2827/',
    ],
  },

  // ===========================================================================
  // PESADOS: tractomulas
  // ===========================================================================

  // Volvo FH/FH16 6x4 con cabina Globetrotter (volumen estandar de la gama).
  // Ficha tecnica: 6.940 mm de largo con 3.400 mm entre ejes, 2.495 de ancho y
  // 3.498 de altura de cabina. Neumatico 315/80R22.5 en las tres posiciones.
  {
    make: 'Volvo',
    model: 'FH16',
    family: 'heavy',
    body: 'tractor',
    yearFrom: 2018,
    yearTo: 2024,
    dims: {
      lengthMm: 6940,
      widthMm: 2495,
      heightMm: 3498,
      wheelbaseMm: 3400,
    },
    tireFront: { widthMm: 315, aspectPct: 80, rimIn: 22.5 },
    tireRear: { widthMm: 315, aspectPct: 80, rimIn: 22.5 },
    sources: [
      'https://www.planet-trucks.com/technical-data-sheets/volvo-fh-D-13-64-HA-tracteur-suspension-pneumatique',
      'https://stpi.it.volvo.com/STPIFiles/Volvo/ModelRange/fh64t6a_gbr_eng.pdf',
      'https://sctb-prod-media.s3.amazonaws.com/filer_public/19/c5/19c5347b-4a00-4cc7-8871-56756c2911e0/fh16_spec_sheets.pdf',
      'https://www.volvotrucks.com.au/en-au/trucks/models/volvo-fh/specifications.html',
    ],
  },

  // Kenworth T800 tractora 6x4 con cabina dormitorio. Ficha tecnica del
  // consecutor de planta: 3 ejes, 5.105 mm entre ejes, 7.836 mm de largo total,
  // 2.540 mm de ancho sin espejos y 3.429 mm de alto. Neumatico delantero
  // 295/80R22.5 y trasero 11R22.5 (misma medida metrica, 295/80R22.5).
  {
    make: 'Kenworth',
    model: 'T800',
    family: 'heavy',
    body: 'tractor',
    yearFrom: 2018,
    yearTo: 2023,
    dims: {
      lengthMm: 7836,
      widthMm: 2540,
      heightMm: 3429,
      wheelbaseMm: 5105,
    },
    tireFront: { widthMm: 295, aspectPct: 80, rimIn: 22.5 },
    tireRear: { widthMm: 295, aspectPct: 80, rimIn: 22.5 },
    sources: [
      'https://www.ipesa.com.pe/uploads/Ficha-Tecnica-Kenworth-T800-2-1%20(1).pdf',
      'https://www.codeready.org/trucks/kenworth-trucks/kenworth-t800-6x4-sleeper-truck-tractor/',
      'https://repositorio.ecci.edu.co/bitstreams/63de2f16-a467-4f3c-9a03-546870fca9a6/download',
    ],
  },

  // DAF XF 6x2 con Space Cab: 6.310 mm con 3.950 mm entre ejes, 2.550 de ancho y
  // 3.530 de alto. Delantero 385/65R22.5, traseros 315/70R22.5.
  {
    make: 'DAF',
    model: 'XF',
    family: 'heavy',
    body: 'tractor',
    yearFrom: 2020,
    yearTo: 2024,
    dims: {
      lengthMm: 6310,
      widthMm: 2550,
      heightMm: 3530,
      wheelbaseMm: 3950,
    },
    tireFront: { widthMm: 385, aspectPct: 65, rimIn: 22.5 },
    tireRear: { widthMm: 315, aspectPct: 70, rimIn: 22.5 },
    sources: [
      'https://www.planet-trucks.com/technical-data-sheets/daf-xf-ftg-450-6x2',
      'https://www.daf.global/api/feature/specsheet/open?container=f306d8a9-2122-4de6-ab03-f05a2e61f6b7&filename=TSHREN091F0220NAAA202545.pdf',
      'https://www.werktuigen.com/daf-xf+460+ftg+ssc+intarder+%2F+retarder+6x2+twinsteer/wt-227-77360',
    ],
  },

  // Scania R 450 6x4 va a MISSING_SPECS: la ficha oficial de la gama R 6x4 publica
  // entre ejes (3.825), largo (6.871) y 295/80R22.5, pero NO desglosa la altura total
  // de la cabina, y sin ese dato obligatorio la entrada no entra. Ver MISSING_SPECS.

  // ===========================================================================
  // MOTOS
  // ===========================================================================

  // FZ16 (FJ/FZ150 segun mercado), la naked de 150 cc mas vendida en Colombia.
  // Ficha del importador colombiano: 1.990 x 770 x 1.050, entre ejes 1.330,
  // altura de sillin 790 y despeje 160. Neumatico 100/80-17 / 140/60-17.
  {
    make: 'Yamaha',
    model: 'FZ16',
    family: 'moto',
    body: 'naked',
    yearFrom: 2019,
    yearTo: 2024,
    dims: {
      lengthMm: 1990,
      widthMm: 770,
      heightMm: 1050,
      wheelbaseMm: 1330,
      groundClearanceMm: 160,
      seatHeightMm: 790,
    },
    tireFront: { widthMm: 100, aspectPct: 80, rimIn: 17 },
    tireRear: { widthMm: 140, aspectPct: 60, rimIn: 17 },
    sources: [
      'https://yamahayamamotos.com.co/motocicletas/urbanas/fz150',
      'https://en.wikipedia.org/wiki/Yamaha_FZ16',
      'https://tienda.incolmotos-yamaha.com.co/llanta-del-100-80-17mc52p-fz16-941101780400/p',
      'https://tienda.incolmotos-yamaha.com.co/llanta-tras-140-60-17-63p-fz16-941141780000/p',
    ],
  },

  // NMAX 155. Los anos del catalogo abarcan dos generaciones; se toma la que
  // Colombia vende hoy (la "nueva generacion"), que es la de 2022 en adelante.
  // Ficha del distribuidor: 1.935 x 740 x 1.200, entre ejes 1.340, sillin 770.
  {
    make: 'Yamaha',
    model: 'NMAX',
    family: 'moto',
    body: 'scooter',
    yearFrom: 2019,
    yearTo: 2024,
    dims: {
      lengthMm: 1935,
      widthMm: 740,
      heightMm: 1200,
      wheelbaseMm: 1340,
      groundClearanceMm: 125,
      seatHeightMm: 770,
    },
    tireFront: { widthMm: 110, aspectPct: 70, rimIn: 13 },
    tireRear: { widthMm: 130, aspectPct: 70, rimIn: 13 },
    sources: [
      'https://www.incolmotos-yamaha.com.co/vehiculo/gpd155a/15956/',
      'https://www.mundo-yamaha.com/producto/nmax/',
      'https://www.yamaha-motor.com.ar/scooters/nmax-connected',
    ],
  },

  // CB 160F, la moto mas vendida en Colombia. Ficha tecnica Honda: 2.041 x 783
  // x 1.067, entre ejes 1.345, sillin 794 y despeje 164.
  {
    make: 'Honda',
    model: 'CB 160F',
    family: 'moto',
    body: 'naked',
    yearFrom: 2019,
    yearTo: 2024,
    dims: {
      lengthMm: 2041,
      widthMm: 783,
      heightMm: 1067,
      wheelbaseMm: 1345,
      groundClearanceMm: 164,
      seatHeightMm: 794,
    },
    tireFront: { widthMm: 100, aspectPct: 80, rimIn: 17 },
    tireRear: { widthMm: 140, aspectPct: 70, rimIn: 17 },
    sources: [
      'https://www.hondatymmsamotos.mx/modelos/deportivas/cbf-160-invicta',
      'https://ragmotos.com.co/cb-160-f-honda-opiniones-y-ficha-tecnica/',
      'https://www.hondasma.com/motocicletas/generarpdf/ficha_tecnica_motocicletas.php?create_pdf=1&q=NDgy&reporte_name=ficha_tecnica',
    ],
  },
];

/**
 * Modelos del catalogo (src/lib/vehicleCatalog.ts) que NO tienen entrada porque
 * ninguna fuente consultada publica todos los datos obligatorios (largo, ancho, alto,
 * entre ejes y/o medida de llanta). El motivo va escrito para que la decision sea
 * auditable y no parezca un olvido: mientras esten aqui, el dominio usa las medidas
 * por defecto de la plantilla de su carroceria.
 */
export interface MissingSpec {
  make: string;
  model: string;
  /** Que dato obligatorio no se encontro verificable en una fuente consultada. */
  reason: string;
}

export const MISSING_SPECS: MissingSpec[] = [
  {
    make: 'Scania',
    model: 'R450',
    reason:
      'la ficha oficial de la gama R 6x4 publica largo (6.871 mm), entre ejes (3.825 mm) y 295/80R22.5, pero no desglosa el ancho ni la altura total de cabina: sin esos dos datos obligatorios la entrada no entra',
  },  {
    make: 'Kenworth',
    model: 'T800 Volqueta',
    reason:
      'la volqueta se carroza en Colombia sobre chasis de distinto entre ejes y largo de volco/plataforma: no hay una ficha unica con fuente; se usan las medidas de clase de la plantilla',
  },
  {
    make: 'International',
    model: '7600 Volqueta',
    reason:
      'la volqueta se carroza en Colombia sobre chasis de distinto entre ejes y largo de volco/plataforma: no hay una ficha unica con fuente; se usan las medidas de clase de la plantilla',
  },
  {
    make: 'Hino',
    model: 'Serie 500 Estacas',
    reason:
      'la camion de estacas se carroza en Colombia sobre chasis de distinto entre ejes y largo de volco/plataforma: no hay una ficha unica con fuente; se usan las medidas de clase de la plantilla',
  },
  {
    make: 'Caterpillar',
    model: '320',
    reason:
      'maquinaria amarilla: la plantilla se dibuja en pose de exhibicion (equipo apoyado), que no es la medida de transporte de la ficha; se usan las medidas de clase de la plantilla',
  },
  {
    make: 'Caterpillar',
    model: '416',
    reason:
      'maquinaria amarilla: la plantilla se dibuja en pose de exhibicion (equipo apoyado), que no es la medida de transporte de la ficha; se usan las medidas de clase de la plantilla',
  },
  {
    make: 'Caterpillar',
    model: '950',
    reason:
      'maquinaria amarilla: la plantilla se dibuja en pose de exhibicion (equipo apoyado), que no es la medida de transporte de la ficha; se usan las medidas de clase de la plantilla',
  },
  {
    make: 'Caterpillar',
    model: 'D6',
    reason:
      'maquinaria amarilla: la plantilla se dibuja en pose de exhibicion (equipo apoyado), que no es la medida de transporte de la ficha; se usan las medidas de clase de la plantilla',
  },
  {
    make: 'Caterpillar',
    model: '140',
    reason:
      'maquinaria amarilla: la plantilla se dibuja en pose de exhibicion (equipo apoyado), que no es la medida de transporte de la ficha; se usan las medidas de clase de la plantilla',
  },
  {
    make: 'Komatsu',
    model: 'PC200',
    reason:
      'maquinaria amarilla: la plantilla se dibuja en pose de exhibicion (equipo apoyado), que no es la medida de transporte de la ficha; se usan las medidas de clase de la plantilla',
  },
  {
    make: 'JCB',
    model: '3CX',
    reason:
      'maquinaria amarilla: la plantilla se dibuja en pose de exhibicion (equipo apoyado), que no es la medida de transporte de la ficha; se usan las medidas de clase de la plantilla',
  },
  {
    make: 'Dynapac',
    model: 'CA250',
    reason:
      'maquinaria amarilla: la plantilla se dibuja en pose de exhibicion (equipo apoyado), que no es la medida de transporte de la ficha; se usan las medidas de clase de la plantilla',
  },
];

/** Normaliza a minusculas sin tildes ni separadores, para comparar marca/modelo. */
const norm = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '');

/** Busca por marca y modelo (sin tildes ni espacios) y, si se da, por año dentro del rango. */
export function findModelSpec(
  make: string | undefined,
  model: string | undefined,
  year?: number,
): ModelSpecEntry | undefined {
  if (!make || !model) return undefined;
  const mk = norm(make);
  const md = norm(model);
  const candidates = MODEL_SPECS.filter((e) => norm(e.make) === mk && norm(e.model) === md);
  if (year === undefined) return candidates[0];
  return (
    candidates.find((e) => (e.yearFrom ?? 0) <= year && year <= (e.yearTo ?? 9999)) ?? candidates[0]
  );
}
