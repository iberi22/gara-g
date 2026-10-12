/**
 * Color System - HSL-based with semantic naming
 * Supports primary-50 to primary-950 scales for comprehensive theming
 */

export interface ColorScale {
	50: string;
	100: string;
	200: string;
	300: string;
	400: string;
	500: string;
	600: string;
	700: string;
	800: string;
	900: string;
	950: string;
	DEFAULT: string;
}

export interface ColorSystem {
	primary: ColorScale;
	secondary: ColorScale;
	success: ColorScale;
	warning: ColorScale;
	error: ColorScale;
	info: ColorScale;
	neutral: ColorScale;
	// Semantic colors
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
}

// Primary Blue Scale (Enhanced from current 221.2 83.2% 53.3%)
export const primaryScale: ColorScale = {
	50: "hsl(214, 100%, 97%)",
	100: "hsl(214, 95%, 93%)",
	200: "hsl(213, 97%, 87%)",
	300: "hsl(212, 96%, 78%)",
	400: "hsl(213, 94%, 68%)",
	500: "hsl(221, 83%, 53%)", // Current primary
	600: "hsl(221, 83%, 48%)",
	700: "hsl(221, 83%, 43%)",
	800: "hsl(221, 83%, 38%)",
	900: "hsl(221, 83%, 33%)",
	950: "hsl(221, 83%, 23%)",
	DEFAULT: "hsl(221, 83%, 53%)",
};

// Secondary Gray Scale (Enhanced from current 210 40% 96%)
export const secondaryScale: ColorScale = {
	50: "hsl(210, 40%, 98%)",
	100: "hsl(210, 40%, 96%)", // Current secondary
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
};

// Success Green Scale (Enhanced from current 142.1 76.2% 36.3%)
export const successScale: ColorScale = {
	50: "hsl(142, 76%, 95%)",
	100: "hsl(142, 76%, 88%)",
	200: "hsl(142, 76%, 78%)",
	300: "hsl(142, 76%, 65%)",
	400: "hsl(142, 76%, 52%)",
	500: "hsl(142, 76%, 36%)", // Current success
	600: "hsl(142, 76%, 32%)",
	700: "hsl(142, 76%, 28%)",
	800: "hsl(142, 76%, 24%)",
	900: "hsl(142, 76%, 20%)",
	950: "hsl(142, 76%, 12%)",
	DEFAULT: "hsl(142, 76%, 36%)",
};

// Warning Orange Scale (Enhanced from current 32.5 94.6% 43.7%)
export const warningScale: ColorScale = {
	50: "hsl(33, 95%, 95%)",
	100: "hsl(33, 95%, 88%)",
	200: "hsl(33, 95%, 78%)",
	300: "hsl(33, 95%, 65%)",
	400: "hsl(33, 95%, 55%)",
	500: "hsl(33, 95%, 44%)", // Current warning
	600: "hsl(33, 95%, 40%)",
	700: "hsl(33, 95%, 35%)",
	800: "hsl(33, 95%, 30%)",
	900: "hsl(33, 95%, 25%)",
	950: "hsl(33, 95%, 15%)",
	DEFAULT: "hsl(33, 95%, 44%)",
};

// Error Red Scale
export const errorScale: ColorScale = {
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
};

// Info Blue Scale (Enhanced from current 199.89 89.47% 49.41%)
export const infoScale: ColorScale = {
	50: "hsl(200, 89%, 95%)",
	100: "hsl(200, 89%, 88%)",
	200: "hsl(200, 89%, 78%)",
	300: "hsl(200, 89%, 65%)",
	400: "hsl(200, 89%, 57%)",
	500: "hsl(200, 89%, 49%)", // Current info
	600: "hsl(200, 89%, 45%)",
	700: "hsl(200, 89%, 40%)",
	800: "hsl(200, 89%, 35%)",
	900: "hsl(200, 89%, 30%)",
	950: "hsl(200, 89%, 20%)",
	DEFAULT: "hsl(200, 89%, 49%)",
};

// Neutral Scale (Enhanced from current 222.2 84% 4.9%)
export const neutralScale: ColorScale = {
	50: "hsl(0, 0%, 98%)",
	100: "hsl(0, 0%, 96%)",
	200: "hsl(0, 0%, 92%)",
	300: "hsl(0, 0%, 85%)",
	400: "hsl(0, 0%, 70%)",
	500: "hsl(0, 0%, 50%)",
	600: "hsl(0, 0%, 40%)",
	700: "hsl(0, 0%, 30%)",
	800: "hsl(0, 0%, 20%)",
	900: "hsl(222, 84%, 5%)", // Current foreground
	950: "hsl(222, 84%, 3%)",
	DEFAULT: "hsl(0, 0%, 50%)",
};

// Complete Color System
export const colors: ColorSystem = {
	primary: primaryScale,
	secondary: secondaryScale,
	success: successScale,
	warning: warningScale,
	error: errorScale,
	info: infoScale,
	neutral: neutralScale,
	background: {
		primary: "hsl(0, 0%, 100%)", // Current background
		secondary: "hsl(0, 0%, 98%)",
		tertiary: "hsl(210, 40%, 96%)",
		inverse: "hsl(222, 84%, 5%)",
	},
	foreground: {
		primary: "hsl(222, 84%, 5%)", // Current foreground
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
};

// Gradient Definitions
export const gradients = {
	primary:
		"linear-gradient(135deg, hsl(221, 83%, 53%) 0%, hsl(221, 83%, 48%) 100%)",
	primarySubtle:
		"linear-gradient(135deg, hsl(214, 100%, 97%) 0%, hsl(214, 95%, 93%) 100%)",
	success:
		"linear-gradient(135deg, hsl(142, 76%, 36%) 0%, hsl(142, 76%, 32%) 100%)",
	warning:
		"linear-gradient(135deg, hsl(33, 95%, 44%) 0%, hsl(33, 95%, 40%) 100%)",
	error: "linear-gradient(135deg, hsl(0, 84%, 55%) 0%, hsl(0, 84%, 50%) 100%)",
	info: "linear-gradient(135deg, hsl(200, 89%, 49%) 0%, hsl(200, 89%, 45%) 100%)",
	glass:
		"linear-gradient(135deg, rgba(255, 255, 255, 0.25) 0%, rgba(255, 255, 255, 0.1) 100%)",
	glassDark:
		"linear-gradient(135deg, rgba(0, 0, 0, 0.25) 0%, rgba(0, 0, 0, 0.1) 100%)",
};
