/**
 * Accessibility Tokens - WCAG 2.1 AA Compliance
 * Focus ring colors, minimum touch targets, and contrast ratios
 */

export interface AccessibilityTokens {
	// Focus indicators
	focus: {
		ring: {
			color: string;
			width: string;
			offset: string;
			style: string;
		};
		visible: {
			color: string;
			width: string;
			offset: string;
			style: string;
		};
	};
	// Touch targets
	touchTarget: {
		minimum: string; // 44px minimum (iOS) / 48px (Android)
		comfortable: string; // 56px comfortable
		large: string; // 64px large
	};
	// Contrast ratios (for validation)
	contrast: {
		minimum: number; // 4.5:1 for normal text
		large: number; // 3:1 for large text (18pt+ or 14pt+ bold)
		enhanced: number; // 7:1 for AAA compliance
	};
	// Motion preferences
	motion: {
		reduce: string; // prefers-reduced-motion media query
		noPreference: string;
	};
	// High contrast mode
	highContrast: {
		background: string;
		foreground: string;
		border: string;
		focus: string;
	};
	// Screen reader only content
	srOnly: {
		position: string;
		width: string;
		height: string;
		padding: string;
		margin: string;
		overflow: string;
		clip: string;
		whiteSpace: string;
		border: string;
	};
}

// Focus ring system
export const focusRing = {
	color: "hsl(221, 83%, 53%)", // Primary color
	width: "2px",
	offset: "2px",
	style: "solid",
};

export const focusVisible = {
	color: "hsl(221, 83%, 53%)",
	width: "3px",
	offset: "1px",
	style: "solid",
};

// Touch target sizes (WCAG compliance)
export const touchTargets = {
	minimum: "48px", // WCAG 2.1 AA minimum
	comfortable: "56px", // Comfortable for most users
	large: "64px", // Large for accessibility
};

// Contrast ratio requirements
export const contrastRatios = {
	minimum: 4.5, // WCAG AA for normal text
	large: 3.0, // WCAG AA for large text
	enhanced: 7.0, // WCAG AAA for enhanced accessibility
};

// Motion preference media queries
export const motionPreferences = {
	reduce: "(prefers-reduced-motion: reduce)",
	noPreference: "(prefers-reduced-motion: no-preference)",
};

// High contrast mode colors
export const highContrastColors = {
	background: "Canvas",
	foreground: "CanvasText",
	border: "ButtonBorder",
	focus: "Highlight",
};

// Screen reader only utility
export const screenReaderOnly = {
	position: "absolute",
	width: "1px",
	height: "1px",
	padding: "0",
	margin: "-1px",
	overflow: "hidden",
	clip: "rect(0, 0, 0, 0)",
	whiteSpace: "nowrap",
	border: "0",
};

// Complete accessibility token system
export const accessibility: AccessibilityTokens = {
	focus: {
		ring: focusRing,
		visible: focusVisible,
	},
	touchTarget: touchTargets,
	contrast: contrastRatios,
	motion: motionPreferences,
	highContrast: highContrastColors,
	srOnly: screenReaderOnly,
};

// ARIA live region politeness levels
export const ariaLive = {
	off: "off",
	polite: "polite",
	assertive: "assertive",
};

// Common ARIA roles for components
export const ariaRoles = {
	button: "button",
	link: "link",
	navigation: "navigation",
	main: "main",
	banner: "banner",
	contentinfo: "contentinfo",
	complementary: "complementary",
	search: "search",
	form: "form",
	dialog: "dialog",
	alertdialog: "alertdialog",
	alert: "alert",
	status: "status",
	progressbar: "progressbar",
	tab: "tab",
	tablist: "tablist",
	tabpanel: "tabpanel",
	menu: "menu",
	menubar: "menubar",
	menuitem: "menuitem",
	listbox: "listbox",
	option: "option",
	combobox: "combobox",
	tree: "tree",
	treeitem: "treeitem",
	grid: "grid",
	gridcell: "gridcell",
	row: "row",
	columnheader: "columnheader",
	rowheader: "rowheader",
};

// Keyboard navigation keys
export const keyboardKeys = {
	enter: "Enter",
	space: " ",
	escape: "Escape",
	tab: "Tab",
	arrowUp: "ArrowUp",
	arrowDown: "ArrowDown",
	arrowLeft: "ArrowLeft",
	arrowRight: "ArrowRight",
	home: "Home",
	end: "End",
	pageUp: "PageUp",
	pageDown: "PageDown",
};
