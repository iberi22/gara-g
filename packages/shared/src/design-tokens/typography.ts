/**
 * Typography System - Clear Hierarchy with Semantic Naming
 * Provides consistent typography scales and semantic text styles
 */

export interface TypographyScale {
	fontSize: {
		xs: string;
		sm: string;
		base: string;
		lg: string;
		xl: string;
		"2xl": string;
		"3xl": string;
		"4xl": string;
		"5xl": string;
		"6xl": string;
		"7xl": string;
		"8xl": string;
		"9xl": string;
	};
	fontWeight: {
		thin: number;
		extralight: number;
		light: number;
		normal: number;
		medium: number;
		semibold: number;
		bold: number;
		extrabold: number;
		black: number;
	};
	lineHeight: {
		none: number;
		tight: number;
		snug: number;
		normal: number;
		relaxed: number;
		loose: number;
	};
	letterSpacing: {
		tighter: string;
		tight: string;
		normal: string;
		wide: string;
		wider: string;
		widest: string;
	};
}

export interface SemanticTypography {
	heading: {
		h1: {
			fontSize: string;
			fontWeight: number;
			lineHeight: number;
			letterSpacing: string;
		};
		h2: {
			fontSize: string;
			fontWeight: number;
			lineHeight: number;
			letterSpacing: string;
		};
		h3: {
			fontSize: string;
			fontWeight: number;
			lineHeight: number;
			letterSpacing: string;
		};
		h4: {
			fontSize: string;
			fontWeight: number;
			lineHeight: number;
			letterSpacing: string;
		};
		h5: {
			fontSize: string;
			fontWeight: number;
			lineHeight: number;
			letterSpacing: string;
		};
		h6: {
			fontSize: string;
			fontWeight: number;
			lineHeight: number;
			letterSpacing: string;
		};
	};
	body: {
		large: {
			fontSize: string;
			fontWeight: number;
			lineHeight: number;
		};
		base: {
			fontSize: string;
			fontWeight: number;
			lineHeight: number;
		};
		small: {
			fontSize: string;
			fontWeight: number;
			lineHeight: number;
		};
	};
	label: {
		large: {
			fontSize: string;
			fontWeight: number;
			lineHeight: number;
			letterSpacing: string;
		};
		base: {
			fontSize: string;
			fontWeight: number;
			lineHeight: number;
			letterSpacing: string;
		};
		small: {
			fontSize: string;
			fontWeight: number;
			lineHeight: number;
			letterSpacing: string;
		};
	};
}

// Base typography scale
export const typography: TypographyScale = {
	fontSize: {
		xs: "0.75rem", // 12px
		sm: "0.875rem", // 14px
		base: "1rem", // 16px
		lg: "1.125rem", // 18px
		xl: "1.25rem", // 20px
		"2xl": "1.5rem", // 24px
		"3xl": "1.875rem", // 30px
		"4xl": "2.25rem", // 36px
		"5xl": "3rem", // 48px
		"6xl": "3.75rem", // 60px
		"7xl": "4.5rem", // 72px
		"8xl": "6rem", // 96px
		"9xl": "8rem", // 128px
	},
	fontWeight: {
		thin: 100,
		extralight: 200,
		light: 300,
		normal: 400,
		medium: 500,
		semibold: 600,
		bold: 700,
		extrabold: 800,
		black: 900,
	},
	lineHeight: {
		none: 1,
		tight: 1.25,
		snug: 1.375,
		normal: 1.5,
		relaxed: 1.625,
		loose: 2,
	},
	letterSpacing: {
		tighter: "-0.05em",
		tight: "-0.025em",
		normal: "0em",
		wide: "0.025em",
		wider: "0.05em",
		widest: "0.1em",
	},
};

// Semantic typography styles
export const semanticTypography: SemanticTypography = {
	heading: {
		h1: {
			fontSize: typography.fontSize["5xl"], // 48px
			fontWeight: typography.fontWeight.bold,
			lineHeight: typography.lineHeight.tight,
			letterSpacing: typography.letterSpacing.tight,
		},
		h2: {
			fontSize: typography.fontSize["4xl"], // 36px
			fontWeight: typography.fontWeight.semibold,
			lineHeight: typography.lineHeight.tight,
			letterSpacing: typography.letterSpacing.tight,
		},
		h3: {
			fontSize: typography.fontSize["3xl"], // 30px
			fontWeight: typography.fontWeight.semibold,
			lineHeight: typography.lineHeight.snug,
			letterSpacing: typography.letterSpacing.normal,
		},
		h4: {
			fontSize: typography.fontSize["2xl"], // 24px
			fontWeight: typography.fontWeight.medium,
			lineHeight: typography.lineHeight.snug,
			letterSpacing: typography.letterSpacing.normal,
		},
		h5: {
			fontSize: typography.fontSize.xl, // 20px
			fontWeight: typography.fontWeight.medium,
			lineHeight: typography.lineHeight.normal,
			letterSpacing: typography.letterSpacing.normal,
		},
		h6: {
			fontSize: typography.fontSize.lg, // 18px
			fontWeight: typography.fontWeight.medium,
			lineHeight: typography.lineHeight.normal,
			letterSpacing: typography.letterSpacing.normal,
		},
	},
	body: {
		large: {
			fontSize: typography.fontSize.lg, // 18px
			fontWeight: typography.fontWeight.normal,
			lineHeight: typography.lineHeight.relaxed,
		},
		base: {
			fontSize: typography.fontSize.base, // 16px
			fontWeight: typography.fontWeight.normal,
			lineHeight: typography.lineHeight.normal,
		},
		small: {
			fontSize: typography.fontSize.sm, // 14px
			fontWeight: typography.fontWeight.normal,
			lineHeight: typography.lineHeight.normal,
		},
	},
	label: {
		large: {
			fontSize: typography.fontSize.base, // 16px
			fontWeight: typography.fontWeight.medium,
			lineHeight: typography.lineHeight.normal,
			letterSpacing: typography.letterSpacing.wide,
		},
		base: {
			fontSize: typography.fontSize.sm, // 14px
			fontWeight: typography.fontWeight.medium,
			lineHeight: typography.lineHeight.normal,
			letterSpacing: typography.letterSpacing.wide,
		},
		small: {
			fontSize: typography.fontSize.xs, // 12px
			fontWeight: typography.fontWeight.medium,
			lineHeight: typography.lineHeight.normal,
			letterSpacing: typography.letterSpacing.wider,
		},
	},
};

// Font family definitions
export const fontFamily = {
	sans: [
		"ui-sans-serif",
		"system-ui",
		"sans-serif",
		'"Apple Color Emoji"',
		'"Segoe UI Emoji"',
		'"Segoe UI Symbol"',
		'"Noto Color Emoji"',
	],
	serif: [
		"ui-serif",
		"Georgia",
		"Cambria",
		'"Times New Roman"',
		"Times",
		"serif",
	],
	mono: [
		"ui-monospace",
		"SFMono-Regular",
		'"Menlo"',
		"Monaco",
		"Consolas",
		'"Liberation Mono"',
		'"Courier New"',
		"monospace",
	],
};
