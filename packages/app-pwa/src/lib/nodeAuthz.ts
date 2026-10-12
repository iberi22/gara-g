/**
 * src/lib/nodeAuthz.ts — Delegación criptográfica de permisos y capacidades en malla P2P (Edge-Mesh Authz).
 *
 * Permite a una empresa conceder acceso selectivo a un operador sin exponer datos financieros o de dueño.
 * - Namespaces: operational, security, financial, config
 * - Capabilities: read, write, admin, sync
 * - Grants firmados criptográficamente verificables offline sin servidor central.
 */

import { NodeIdentityManager } from './nodeIdentity.js';

export type Capability = 'read' | 'write' | 'admin' | 'sync';

export interface NamespaceGrant {
  id: string; // Nonce único
  namespace: string; // ej: "gara-g/flota-10/operational"
  issuerNodeId: string; // Nodo dueño
  subjectNodeId: string; // Nodo operador
  capability: Capability;
  issuedAt: number;
  expiresAt: number; // TTL
  signature: string; // Firma Ed25519 del emisor
}

export class NodeAuthzManager {
  private grants: Map<string, NamespaceGrant> = new Map();

  /**
   * Genera y firma un grant de delegación emitido por el dueño para el nodo operador.
   */
  public async createGrant(
    issuerIdentity: NodeIdentityManager,
    subjectNodeId: string,
    namespace: string,
    capability: Capability,
    ttlSeconds: number = 86400 * 30, // 30 días default
  ): Promise<NamespaceGrant> {
    const id = `grant_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = Date.now();
    const expiresAt = now + ttlSeconds * 1000;

    const payloadToSign = `${id}:${namespace}:${issuerIdentity.getNodeId()}:${subjectNodeId}:${capability}:${expiresAt}`;
    const signature = await issuerIdentity.sign(payloadToSign);

    const grant: NamespaceGrant = {
      id,
      namespace,
      issuerNodeId: issuerIdentity.getNodeId(),
      subjectNodeId,
      capability,
      issuedAt: now,
      expiresAt,
      signature,
    };

    this.registerGrant(grant);
    return grant;
  }

  /**
   * Registra un grant en el almacén local del nodo.
   */
  public registerGrant(grant: NamespaceGrant): void {
    const key = `${grant.namespace}::${grant.subjectNodeId}::${grant.capability}`;
    this.grants.set(key, grant);
  }

  /**
   * Verifica offline si un sujeto tiene permiso para una capacidad sobre un namespace dado.
   */
  public async verifyPermission(
    subjectNodeId: string,
    namespace: string,
    requiredCapability: Capability,
    issuerPublicKeyHex?: string,
  ): Promise<boolean> {
    const key = `${namespace}::${subjectNodeId}::${requiredCapability}`;
    const adminKey = `${namespace}::${subjectNodeId}::admin`;

    const grant = this.grants.get(key) ?? this.grants.get(adminKey);
    if (!grant) {
      return false;
    }

    if (Date.now() > grant.expiresAt) {
      this.grants.delete(key);
      return false;
    }

    if (issuerPublicKeyHex) {
      const payloadToVerify = `${grant.id}:${grant.namespace}:${grant.issuerNodeId}:${grant.subjectNodeId}:${grant.capability}:${grant.expiresAt}`;
      const isValidSig = await NodeIdentityManager.verify(
        issuerPublicKeyHex,
        grant.signature,
        payloadToVerify,
      );
      if (!isValidSig) return false;
    }

    return true;
  }

  /**
   * Filtra las propiedades de un registro (o subdocumento) según el namespace del sujeto.
   * Ejemplo: Si el operador solo tiene acceso a "operational", se eliminan campos financieros.
   */
  public filterRestrictedFields<T extends Record<string, unknown>>(
    data: T,
    hasFinancialAccess: boolean,
  ): Partial<T> {
    if (hasFinancialAccess) {
      return data;
    }

    // Campos sensibles restringidos para operadores de flota
    const RESTRICTED_KEYS = new Set([
      'purchasePrice',
      'leasingCost',
      'ownerName',
      'ownerContact',
      'insuranceCost',
      'contractId',
      'taxValue',
    ]);

    const filtered: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (!RESTRICTED_KEYS.has(key)) {
        filtered[key] = value;
      }
    }

    return filtered as Partial<T>;
  }

  public listGrantsForSubject(subjectNodeId: string): NamespaceGrant[] {
    return Array.from(this.grants.values()).filter((g) => g.subjectNodeId === subjectNodeId);
  }
}
