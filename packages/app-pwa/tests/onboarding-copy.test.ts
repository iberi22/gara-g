import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('OnboardingApp.svelte copy contract', () => {
  const componentPath = path.resolve(__dirname, '../src/components/prefs/OnboardingApp.svelte');
  const sourceCode = fs.readFileSync(componentPath, 'utf-8');

  it('should have exactly 6 features by id', () => {
    const idCount = (sourceCode.match(/id: '/g) || []).length;
    expect(idCount).toBe(6);
  });

  it('should explicitly mark 3 features as requiring an account', () => {
    const accountBadgeCount = (sourceCode.match(/badge: 'Con cuenta'/g) || []).length;
    expect(accountBadgeCount).toBe(3);
  });

  it('should have the updated welcome badge string and not the old one', () => {
    expect(sourceCode).toContain('badge="Sin cobro · 3 piden cuenta"');
    expect(sourceCode).not.toContain('badge="100 % gratis"');
  });

  it('should have the correct welcome lead text explaining account requirements', () => {
    expect(sourceCode).toContain('No hay tarifa');
    expect(sourceCode).toContain('piden cuenta');
  });
});
