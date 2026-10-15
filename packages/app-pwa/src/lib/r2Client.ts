import { type SealedPack, verifySealedPackHash, createSealedPack } from './sealedPack.js';

export interface R2ClientOptions {
  bucketName?: string;
  r2Binding?: unknown;
}

export interface UploadResult {
  contentHash: string;
  key: string;
  url: string;
  uploadedAt: number;
}

/**
 * R2StorageClient - Handles 100% encrypted SealedPack storage in Cloudflare R2 using AES-GCM.
 * All uploads pass through createSealedPack to seal payload before storing on R2.
 */
export class R2StorageClient {
  private bucketName: string;
  private r2Binding?: unknown;
  private memoryStore: Map<string, SealedPack> = new Map();

  constructor(options: R2ClientOptions = {}) {
    this.bucketName = options.bucketName || 'swal-r2-vault';
    this.r2Binding = options.r2Binding;
  }

  /**
   * Helper to seal raw payload using AES-GCM encryption and upload to R2
   */
  public async sealAndUpload(
    payload: Uint8Array,
    metadata: Record<string, unknown> = {},
  ): Promise<{ pack: SealedPack; upload: UploadResult }> {
    const pack = await createSealedPack(payload, metadata);
    const upload = await this.uploadSealedPack(pack);
    return { pack, upload };
  }

  public async uploadSealedPack(pack: SealedPack): Promise<UploadResult> {
    if (!pack?.content_hash) {
      throw new Error('Invalid SealedPack: missing content_hash');
    }

    const key = `packs/${pack.content_hash}.json`;
    const packJsonForCloud = JSON.stringify({ ...pack, shares: [] });
    const packJsonForMemory = JSON.stringify(pack);

    const binding = this.r2Binding as
      | { put?: (k: string, v: string, opts?: unknown) => Promise<unknown> }
      | undefined;
    if (binding && typeof binding.put === 'function') {
      await binding.put(key, packJsonForCloud, {
        httpMetadata: { contentType: 'application/json' },
      });
    }

    this.memoryStore.set(pack.content_hash, JSON.parse(packJsonForMemory));

    return {
      contentHash: pack.content_hash,
      key,
      url: `https://r2.swal.network/${this.bucketName}/${key}`,
      uploadedAt: Date.now(),
    };
  }

  public async getSealedPack(contentHash: string): Promise<SealedPack | null> {
    const binding = this.r2Binding as { get?: (k: string) => Promise<unknown> } | undefined;
    if (binding && typeof binding.get === 'function') {
      const key = `packs/${contentHash}.json`;
      const obj = (await binding.get(key)) as { text?: () => Promise<string> } | string | null;
      if (obj) {
        const text =
          typeof obj === 'object' && obj !== null && typeof obj.text === 'function'
            ? await obj.text()
            : (obj as string);
        return JSON.parse(text);
      }
    }

    return this.memoryStore.get(contentHash) || null;
  }

  public async verifyR2PackIntegrity(contentHash: string): Promise<boolean> {
    const pack = await this.getSealedPack(contentHash);
    if (!pack) return false;
    return await verifySealedPackHash(pack);
  }
}
