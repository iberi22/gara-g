/**
 * Design Token Validation System
 * Validates design tokens for consistency, accessibility, and best practices
 */

import { colors } from "./colors";
import { designTokens } from "./tokens";

export interface ValidationResult {
	isValid: boolean;
	errors: ValidationError[];
	warnings: ValidationWarning[];
}

export interface ValidationError {
	type: "error";
	category: string;
	message: string;
	token?: string;
	value?: unknown;
}

export interface ValidationWarning {
	type: "warning";
	category: string;
	message: string;
	token?: string;
	value?: unknown;
	suggestion?: string;
}

// Color contrast calculation (simplified WCAG formula)
function getLuminance(color: string): number {
	// Extract RGB values from HSL (simplified)
	const hslMatch = color.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
	if (!hslMatch) return 0;

	const h = Number.parseInt(hslMatch[1]) / 360;
	const s = Number.parseInt(hslMatch[2]) / 100;
	const l = Number.parseInt(hslMatch[3]) / 100;

	// Convert HSL to RGB (simplified)
	const c = (1 - Math.abs(2 * l - 1)) * s;
	const x = c * (1 - Math.abs(((h * 6) % 2) - 1));
	const m = l - c / 2;

	let r = 0;
	let g = 0;
	let b = 0;
	if (h < 1 / 6) {
		r = c;
		g = x;
		b = 0;
	} else if (h < 2 / 6) {
		r = x;
		g = c;
		b = 0;
	} else if (h < 3 / 6) {
		r = 0;
		g = c;
		b = x;
	} else if (h < 4 / 6) {
		r = 0;
		g = x;
		b = c;
	} else if (h < 5 / 6) {
		r = x;
		g = 0;
		b = c;
	} else {
		r = c;
		g = 0;
		b = x;
	}

	r = r + m;
	g = g + m;
	b = b + m;

	// Calculate relative luminance
	const rsRGB = r <= 0.03928 ? r / 12.92 : ((r + 0.055) / 1.055) ** 2.4;
	const gsRGB = g <= 0.03928 ? g / 12.92 : ((g + 0.055) / 1.055) ** 2.4;
	const bsRGB = b <= 0.03928 ? b / 12.92 : ((b + 0.055) / 1.055) ** 2.4;

	return 0.2126 * rsRGB + 0.7152 * gsRGB + 0.0722 * bsRGB;
}

function getContrastRatio(color1: string, color2: string): number {
	const lum1 = getLuminance(color1);
	const lum2 = getLuminance(color2);
	const brightest = Math.max(lum1, lum2);
	const darkest = Math.min(lum1, lum2);
	return (brightest + 0.05) / (darkest + 0.05);
}

// Validation functions
function validateColorContrast(): (ValidationError | ValidationWarning)[] {
	const issues: (ValidationError | ValidationWarning)[] = [];

	// Check primary text on background
	const primaryTextContrast = getContrastRatio(
		colors.foreground.primary,
		colors.background.primary,
	);

	if (primaryTextContrast < 4.5) {
		issues.push({
			type: "error",
			category: "accessibility",
			message: `Primary text contrast ratio (${primaryTextContrast.toFixed(2)}) is below WCAG AA minimum (4.5:1)`,
			token: "foreground.primary",
			value: colors.foreground.primary,
		});
	} else if (primaryTextContrast < 7) {
		issues.push({
			type: "warning",
			category: "accessibility",
			message: `Primary text contrast ratio (${primaryTextContrast.toFixed(2)}) is below WCAG AAA recommended (7:1)`,
			token: "foreground.primary",
			value: colors.foreground.primary,
			suggestion: "Consider increasing contrast for better accessibility",
		});
	}

	// Check secondary text on background
	const secondaryTextContrast = getContrastRatio(
		colors.foreground.secondary,
		colors.background.primary,
	);

	if (secondaryTextContrast < 4.5) {
		issues.push({
			type: "error",
			category: "accessibility",
			message: `Secondary text contrast ratio (${secondaryTextContrast.toFixed(2)}) is below WCAG AA minimum (4.5:1)`,
			token: "foreground.secondary",
			value: colors.foreground.secondary,
		});
	}

	return issues;
}

function validateSpacing(): (ValidationError | ValidationWarning)[] {
	const issues: (ValidationError | ValidationWarning)[] = [];

	// Check if spacing follows 8pt grid
	Object.entries(designTokens.spacing).forEach(([key, value]) => {
		if (key === "px" || key === "0") return; // Skip special cases

		const pxValue = Number.parseFloat(value.replace("px", ""));
		if (pxValue % 4 !== 0 && pxValue > 4) {
			issues.push({
				type: "warning",
				category: "consistency",
				message: `Spacing value ${value} doesn't follow 4px grid system`,
				token: `spacing.${key}`,
				value,
				suggestion: "Consider using multiples of 4px for better consistency",
			});
		}
	});

	return issues;
}

function validateTouchTargets(): (ValidationError | ValidationWarning)[] {
	const issues: (ValidationError | ValidationWarning)[] = [];

	const minimumSize = Number.parseFloat(
		designTokens.accessibility.touchTarget.minimum.replace("px", ""),
	);

	if (minimumSize < 44) {
		issues.push({
			type: "error",
			category: "accessibility",
			message: `Minimum touch target size (${minimumSize}px) is below recommended 44px`,
			token: "accessibility.touchTarget.minimum",
			value: designTokens.accessibility.touchTarget.minimum,
		});
	}

	return issues;
}

