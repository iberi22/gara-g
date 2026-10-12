/**
 * index.ts — Barril del paquete mesh. Solo exporta lo que es seguro importar desde codigo
 * que tambien corre en el Worker: ninguno de estos modulos importa edge-mesh de forma
 * estatica (node.ts lo carga con import() solo en el navegador).
 *
 * `createMemoryMeshPort` (memoryPort.ts) NO esta aqui a proposito: arrastra edge-mesh. Las
 * pruebas lo importan directamente de './memoryPort'.
 */
export * from './contracts';
export * from './geocell';
export { LocalMeshHub } from './localHub';
export { DEFAULT_SIGNAL_URL, type MeshNodeOptions, createEphemeralPort, getMeshPort, resetMeshPort, resolveSignalUrl } from './node';
