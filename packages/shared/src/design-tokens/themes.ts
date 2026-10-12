/**
 * Theme System - Light, Dark, and High Contrast Variants
 * Dynamic theming support with CSS custom properties
 */

import { colors, gradients } from "./colors";
import { shadows } from "./shadows";

export interface ThemeVariant {
	name: string;
	colors: {
		background: {
			primary: string;
			secondary: string;
			tertiary: string;
			inverse: string;
		};
		foreground: {
			primary: string;
			secondary: string;
			tertiary: string;
			inverse: string;
		};
		border: {
			primary: string;
			secondary: string;
			focus: string;
			error: string;
			success: string;
		};
		primary: string;
		secondary: string;
		success: string;
		warning: string;
		error: string;
		info: string;
	};
	shadows: {
		sm: string;
		md: string;
		lg: string;
		xl: string;
		focus: string;
		glass: string;
	};
	gradients: {
		primary: string;
		subtle: string;
		glass: string;
	};
}

// Light theme (default)
export const lightTheme: ThemeVariant = {
	name: "light",
	colors: {
		background: {
			primary: "hsl(0, 0%, 100%)",
			secondary: "hsl(0, 0%, 98%)",
			tertiary: "hsl(210, 40%, 96%)",
			inverse: "hsl(222, 84%, 5%)",
		},
		foreground: {
			primary: "hsl(222, 84%, 5%)",
			secondary: "hsl(0, 0%, 40%)",
			tertiary: "hsl(0, 0%, 60%)",
			inverse: "hsl(0, 0%, 98%)",
		},
		border: {
			primary: "hsl(0, 0%, 85%)",
			secondary: "hsl(0, 0%, 92%)",
			focus: "hsl(221, 83%, 53%)",
			error: "hsl(0, 84%, 55%)",
			success: "hsl(142, 76%, 36%)",
		},
		primary: colors.primary.DEFAULT,
		secondary: colors.secondary.DEFAULT,
		success: colors.success.DEFAULT,
		warning: colors.warning.DEFAULT,
		error: colors.error.DEFAULT,
		info: colors.info.DEFAULT,
	},
	shadows: {
		sm: shadows.sm,
		md: shadows.md,
		lg: shadows.lg,
		xl: shadows.xl,
		focus: shadows.focus,
		glass: shadows.glass,
	},
	gradients: {
		primary: gradients.primary,
		subtle: gradients.primarySubtle,
		glass: gradients.glass,
	},
};

// Dark theme
export const darkTheme: ThemeVariant = {
	name: "dark",
	colors: {
		background: {
			primary: "hsl(222, 84%, 5%)",
			secondary: "hsl(222, 84%, 8%)",
			tertiary: "hsl(222, 84%, 12%)",
			inverse: "hsl(0, 0%, 98%)",
		},
		foreground: {
			primary: "hsl(0, 0%, 98%)",
			secondary: "hsl(0, 0%, 80%)",
			tertiary: "hsl(0, 0%, 60%)",
			inverse: "hsl(222, 84%, 5%)",
		},
		border: {
			primary: "hsl(0, 0%, 20%)",
			secondary: "hsl(0, 0%, 15%)",
			focus: "hsl(221, 83%, 63%)", // Slightly lighter for dark mode
			error: "hsl(0, 84%, 65%)",
			success: "hsl(142, 76%, 46%)",
		},
		primary: "hsl(221, 83%, 63%)", // Adjusted for dark mode
		secondary: "hsl(210, 40%, 20%)",
		success: "hsl(142, 76%, 46%)",
		warning: "hsl(33, 95%, 54%)",
		error: "hsl(0, 84%, 65%)",
		info: "hsl(200, 89%, 59%)",
	},
	shadows: {
		sm: "0 1px 3px 0 rgb(0 0 0 / 0.3), 0 1px 2px -1px rgb(0 0 0 / 0.3)",
		md: "0 4px 6px -1px rgb(0 0 0 / 0.3), 0 2px 4px -2px rgb(0 0 0 / 0.3)",
		lg: "0 10px 15px -3px rgb(0 0 0 / 0.3), 0 4px 6px -4px rgb(0 0 0 / 0.3)",
		xl: "0 20px 25px -5px rgb(0 0 0 / 0.3), 0 8px 10px -6px rgb(0 0 0 / 0.3)",
		focus: "0 0 0 3px rgb(221 83 63 / 0.4)",
		glass: "0 8px 32px 0 rgba(0, 0, 0, 0.5)",
	},
	gradients: {
		primary:
			"linear-gradient(135deg, hsl(221, 83%, 63%) 0%, hsl(221, 83%, 58%) 100%)",
		subtle:
			"linear-gradient(135deg, hsl(222, 84%, 8%) 0%, hsl(222, 84%, 12%) 100%)",
		glass: gradients.glassDark,
	},
};

