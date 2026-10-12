type Config = unknown;

interface PluginAPI {
	addUtilities: (utilities: Record<string, unknown>) => void;
	theme: (path: string) => unknown;
}

import { designTokens } from "./tokens";

const config: Config = {
	content: [
		"./src/**/*.{js,ts,jsx,tsx,mdx}",
		"../app/src/**/*.{js,ts,jsx,tsx,mdx}",
		"../**/*.{js,ts,jsx,tsx,mdx}",
	],
	darkMode: "class",
	theme: {
		extend: {
			colors: {
				primary: {
					50: "hsl(214, 100%, 97%)",
					100: "hsl(214, 95%, 93%)",
					200: "hsl(213, 97%, 87%)",
					300: "hsl(212, 96%, 78%)",
					400: "hsl(213, 94%, 68%)",
					500: "hsl(221, 83%, 53%)",
					600: "hsl(221, 83%, 48%)",
					700: "hsl(221, 83%, 43%)",
					800: "hsl(221, 83%, 38%)",
					900: "hsl(221, 83%, 33%)",
					950: "hsl(221, 83%, 23%)",
					DEFAULT: "hsl(221, 83%, 53%)",
				},
				secondary: {
					50: "hsl(210, 40%, 98%)",
					100: "hsl(210, 40%, 96%)",
					200: "hsl(210, 40%, 92%)",
					300: "hsl(210, 40%, 85%)",
					400: "hsl(210, 40%, 75%)",
					500: "hsl(210, 40%, 60%)",
					600: "hsl(210, 40%, 45%)",
					700: "hsl(210, 40%, 35%)",
					800: "hsl(210, 40%, 25%)",
					900: "hsl(210, 40%, 15%)",
					950: "hsl(210, 40%, 8%)",
					DEFAULT: "hsl(210, 40%, 96%)",
				},
				success: {
					50: "hsl(142, 76%, 95%)",
					100: "hsl(142, 76%, 88%)",
					200: "hsl(142, 76%, 78%)",
					300: "hsl(142, 76%, 65%)",
					400: "hsl(142, 76%, 52%)",
					500: "hsl(142, 76%, 36%)",
					600: "hsl(142, 76%, 32%)",
					700: "hsl(142, 76%, 28%)",
					800: "hsl(142, 76%, 24%)",
					900: "hsl(142, 76%, 20%)",
					950: "hsl(142, 76%, 12%)",
					DEFAULT: "hsl(142, 76%, 36%)",
				},
				warning: {
					50: "hsl(33, 95%, 95%)",
					100: "hsl(33, 95%, 88%)",
					200: "hsl(33, 95%, 78%)",
					300: "hsl(33, 95%, 65%)",
					400: "hsl(33, 95%, 55%)",
					500: "hsl(33, 95%, 44%)",
					600: "hsl(33, 95%, 40%)",
					700: "hsl(33, 95%, 35%)",
					800: "hsl(33, 95%, 30%)",
					900: "hsl(33, 95%, 25%)",
					950: "hsl(33, 95%, 15%)",
					DEFAULT: "hsl(33, 95%, 44%)",
				},
				error: {
					50: "hsl(0, 84%, 97%)",
					100: "hsl(0, 84%, 92%)",
					200: "hsl(0, 84%, 85%)",
					300: "hsl(0, 84%, 75%)",
					400: "hsl(0, 84%, 65%)",
					500: "hsl(0, 84%, 55%)",
					600: "hsl(0, 84%, 50%)",
					700: "hsl(0, 84%, 45%)",
					800: "hsl(0, 84%, 40%)",
					900: "hsl(0, 84%, 35%)",
					950: "hsl(0, 84%, 25%)",
					DEFAULT: "hsl(0, 84%, 55%)",
				},
				info: {
					50: "hsl(200, 89%, 95%)",
					100: "hsl(200, 89%, 88%)",
					200: "hsl(200, 89%, 78%)",
					300: "hsl(200, 89%, 65%)",
					400: "hsl(200, 89%, 57%)",
					500: "hsl(200, 89%, 49%)",
					600: "hsl(200, 89%, 45%)",
					700: "hsl(200, 89%, 40%)",
					800: "hsl(200, 89%, 35%)",
					900: "hsl(200, 89%, 30%)",
					950: "hsl(200, 89%, 20%)",
					DEFAULT: "hsl(200, 89%, 49%)",
				},
				background: {
					primary: "var(--color-background-primary)",
					secondary: "var(--color-background-secondary)",
					tertiary: "var(--color-background-tertiary)",
					inverse: "var(--color-background-inverse)",
				},
				foreground: {
					primary: "var(--color-foreground-primary)",
					secondary: "var(--color-foreground-secondary)",
					tertiary: "var(--color-foreground-tertiary)",
					inverse: "var(--color-foreground-inverse)",
				},
				border: {
					primary: "var(--color-border-primary)",
					secondary: "var(--color-border-secondary)",
					focus: "var(--color-border-focus)",
					error: "var(--color-border-error)",
					success: "var(--color-border-success)",
				},
			},
			spacing: Object.fromEntries(
				Object.entries(designTokens.spacing).map(([key, value]) => [
					key,
					String(value),
				]),
			),
			fontSize: designTokens.typography.fontSize,
			fontWeight: designTokens.typography.fontWeight,
			lineHeight: designTokens.typography.lineHeight,
			letterSpacing: designTokens.typography.letterSpacing,
			fontFamily: designTokens.fontFamily,
			borderRadius: designTokens.borderRadius,
			boxShadow: {
				...designTokens.shadows,
				"elevation-0": designTokens.elevation[0],
				"elevation-1": designTokens.elevation[1],
				"elevation-2": designTokens.elevation[2],
				"elevation-3": designTokens.elevation[3],
				"elevation-4": designTokens.elevation[4],
				"elevation-5": designTokens.elevation[5],
			},
			dropShadow: designTokens.dropShadow,
			zIndex: designTokens.zIndex,
			screens: {
				xs: designTokens.breakpoints.values.xs,
				sm: designTokens.breakpoints.values.sm,
				md: designTokens.breakpoints.values.md,
				lg: designTokens.breakpoints.values.lg,
				xl: designTokens.breakpoints.values.xl,
				"2xl": designTokens.breakpoints.values["2xl"],
			},
			container: {
				center: true,
				padding: {
					DEFAULT: designTokens.semanticSpacing.pageMargin.mobile,
					sm: designTokens.semanticSpacing.pageMargin.tablet,
					lg: designTokens.semanticSpacing.pageMargin.desktop,
				},
				screens: designTokens.containerMaxWidths,
			},
			transitionDuration: designTokens.animations.duration,
			transitionTimingFunction: designTokens.animations.easing,
			animation: {
				"fade-in": "fadeIn 0.3s ease-out",
				"fade-out": "fadeOut 0.3s ease-out",
				"slide-in-up": "slideInUp 0.3s ease-out",
				"slide-in-down": "slideInDown 0.3s ease-out",
				"slide-in-left": "slideInLeft 0.3s ease-out",
				"slide-in-right": "slideInRight 0.3s ease-out",
				"scale-in": "scaleIn 0.2s ease-out",
				"scale-out": "scaleOut 0.2s ease-out",
				spin: "spin 1s linear infinite",
				pulse: "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
				bounce: "bounce 1s infinite",
				shake: "shake 0.5s ease-in-out",
				glow: "glow 2s ease-in-out infinite alternate",
				float: "float 3s ease-in-out infinite",
			},
			keyframes: {
				fadeIn: {
					from: { opacity: "0" },
					to: { opacity: "1" },
				},
				fadeOut: {
					from: { opacity: "1" },
					to: { opacity: "0" },
				},
				slideInUp: {
					from: {
						opacity: "0",
						transform: "translateY(100%)",
					},
					to: {
						opacity: "1",
						transform: "translateY(0)",
					},
				},
				slideInDown: {
					from: {
						opacity: "0",
						transform: "translateY(-100%)",
					},
					to: {
						opacity: "1",
						transform: "translateY(0)",
					},
				},
				slideInLeft: {
					from: {
						opacity: "0",
						transform: "translateX(-100%)",
					},
					to: {
						opacity: "1",
						transform: "translateX(0)",
					},
				},
				slideInRight: {
					from: {
						opacity: "0",
						transform: "translateX(100%)",
					},
					to: {
						opacity: "1",
						transform: "translateX(0)",
					},
				},
				scaleIn: {
					from: {
						opacity: "0",
						transform: "scale(0.9)",
					},
					to: {
						opacity: "1",
						transform: "scale(1)",
					},
				},
				scaleOut: {
					from: {
						opacity: "1",
						transform: "scale(1)",
					},
					to: {
						opacity: "0",
						transform: "scale(0.9)",
					},
				},
				shake: {
					"0%, 100%": { transform: "translateX(0)" },
					"10%, 30%, 50%, 70%, 90%": { transform: "translateX(-10px)" },
					"20%, 40%, 60%, 80%": { transform: "translateX(10px)" },
				},
				glow: {
					"0%, 100%": { boxShadow: "0 0 5px rgba(221, 83, 53, 0.5)" },
					"50%": { boxShadow: "0 0 20px rgba(221, 83, 53, 0.8)" },
				},
				float: {
					"0%, 100%": { transform: "translateY(0px)" },
					"50%": { transform: "translateY(-10px)" },
				},
			},
			backgroundImage: {
				"gradient-primary": designTokens.gradients.primary,
				"gradient-primary-subtle": designTokens.gradients.primarySubtle,
				"gradient-success": designTokens.gradients.success,
				"gradient-warning": designTokens.gradients.warning,
				"gradient-error": designTokens.gradients.error,
				"gradient-info": designTokens.gradients.info,
				"gradient-glass": designTokens.gradients.glass,
				"gradient-glass-dark": designTokens.gradients.glassDark,
			},
		},
	},
	plugins: [
		({ addUtilities }: PluginAPI) => {
			const newUtilities = {
				".glass": {
					background: "rgba(255, 255, 255, 0.25)",
					backdropFilter: "blur(10px)",
					WebkitBackdropFilter: "blur(10px)",
					border: "1px solid rgba(255, 255, 255, 0.18)",
					boxShadow: designTokens.shadows.glass,
				},
				".glass-dark": {
					background: "rgba(0, 0, 0, 0.25)",
					backdropFilter: "blur(10px)",
					WebkitBackdropFilter: "blur(10px)",
					border: "1px solid rgba(255, 255, 255, 0.1)",
					boxShadow: designTokens.shadows.glass,
				},
				".glass-subtle": {
					background: "rgba(255, 255, 255, 0.1)",
					backdropFilter: "blur(5px)",
					WebkitBackdropFilter: "blur(5px)",
					border: "1px solid rgba(255, 255, 255, 0.1)",
					boxShadow: designTokens.shadows.glassSubtle,
				},
				".sr-only": designTokens.accessibility.srOnly,
				".focus-ring": {
					"&:focus": {
						outline: "none",
						boxShadow: designTokens.shadows.focus,
					},
				},
				".focus-visible-ring": {
					"&:focus-visible": {
						outline: "none",
						boxShadow: designTokens.shadows.focusVisible,
					},
				},
				".touch-target-minimum": {
					minWidth: designTokens.accessibility.touchTarget.minimum,
					minHeight: designTokens.accessibility.touchTarget.minimum,
				},
				".touch-target-comfortable": {
					minWidth: designTokens.accessibility.touchTarget.comfortable,
					minHeight: designTokens.accessibility.touchTarget.comfortable,
				},
				".touch-target-large": {
					minWidth: designTokens.accessibility.touchTarget.large,
					minHeight: designTokens.accessibility.touchTarget.large,
				},
				"@media (prefers-reduced-motion: reduce)": {
					".motion-reduce": {
						animation: "none !important",
						transition: "none !important",
					},
				},
			};

			addUtilities(newUtilities);
		},
	],
};

export default config;