function validateAnimationDurations(): (ValidationError | ValidationWarning)[] {
	const issues: (ValidationError | ValidationWarning)[] = [];

	Object.entries(designTokens.animations.duration).forEach(([key, value]) => {
		const duration = Number.parseFloat(value.replace("ms", ""));

		if (duration > 1000 && key !== "slowest") {
			issues.push({
				type: "warning",
				category: "performance",
				message: `Animation duration ${value} might be too long for good UX`,
				token: `animations.duration.${key}`,
				value,
				suggestion:
					"Consider shorter durations for better perceived performance",
			});
		}
	});

	return issues;
}

function validateColorScales(): (ValidationError | ValidationWarning)[] {
	const issues: (ValidationError | ValidationWarning)[] = [];

	// Check if color scales have proper progression
	const scaleKeys = [
		"50",
		"100",
		"200",
		"300",
		"400",
		"500",
		"600",
		"700",
		"800",
		"900",
		"950",
	];

	Object.entries(colors).forEach(([colorName, colorScale]) => {
		if (typeof colorScale !== "object" || !Object.hasOwn(colorScale, "50"))
			return;

		// Check if all scale steps exist
		scaleKeys.forEach((step) => {
			if (!Object.hasOwn(colorScale, step)) {
				issues.push({
					type: "error",
					category: "consistency",
					message: `Color scale ${colorName} is missing step ${step}`,
					token: `colors.${colorName}.${step}`,
				});
			}
		});

		// Check if DEFAULT exists and matches 500
		if (!Object.hasOwn(colorScale, "DEFAULT")) {
			issues.push({
				type: "warning",
				category: "consistency",
				message: `Color scale ${colorName} is missing DEFAULT value`,
				token: `colors.${colorName}.DEFAULT`,
				suggestion: "Add DEFAULT value that matches the 500 step",
			});
		} else if (colorScale.DEFAULT !== colorScale["500"]) {
			issues.push({
				type: "warning",
				category: "consistency",
				message: `Color scale ${colorName} DEFAULT doesn't match 500 step`,
				token: `colors.${colorName}.DEFAULT`,
				suggestion: "DEFAULT should typically match the 500 step",
			});
		}
	});

	return issues;
}

function validateBreakpoints(): (ValidationError | ValidationWarning)[] {
	const issues: (ValidationError | ValidationWarning)[] = [];

	const breakpointValues = Object.entries(designTokens.breakpoints.values)
		.map(([key, value]) => ({
			key,
			value: Number.parseFloat(value.replace("px", "")),
		}))
		.sort((a, b) => a.value - b.value);

	// Check if breakpoints are in ascending order
	for (let i = 1; i < breakpointValues.length; i++) {
		if (breakpointValues[i].value <= breakpointValues[i - 1].value) {
			issues.push({
				type: "error",
				category: "consistency",
				message: `Breakpoint ${breakpointValues[i].key} (${breakpointValues[i].value}px) should be larger than ${breakpointValues[i - 1].key} (${breakpointValues[i - 1].value}px)`,
				token: `breakpoints.values.${breakpointValues[i].key}`,
				value: `${breakpointValues[i].value}px`,
			});
		}
	}

	return issues;
}

// Main validation function
export function validateDesignTokens(): ValidationResult {
	const allIssues: (ValidationError | ValidationWarning)[] = [
		...validateColorContrast(),
		...validateSpacing(),
		...validateTouchTargets(),
		...validateAnimationDurations(),
		...validateColorScales(),
		...validateBreakpoints(),
	];

	const errors = allIssues.filter(
		(issue) => issue.type === "error",
	) as ValidationError[];
	const warnings = allIssues.filter(
		(issue) => issue.type === "warning",
	) as ValidationWarning[];

	return {
		isValid: errors.length === 0,
		errors,
		warnings,
	};
}

// Utility function to format validation results
export function formatValidationResults(results: ValidationResult): string {
	let output = "";

	if (results.isValid) {
		output += "✅ Design tokens validation passed!\n\n";
	} else {
		output += "❌ Design tokens validation failed!\n\n";
	}

	if (results.errors.length > 0) {
		output += `🚨 Errors (${results.errors.length}):\n`;
		results.errors.forEach((error, index) => {
			output += `${index + 1}. [${error.category}] ${error.message}\n`;
			if (error.token) output += `   Token: ${error.token}\n`;
			if (error.value) output += `   Value: ${error.value}\n`;
			output += "\n";
		});
	}

	if (results.warnings.length > 0) {
		output += `⚠️  Warnings (${results.warnings.length}):\n`;
		results.warnings.forEach((warning, index) => {
			output += `${index + 1}. [${warning.category}] ${warning.message}\n`;
			if (warning.token) output += `   Token: ${warning.token}\n`;
			if (warning.value) output += `   Value: ${warning.value}\n`;
			if (warning.suggestion)
				output += `   Suggestion: ${warning.suggestion}\n`;
			output += "\n";
		});
	}

	return output;
}

// Export validation for use in build process
export default validateDesignTokens;