// High contrast theme (accessibility)
export const highContrastTheme: ThemeVariant = {
	name: "high-contrast",
	colors: {
		background: {
			primary: "hsl(0, 0%, 0%)",
			secondary: "hsl(0, 0%, 5%)",
			tertiary: "hsl(0, 0%, 10%)",
			inverse: "hsl(0, 0%, 100%)",
		},
		foreground: {
			primary: "hsl(0, 0%, 100%)",
			secondary: "hsl(0, 0%, 90%)",
			tertiary: "hsl(0, 0%, 80%)",
			inverse: "hsl(0, 0%, 0%)",
		},
		border: {
			primary: "hsl(0, 0%, 100%)",
			secondary: "hsl(0, 0%, 80%)",
			focus: "hsl(60, 100%, 50%)", // High contrast yellow
			error: "hsl(0, 100%, 60%)",
			success: "hsl(120, 100%, 40%)",
		},
		primary: "hsl(210, 100%, 70%)",
		secondary: "hsl(0, 0%, 80%)",
		success: "hsl(120, 100%, 40%)",
		warning: "hsl(45, 100%, 50%)",
		error: "hsl(0, 100%, 60%)",
		info: "hsl(200, 100%, 60%)",
	},
	shadows: {
		sm: "0 1px 3px 0 rgb(255 255 255 / 0.3)",
		md: "0 4px 6px -1px rgb(255 255 255 / 0.3)",
		lg: "0 10px 15px -3px rgb(255 255 255 / 0.3)",
		xl: "0 20px 25px -5px rgb(255 255 255 / 0.3)",
		focus: "0 0 0 4px hsl(60, 100%, 50%)",
		glass: "0 8px 32px 0 rgba(255, 255, 255, 0.2)",
	},
	gradients: {
		primary:
			"linear-gradient(135deg, hsl(210, 100%, 70%) 0%, hsl(210, 100%, 60%) 100%)",
		subtle: "linear-gradient(135deg, hsl(0, 0%, 5%) 0%, hsl(0, 0%, 10%) 100%)",
		glass:
			"linear-gradient(135deg, rgba(255, 255, 255, 0.1) 0%, rgba(255, 255, 255, 0.05) 100%)",
	},
};

// Theme collection
export const themes = {
	light: lightTheme,
	dark: darkTheme,
	"high-contrast": highContrastTheme,
};

// CSS custom properties generator
export const generateCSSCustomProperties = (theme: ThemeVariant): string => {
	return `
    :root {
      /* Background colors */
      --color-background-primary: ${theme.colors.background.primary};
      --color-background-secondary: ${theme.colors.background.secondary};
      --color-background-tertiary: ${theme.colors.background.tertiary};
      --color-background-inverse: ${theme.colors.background.inverse};

      /* Foreground colors */
      --color-foreground-primary: ${theme.colors.foreground.primary};
      --color-foreground-secondary: ${theme.colors.foreground.secondary};
      --color-foreground-tertiary: ${theme.colors.foreground.tertiary};
      --color-foreground-inverse: ${theme.colors.foreground.inverse};

      /* Border colors */
      --color-border-primary: ${theme.colors.border.primary};
      --color-border-secondary: ${theme.colors.border.secondary};
      --color-border-focus: ${theme.colors.border.focus};
      --color-border-error: ${theme.colors.border.error};
      --color-border-success: ${theme.colors.border.success};

      /* Brand colors */
      --color-primary: ${theme.colors.primary};
      --color-secondary: ${theme.colors.secondary};
      --color-success: ${theme.colors.success};
      --color-warning: ${theme.colors.warning};
      --color-error: ${theme.colors.error};
      --color-info: ${theme.colors.info};

      /* Shadows */
      --shadow-sm: ${theme.shadows.sm};
      --shadow-md: ${theme.shadows.md};
      --shadow-lg: ${theme.shadows.lg};
      --shadow-xl: ${theme.shadows.xl};
      --shadow-focus: ${theme.shadows.focus};
      --shadow-glass: ${theme.shadows.glass};

      /* Gradients */
      --gradient-primary: ${theme.gradients.primary};
      --gradient-subtle: ${theme.gradients.subtle};
      --gradient-glass: ${theme.gradients.glass};
    }
  `;
};

// Theme detection utilities
export const getSystemTheme = (): "light" | "dark" => {
	if (typeof window !== "undefined") {
		return window.matchMedia("(prefers-color-scheme: dark)").matches
			? "dark"
			: "light";
	}
	return "light";
};

export const getReducedMotion = (): boolean => {
	if (typeof window !== "undefined") {
		return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
	}
	return false;
};

export const getHighContrast = (): boolean => {
	if (typeof window !== "undefined") {
		return window.matchMedia("(prefers-contrast: high)").matches;
	}
	return false;
};
