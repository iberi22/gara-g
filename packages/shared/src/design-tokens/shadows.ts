/**
 * Shadow System - Elevation and Depth
 * Provides consistent shadow styles for different elevation levels
 */

export interface ShadowSystem {
	// Basic shadows
	xs: string;
	sm: string;
	md: string;
	lg: string;
	xl: string;
	"2xl": string;
	// Specialized shadows
	inner: string;
	none: string;
	// Glassmorphism shadows
	glass: string;
	glassSubtle: string;
	// Interactive shadows
	focus: string;
	focusVisible: string;
	// Colored shadows
	primary: string;
	success: string;
	warning: string;
	error: string;
	info: string;
}

export interface ElevationSystem {
	0: string; // No elevation
	1: string; // Subtle elevation
	2: string; // Low elevation
	3: string; // Medium elevation
	4: string; // High elevation
	5: string; // Very high elevation
}

// Base shadow system
export const shadows: ShadowSystem = {
	// Basic shadows with soft, natural appearance
	xs: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
	sm: "0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)",
	md: "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
	lg: "0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)",
	xl: "0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)",
	"2xl": "0 25px 50px -12px rgb(0 0 0 / 0.25)",

	// Specialized shadows
	inner: "inset 0 2px 4px 0 rgb(0 0 0 / 0.05)",
	none: "0 0 #0000",

	// Glassmorphism shadows
	glass: "0 8px 32px 0 rgba(31, 38, 135, 0.37)",
	glassSubtle: "0 4px 16px 0 rgba(31, 38, 135, 0.2)",

	// Interactive shadows
	focus: "0 0 0 3px rgb(221 83 53 / 0.3)", // Primary color with opacity
	focusVisible: "0 0 0 2px rgb(255 255 255), 0 0 0 4px rgb(221 83 53 / 0.5)",

	// Colored shadows for brand elements
	primary: "0 4px 14px 0 rgb(221 83 53 / 0.25)",
	success: "0 4px 14px 0 rgb(142 76 36 / 0.25)",
	warning: "0 4px 14px 0 rgb(33 95 44 / 0.25)",
	error: "0 4px 14px 0 rgb(0 84 55 / 0.25)",
	info: "0 4px 14px 0 rgb(200 89 49 / 0.25)",
};

// Elevation system for consistent layering
export const elevation: ElevationSystem = {
	0: shadows.none,
	1: shadows.xs,
	2: shadows.sm,
	3: shadows.md,
	4: shadows.lg,
	5: shadows.xl,
};

// Drop shadow utilities for modern effects
export const dropShadow = {
	xs: "drop-shadow(0 1px 1px rgb(0 0 0 / 0.05))",
	sm: "drop-shadow(0 1px 2px rgb(0 0 0 / 0.1)) drop-shadow(0 1px 1px rgb(0 0 0 / 0.06))",
	md: "drop-shadow(0 4px 3px rgb(0 0 0 / 0.07)) drop-shadow(0 2px 2px rgb(0 0 0 / 0.06))",
	lg: "drop-shadow(0 10px 8px rgb(0 0 0 / 0.04)) drop-shadow(0 4px 3px rgb(0 0 0 / 0.1))",
	xl: "drop-shadow(0 20px 13px rgb(0 0 0 / 0.03)) drop-shadow(0 8px 5px rgb(0 0 0 / 0.08))",
	"2xl": "drop-shadow(0 25px 25px rgb(0 0 0 / 0.15))",
	none: "drop-shadow(0 0 #0000)",
};

// Text shadows for enhanced readability
export const textShadow = {
	sm: "0 1px 2px rgb(0 0 0 / 0.5)",
	md: "0 2px 4px rgb(0 0 0 / 0.5)",
	lg: "0 4px 8px rgb(0 0 0 / 0.5)",
	none: "0 0 #0000",
};
