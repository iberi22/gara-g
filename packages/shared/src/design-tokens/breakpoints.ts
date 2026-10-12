/**
 * Breakpoint System - Responsive Design Tokens
 * Mobile-first breakpoints for consistent responsive behavior
 */

export interface BreakpointSystem {
	// Breakpoint values
	values: {
		xs: string;
		sm: string;
		md: string;
		lg: string;
		xl: string;
		"2xl": string;
	};
	// Media queries
	up: {
		xs: string;
		sm: string;
		md: string;
		lg: string;
		xl: string;
		"2xl": string;
	};
	down: {
		xs: string;
		sm: string;
		md: string;
		lg: string;
		xl: string;
		"2xl": string;
	};
	between: {
		"xs-sm": string;
		"sm-md": string;
		"md-lg": string;
		"lg-xl": string;
		"xl-2xl": string;
	};
	only: {
		xs: string;
		sm: string;
		md: string;
		lg: string;
		xl: string;
		"2xl": string;
	};
}

// Breakpoint values (mobile-first)
export const breakpointValues = {
	xs: "0px", // Extra small devices
	sm: "640px", // Small devices (landscape phones)
	md: "768px", // Medium devices (tablets)
	lg: "1024px", // Large devices (desktops)
	xl: "1280px", // Extra large devices (large desktops)
	"2xl": "1536px", // 2X large devices (larger desktops)
};

// Media query helpers - up (min-width)
export const mediaUp = {
	xs: `(min-width: ${breakpointValues.xs})`,
	sm: `(min-width: ${breakpointValues.sm})`,
	md: `(min-width: ${breakpointValues.md})`,
	lg: `(min-width: ${breakpointValues.lg})`,
	xl: `(min-width: ${breakpointValues.xl})`,
	"2xl": `(min-width: ${breakpointValues["2xl"]})`,
};

// Media query helpers - down (max-width)
export const mediaDown = {
	xs: `(max-width: ${Number.parseInt(breakpointValues.sm) - 1}px)`,
	sm: `(max-width: ${Number.parseInt(breakpointValues.md) - 1}px)`,
	md: `(max-width: ${Number.parseInt(breakpointValues.lg) - 1}px)`,
	lg: `(max-width: ${Number.parseInt(breakpointValues.xl) - 1}px)`,
	xl: `(max-width: ${Number.parseInt(breakpointValues["2xl"]) - 1}px)`,
	"2xl": "(max-width: 9999px)", // No upper limit for 2xl
};

// Media query helpers - between ranges
export const mediaBetween = {
	"xs-sm": `(min-width: ${breakpointValues.xs}) and (max-width: ${Number.parseInt(breakpointValues.md) - 1}px)`,
	"sm-md": `(min-width: ${breakpointValues.sm}) and (max-width: ${Number.parseInt(breakpointValues.lg) - 1}px)`,
	"md-lg": `(min-width: ${breakpointValues.md}) and (max-width: ${Number.parseInt(breakpointValues.xl) - 1}px)`,
	"lg-xl": `(min-width: ${breakpointValues.lg}) and (max-width: ${Number.parseInt(breakpointValues["2xl"]) - 1}px)`,
	"xl-2xl": `(min-width: ${breakpointValues.xl})`,
};

// Media query helpers - only specific breakpoint
export const mediaOnly = {
	xs: `(max-width: ${Number.parseInt(breakpointValues.sm) - 1}px)`,
	sm: `(min-width: ${breakpointValues.sm}) and (max-width: ${Number.parseInt(breakpointValues.md) - 1}px)`,
	md: `(min-width: ${breakpointValues.md}) and (max-width: ${Number.parseInt(breakpointValues.lg) - 1}px)`,
	lg: `(min-width: ${breakpointValues.lg}) and (max-width: ${Number.parseInt(breakpointValues.xl) - 1}px)`,
	xl: `(min-width: ${breakpointValues.xl}) and (max-width: ${Number.parseInt(breakpointValues["2xl"]) - 1}px)`,
	"2xl": `(min-width: ${breakpointValues["2xl"]})`,
};

// Complete breakpoint system
export const breakpoints: BreakpointSystem = {
	values: breakpointValues,
	up: mediaUp,
	down: mediaDown,
	between: mediaBetween,
	only: mediaOnly,
};

// Container max-widths for each breakpoint
export const containerMaxWidths = {
	xs: "100%",
	sm: "640px",
	md: "768px",
	lg: "1024px",
	xl: "1280px",
	"2xl": "1536px",
};

// Grid system configuration
export const gridSystem = {
	columns: 12,
	gutter: {
		xs: "16px",
		sm: "24px",
		md: "32px",
		lg: "40px",
		xl: "48px",
		"2xl": "56px",
	},
	margin: {
		xs: "16px",
		sm: "24px",
		md: "32px",
		lg: "40px",
		xl: "48px",
		"2xl": "56px",
	},
};

// Common device targets
export const deviceTargets = {
	mobile: mediaDown.sm,
	tablet: mediaBetween["sm-md"],
	desktop: mediaUp.lg,
	largeDesktop: mediaUp.xl,
	// Specific device orientations
	mobilePortrait: `${mediaDown.sm} and (orientation: portrait)`,
	mobileLandscape: `${mediaDown.sm} and (orientation: landscape)`,
	tabletPortrait: `${mediaBetween["sm-md"]} and (orientation: portrait)`,
	tabletLandscape: `${mediaBetween["sm-md"]} and (orientation: landscape)`,
};
