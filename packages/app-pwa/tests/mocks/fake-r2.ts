// R2 en memoria: head/get/put(onlyIf)/delete, con ETag incremental como el real.
export function fakeR2() {
  const store = new Map<string, { body: Uint8Array; meta: Record<string, string>; etag: string }>();
  let n = 0;
  const obj = (key: string) => {
    const o = store.get(key)!;
    return {
      key,
      etag: o.etag,
      httpEtag: `"${o.etag}"`,
      customMetadata: o.meta,
      text: async () => new TextDecoder().decode(o.body),
    };
  };
  return {
    store,
    head: async (k: string) => (store.has(k) ? obj(k) : null),
    get: async (k: string) => (store.has(k) ? obj(k) : null),
    put: async (k: string, body: Uint8Array, opts: any) => {
      const cur = store.get(k);
      const c = opts?.onlyIf;
      if (c?.etagDoesNotMatch === '*' && cur) return null;
      if (c?.etagMatches && (!cur || cur.etag !== c.etagMatches)) return null;
      store.set(k, { body, meta: opts?.customMetadata ?? {}, etag: `e${++n}` });
      return obj(k);
    },
    delete: async (k: string) => void store.delete(k),
  };
}

