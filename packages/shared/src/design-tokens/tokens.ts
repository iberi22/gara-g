/**
 * Complete Design Token System
 * Aggregates all design tokens into a single exportable object
 */

import { accessibility } from "./accessibility";
import { animations, motionVariants } from "./animations";
import {
	breakpoints,
	containerMaxWidths,
	deviceTargets,
	gridSystem,
} from "./breakpoints";
import { colors, gradients } from "./colors";
import { dropShadow, elevation, shadows, textShadow } from "./shadows";
import { borderRadius, semanticSpacing, spacing, zIndex } from "./spacing";
import { generateCSSCustomProperties, themes } from "./themes";
import { fontFamily, semanticTypography, typography } from "./typography";

export interface DesignTokens {
	colors: typeof colors;
	gradients: typeof gradients;
	spacing: typeof spacing;
	semanticSpacing: typeof semanticSpacing;
	borderRadius: typeof borderRadius;
	zIndex: typeof zIndex;
	typography: typeof typography;
	semanticTypography: typeof semanticTypography;
	fontFamily: typeof fontFamily;
	shadows: typeof shadows;
	elevation: typeof elevation;
	dropShadow: typeof dropShadow;
	textShadow: typeof textShadow;
	animations: typeof animations;
	motionVariants: typeof motionVariants;
	accessibility: typeof accessibility;
	breakpoints: typeof breakpoints;
	containerMaxWidths: typeof containerMaxWidths;
	gridSystem: typeof gridSystem;
	deviceTargets: typeof deviceTargets;
	themes: typeof themes;
	utils: {
		generateCSSCustomProperties: typeof generateCSSCustomProperties;
	};
}

// Complete design token system
export const designTokens: DesignTokens = {
	colors,
	gradients,
	spacing,
	semanticSpacing,
	borderRadius,
	zIndex,
	typography,
	semanticTypography,
	fontFamily,
	shadows,
	elevation,
	dropShadow,
	textShadow,
	animations,
	motionVariants,
	accessibility,
	breakpoints,
	containerMaxWidths,
	gridSystem,
	deviceTargets,
	themes,
	utils: {
		generateCSSCustomProperties,
	},
};

// Recursive type for nested token objects
type TokenObject =
	| { [key: string]: string | number | TokenObject }
	| Record<string, unknown>;

// Type-safe token access helpers
export const getToken = {
	color: (path: string) => {
		const keys = path.split(".");
		let value: TokenObject = colors as unknown as TokenObject;
		for (const key of keys) {
			const nextValue = value[key];
			if (typeof nextValue === "string" || typeof nextValue === "number") {
				return nextValue;
			}
			if (typeof nextValue === "object" && nextValue !== null) {
				value = nextValue as TokenObject;
			} else {
				return undefined;
			}
		}
		return value;
	},
	spacing: (key: keyof typeof spacing) => spacing[key],
	shadow: (key: keyof typeof shadows) => shadows[key],
	typography: (path: string) => {
		const keys = path.split(".");
		let value: TokenObject = typography as unknown as TokenObject;
		for (const key of keys) {
			const nextValue = value[key];
			if (typeof nextValue === "string" || typeof nextValue === "number") {
				return nextValue;
			}
			if (typeof nextValue === "object" && nextValue !== null) {
				value = nextValue as TokenObject;
			} else {
				return undefined;
			}
		}
		return value;
	},
	breakpoint: (key: keyof typeof breakpoints.values) => breakpoints.values[key],
};

// Validation helpers
export const validateToken = {
	color: (color: string): boolean => {
		// Basic HSL/RGB/HEX validation
		const hslRegex = /^hsl\(\s*\d+\s*,\s*\d+%\s*,\s*\d+%\s*\)$/;
		const rgbRegex = /^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/;
		const hexRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
		return hslRegex.test(color) || rgbRegex.test(color) || hexRegex.test(color);
	},
	spacing: (value: string): boolean => {
		// Validate spacing values (px, rem, em, %)
		const spacingRegex = /^\d+(\.\d+)?(px|rem|em|%)$/;
		return spacingRegex.test(value) || value === "0";
	},
	breakpoint: (value: string): boolean => {
		// Validate breakpoint values (px only)
		const breakpointRegex = /^\d+px$/;
		return breakpointRegex.test(value);
	},
};

// Token transformation utilities
export const transformToken = {
	pxToRem: (px: string, baseFontSize = 16): string => {
		const pxValue = Number.parseFloat(px.replace("px", ""));
		return `${pxValue / baseFontSize}rem`;
	},
	remToPx: (rem: string, baseFontSize = 16): string => {
		const remValue = Number.parseFloat(rem.replace("rem", ""));
		return `${remValue * baseFontSize}px`;
	},
	hslToRgb: (hsl: string): string => {
		// Basic HSL to RGB conversion (simplified)
		const match = hsl.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
		if (!match) return hsl;

		const h = Number.parseInt(match[1]) / 360;
		const s = Number.parseInt(match[2]) / 100;
		const l = Number.parseInt(match[3]) / 100;

		const hue2rgb = (p: number, q: number, t: number) => {
			if (t < 0) t += 1;
			if (t > 1) t -= 1;
			if (t < 1 / 6) return p + (q - p) * 6 * t;
			if (t < 1 / 2) return q;
			if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
			return p;
		};

		const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
		const p = 2 * l - q;
		const r = Math.round(hue2rgb(p, q, h + 1 / 3) * 255);
		const g = Math.round(hue2rgb(p, q, h) * 255);
		const b = Math.round(hue2rgb(p, q, h - 1 / 3) * 255);

		return `rgb(${r}, ${g}, ${b})`;
	},
};

export default designTokens;
