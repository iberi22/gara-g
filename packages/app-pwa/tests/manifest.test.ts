import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { wranglerToml } from '../../../scripts/infra-config.mjs';

describe('PWA Manifest & Configuration Integrity', () => {
  const manifestPath = path.resolve(process.cwd(), 'public/manifest.json');
  const astroConfigPath = path.resolve(process.cwd(), 'astro.config.mjs');
  const wranglerPath = wranglerToml().path;

  it('should exist and be valid JSON with required manifest attributes', () => {
    expect(fs.existsSync(manifestPath)).toBe(true);

    const rawContent = fs.readFileSync(manifestPath, 'utf-8');
    const manifest = JSON.parse(rawContent);

    expect(manifest.short_name).toBe('Gara-G');
    // El nombre de producto es "Gestión de Flotas", no la jerga interna DePIN:
    // es lo que ve el usuario en el prompt de instalación y en el launcher.
    expect(manifest.name).toBe('Gara-G Gestión de Flotas');
    expect(manifest.name).not.toContain('DePIN');
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/');
    expect(manifest.theme_color).toBe('#00e5ff');
    expect(manifest.background_color).toBe('#121212');

    expect(Array.isArray(manifest.icons)).toBe(true);
    expect(manifest.icons.length).toBeGreaterThanOrEqual(2);

    const has192 = manifest.icons.some((icon: { sizes: string; purpose?: string }) =>
      icon.sizes === '192x192' && icon.purpose?.includes('maskable')
    );
    const has512 = manifest.icons.some((icon: { sizes: string; purpose?: string }) =>
      icon.sizes === '512x512' && icon.purpose?.includes('maskable')
    );

    expect(has192).toBe(true);
    expect(has512).toBe(true);
  });

  /**
   * Los iconos deben ser imagenes reales, no placeholders.
   *
   * Los anteriores eran PNG de un solo color: 329 B y 355 B, con chunks IDAT de 28 y
   * 54 bytes. Se instalaban, pero se veian como un cuadrado vacio en el launcher.
   * Este test lo detecta mirando el tamano del chunk IDAT, que para una imagen plana
   * de 512x512 es trivialmente pequeno.
   */
  it('los iconos deben tener contenido real, no ser imagenes planas', () => {
    for (const size of [192, 512]) {
      const iconPath = path.resolve(process.cwd(), `public/icons/icon-${size}x${size}.png`);
      expect(fs.existsSync(iconPath)).toBe(true);

      const buf = fs.readFileSync(iconPath);
      // cabecera PNG valida
      expect(buf.subarray(0, 8)).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );

      // dimensiones correctas
      const width = buf.readUInt32BE(16);
      const height = buf.readUInt32BE(20);
      expect(width).toBe(size);
      expect(height).toBe(size);

      // mide el chunk IDAT: una imagen de un color comprime a unos pocos bytes
      let offset = 8;
      let idatBytes = 0;
      while (offset < buf.length - 8) {
        const length = buf.readUInt32BE(offset);
        const type = buf.subarray(offset + 4, offset + 8).toString('latin1');
        if (type === 'IDAT') idatBytes += length;
        offset += 12 + length;
      }
      expect(idatBytes).toBeGreaterThan(500);
    }
  });

  it('should configure vite-plugin-pwa in astro.config.mjs', () => {
    expect(fs.existsSync(astroConfigPath)).toBe(true);
    const content = fs.readFileSync(astroConfigPath, 'utf-8');
    expect(content).toContain('vite-plugin-pwa');
    expect(content).toContain('VitePWA');
    expect(content).toContain('@astrojs/cloudflare');
  });

  it('should configure wrangler.toml for gara-g worker', () => {
    expect(fs.existsSync(wranglerPath)).toBe(true);
    const content = fs.readFileSync(wranglerPath, 'utf-8');
    // Pages-only fields removed; Worker-only fields may stay
    expect(content).not.toContain('pages_build_output_dir');
    expect(content).toContain('compatibility_date');
    expect(content).toContain('compatibility_flags');
  });
});
