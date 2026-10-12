/**
 * Spacing System - 8pt Grid with Semantic Naming
 * Provides consistent spacing for layouts and components
 */

export interface SpacingScale {
	0: string;
	px: string;
	0.5: string;
	1: string;
	1.5: string;
	2: string;
	2.5: string;
	3: string;
	3.5: string;
	4: string;
	5: string;
	6: string;
	7: string;
	8: string;
	9: string;
	10: string;
	11: string;
	12: string;
	14: string;
	16: string;
	20: string;
	24: string;
	28: string;
	32: string;
	36: string;
	40: string;
	44: string;
	48: string;
	52: string;
	56: string;
	60: string;
	64: string;
	72: string;
	80: string;
	96: string;
}

export interface SemanticSpacing {
	// Component spacing
	componentPadding: {
		xs: string;
		sm: string;
		md: string;
		lg: string;
		xl: string;
	};
	// Layout spacing
	sectionGap: {
		xs: string;
		sm: string;
		md: string;
		lg: string;
		xl: string;
	};
	// Page margins
	pageMargin: {
		mobile: string;
		tablet: string;
		desktop: string;
	};
	// Interactive spacing
	interactiveMargin: {
		xs: string;
		sm: string;
		md: string;
		lg: string;
	};
	// Touch targets
	touchTarget: {
		minimum: string;
		comfortable: string;
		large: string;
	};
}

// Base spacing scale (8pt grid)
export const spacing: SpacingScale = {
	0: "0px",
	px: "1px",
	0.5: "2px", // 0.125rem
	1: "4px", // 0.25rem
	1.5: "6px", // 0.375rem
	2: "8px", // 0.5rem
	2.5: "10px", // 0.625rem
	3: "12px", // 0.75rem
	3.5: "14px", // 0.875rem
	4: "16px", // 1rem
	5: "20px", // 1.25rem
	6: "24px", // 1.5rem
	7: "28px", // 1.75rem
	8: "32px", // 2rem
	9: "36px", // 2.25rem
	10: "40px", // 2.5rem
	11: "44px", // 2.75rem
	12: "48px", // 3rem
	14: "56px", // 3.5rem
	16: "64px", // 4rem
	20: "80px", // 5rem
	24: "96px", // 6rem
	28: "112px", // 7rem
	32: "128px", // 8rem
	36: "144px", // 9rem
	40: "160px", // 10rem
	44: "176px", // 11rem
	48: "192px", // 12rem
	52: "208px", // 13rem
	56: "224px", // 14rem
	60: "240px", // 15rem
	64: "256px", // 16rem
	72: "288px", // 18rem
	80: "320px", // 20rem
	96: "384px", // 24rem
};

// Semantic spacing for specific use cases
export const semanticSpacing: SemanticSpacing = {
	componentPadding: {
		xs: spacing[2], // 8px
		sm: spacing[3], // 12px
		md: spacing[4], // 16px
		lg: spacing[6], // 24px
		xl: spacing[8], // 32px
	},
	sectionGap: {
		xs: spacing[4], // 16px
		sm: spacing[6], // 24px
		md: spacing[8], // 32px
		lg: spacing[12], // 48px
		xl: spacing[16], // 64px
	},
	pageMargin: {
		mobile: spacing[4], // 16px
		tablet: spacing[6], // 24px
		desktop: spacing[8], // 32px
	},
	interactiveMargin: {
		xs: spacing[1], // 4px
		sm: spacing[2], // 8px
		md: spacing[3], // 12px
		lg: spacing[4], // 16px
	},
	touchTarget: {
		minimum: spacing[12], // 48px (WCAG minimum)
		comfortable: spacing[14], // 56px
		large: spacing[16], // 64px
	},
};

// Border radius scale
export const borderRadius = {
	none: "0px",
	xs: "2px",
	sm: "4px",
	md: "6px",
	lg: "8px",
	xl: "12px",
	"2xl": "16px",
	"3xl": "24px",
	full: "9999px",
};

// Z-index scale for layering
export const zIndex = {
	hide: -1,
	auto: "auto",
	base: 0,
	docked: 10,
	dropdown: 1000,
	sticky: 1100,
	banner: 1200,
	overlay: 1300,
	modal: 1400,
	popover: 1500,
	skipLink: 1600,
	toast: 1700,
	tooltip: 1800,
};
