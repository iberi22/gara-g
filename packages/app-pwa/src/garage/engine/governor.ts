/**
 * governor.ts — Governor adaptativo de calidad para 60 fps constantes.
 *
 * Mide el tiempo de frame con una media movil exponencial (EMA) y ajusta la calidad
 * en escalones (dpr -> sombras -> tier) con histeresis temporal (minimo 2 s entre cambios)
 * para evitar oscilaciones en dispositivos moviles de gama media.
 */
import type { QualityTier } from '../contracts';

export interface GovernorConfig {
  initialTier?: QualityTier | 'auto';
  devicePixelRatio?: number;
  isTouch?: boolean;
}

export function computeBaseDpr(devicePixelRatio = 1, isTouch = false): number {
  if (isTouch) {
    return Math.min(Math.max(devicePixelRatio, 1), 1.5);
  }
  return Math.min(Math.max(devicePixelRatio, 1), 2.0);
}

export class QualityGovernor {
  private tier: QualityTier = 'high';
  private auto = true;
  private baseDpr = 1.0;
  private currentDpr = 1.0;
  private shadowsEnabled = true;
  private shadowMapSize = 2048;

  private ema = 0;
  private readonly alpha = 0.05;
  private slowFrames = 0;
  private fastFrames = 0;
  private lastStepTime = -2000;

  constructor(config: GovernorConfig = {}) {
    const isTouch = config.isTouch ?? false;
    const dpr = config.devicePixelRatio ?? 1;
    this.baseDpr = computeBaseDpr(dpr, isTouch);
    this.currentDpr = this.baseDpr;

    if (config.initialTier && config.initialTier !== 'auto') {
      this.tier = config.initialTier;
      this.auto = false;
      this.applyTierSettings(this.tier);
    } else {
      this.tier = 'high';
      this.auto = true;
      this.applyTierSettings('high');
    }
  }

  public getTier(): QualityTier {
    return this.tier;
  }

  public getDpr(): number {
    return this.currentDpr;
  }

  public getShadowsEnabled(): boolean {
    return this.shadowsEnabled;
  }

  public getShadowMapSize(): number {
    return this.shadowMapSize;
  }

  public getEma(): number {
    return this.ema;
  }

  public isAuto(): boolean {
    return this.auto;
  }

  public setTier(tier: QualityTier): void {
    this.tier = tier;
    this.auto = false;
    this.applyTierSettings(tier);
  }

  /**
   * Registra un tiempo de frame (ms) y evalua si debe cambiar de escalon.
   * Retorna true si hubo un cambio en tier, DPR o sombras.
   */
  public recordFrame(frameMs: number, now = performance.now()): boolean {
    if (this.ema === 0) {
      this.ema = frameMs;
    } else {
      this.ema = this.ema * (1 - this.alpha) + frameMs * this.alpha;
    }

    if (!this.auto) return false;

    // Evaluacion de lentitud / rapidez con umbrales estrictos
    if (this.ema > 18.5) {
      this.slowFrames++;
      this.fastFrames = 0;
    } else if (this.ema < 12.0) {
      this.fastFrames++;
      this.slowFrames = 0;
    } else {
      // Zona neutral: decaer contadores lentamente
      if (this.slowFrames > 0) this.slowFrames--;
      if (this.fastFrames > 0) this.fastFrames--;
    }

    // Comprobar histeresis temporal (2000 ms minimo entre saltos)
    if (now - this.lastStepTime < 2000) {
      this.slowFrames = 0;
      this.fastFrames = 0;
      return false;
    }

    // Paso hacia abajo: 45 frames con EMA > 18.5 ms
    if (this.slowFrames >= 45) {
      this.slowFrames = 0;
      this.fastFrames = 0;
      const changed = this.stepDown();
      if (changed) {
        this.lastStepTime = now;
        return true;
      }
    }

    // Paso hacia arriba: 120 frames con EMA < 12.0 ms
    if (this.fastFrames >= 120) {
      this.slowFrames = 0;
      this.fastFrames = 0;
      const changed = this.stepUp();
      if (changed) {
        this.lastStepTime = now;
        return true;
      }
    }

    return false;
  }

  private stepDown(): boolean {
    if (this.tier === 'high') {
      if (this.currentDpr > 1.0) {
        // Primer escalon: reducir dpr a 1.0 manteniendo sombras
        this.currentDpr = 1.0;
        return true;
      }
      // Segundo escalon: pasar a medium
      this.tier = 'medium';
      this.applyTierSettings('medium');
      return true;
    }

    if (this.tier === 'medium') {
      // Tercer escalon: pasar a low (sin sombras en tiempo real)
      this.tier = 'low';
      this.applyTierSettings('low');
      return true;
    }

    // Ya en low
    return false;
  }

  private stepUp(): boolean {
    if (this.tier === 'low') {
      this.tier = 'medium';
      this.applyTierSettings('medium');
      return true;
    }

    if (this.tier === 'medium') {
      this.tier = 'high';
      this.applyTierSettings('high');
      return true;
    }

    if (this.tier === 'high' && this.currentDpr < this.baseDpr) {
      this.currentDpr = this.baseDpr;
      return true;
    }

    // Ya al maximo
    return false;
  }

  private applyTierSettings(tier: QualityTier): void {
    switch (tier) {
      case 'high':
        this.currentDpr = this.baseDpr;
        this.shadowsEnabled = true;
        this.shadowMapSize = 2048;
        break;
      case 'medium':
        this.currentDpr = Math.min(this.baseDpr, 1.25);
        this.shadowsEnabled = true;
        this.shadowMapSize = 1024;
        break;
      case 'low':
        this.currentDpr = 1.0;
        this.shadowsEnabled = false;
        this.shadowMapSize = 512;
        break;
    }
  }
}
