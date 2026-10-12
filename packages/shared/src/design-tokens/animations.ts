/**
 * Animation System - Timing, Easing, and Micro-interactions
 * Provides consistent animation tokens for modern interactions
 */

export interface AnimationSystem {
	// Duration tokens
	duration: {
		instant: string;
		fast: string;
		normal: string;
		slow: string;
		slower: string;
		slowest: string;
	};
	// Easing functions
	easing: {
		linear: string;
		easeIn: string;
		easeOut: string;
		easeInOut: string;
		// Custom easing for modern feel
		spring: string;
		bounce: string;
		elastic: string;
		// Framer Motion compatible
		anticipate: string;
		backIn: string;
		backOut: string;
		backInOut: string;
		circIn: string;
		circOut: string;
		circInOut: string;
	};
	// Keyframe animations
	keyframes: {
		fadeIn: string;
		fadeOut: string;
		slideInUp: string;
		slideInDown: string;
		slideInLeft: string;
		slideInRight: string;
		slideOutUp: string;
		slideOutDown: string;
		slideOutLeft: string;
		slideOutRight: string;
		scaleIn: string;
		scaleOut: string;
		spin: string;
		pulse: string;
		bounce: string;
		shake: string;
		glow: string;
		float: string;
	};
	// Micro-interaction timings
	microInteraction: {
		hover: string;
		focus: string;
		active: string;
		disabled: string;
	};
}

// Animation duration tokens
export const duration = {
	instant: "0ms",
	fast: "150ms",
	normal: "300ms",
	slow: "500ms",
	slower: "750ms",
	slowest: "1000ms",
};

// Easing function tokens
export const easing = {
	// Standard CSS easing
	linear: "linear",
	easeIn: "cubic-bezier(0.4, 0, 1, 1)",
	easeOut: "cubic-bezier(0, 0, 0.2, 1)",
	easeInOut: "cubic-bezier(0.4, 0, 0.2, 1)",

	// Custom easing for modern feel
	spring: "cubic-bezier(0.175, 0.885, 0.32, 1.275)",
	bounce: "cubic-bezier(0.68, -0.55, 0.265, 1.55)",
	elastic: "cubic-bezier(0.25, 0.46, 0.45, 0.94)",

	// Framer Motion compatible easing
	anticipate: "cubic-bezier(0.215, 0.61, 0.355, 1)",
	backIn: "cubic-bezier(0.6, -0.28, 0.735, 0.045)",
	backOut: "cubic-bezier(0.175, 0.885, 0.32, 1.275)",
	backInOut: "cubic-bezier(0.68, -0.55, 0.265, 1.55)",
	circIn: "cubic-bezier(0.6, 0.04, 0.98, 0.335)",
	circOut: "cubic-bezier(0.075, 0.82, 0.165, 1)",
	circInOut: "cubic-bezier(0.785, 0.135, 0.15, 0.86)",
};

// Keyframe animations
export const keyframes = {
	fadeIn: `
    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
  `,
	fadeOut: `
    @keyframes fadeOut {
      from { opacity: 1; }
      to { opacity: 0; }
    }
  `,
	slideInUp: `
    @keyframes slideInUp {
      from {
        opacity: 0;
        transform: translateY(100%);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
  `,
	slideInDown: `
    @keyframes slideInDown {
      from {
        opacity: 0;
        transform: translateY(-100%);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
  `,
	slideInLeft: `
    @keyframes slideInLeft {
      from {
        opacity: 0;
        transform: translateX(-100%);
      }
      to {
        opacity: 1;
        transform: translateX(0);
      }
    }
  `,
	slideInRight: `
    @keyframes slideInRight {
      from {
        opacity: 0;
        transform: translateX(100%);
      }
      to {
        opacity: 1;
        transform: translateX(0);
      }
    }
  `,
	slideOutUp: `
    @keyframes slideOutUp {
      from {
        opacity: 1;
        transform: translateY(0);
      }
      to {
        opacity: 0;
        transform: translateY(-100%);
      }
    }
  `,
	slideOutDown: `
    @keyframes slideOutDown {
      from {
        opacity: 1;
        transform: translateY(0);
      }
      to {
        opacity: 0;
        transform: translateY(100%);
      }
    }
  `,
	slideOutLeft: `
    @keyframes slideOutLeft {
      from {
        opacity: 1;
        transform: translateX(0);
      }
      to {
        opacity: 0;
        transform: translateX(-100%);
      }
    }
  `,
	slideOutRight: `
    @keyframes slideOutRight {
      from {
        opacity: 1;
        transform: translateX(0);
      }
      to {
        opacity: 0;
        transform: translateX(100%);
      }
    }
  `,
	scaleIn: `
    @keyframes scaleIn {
      from {
        opacity: 0;
        transform: scale(0.9);
      }
      to {
        opacity: 1;
        transform: scale(1);
      }
    }
  `,
	scaleOut: `
    @keyframes scaleOut {
      from {
        opacity: 1;
        transform: scale(1);
      }
      to {
        opacity: 0;
        transform: scale(0.9);
      }
    }
  `,
	spin: `
    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
  `,
	pulse: `
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
  `,
	bounce: `
    @keyframes bounce {
      0%, 100% {
        transform: translateY(-25%);
        animation-timing-function: cubic-bezier(0.8, 0, 1, 1);
      }
      50% {
        transform: translateY(0);
        animation-timing-function: cubic-bezier(0, 0, 0.2, 1);
      }
    }
  `,
	shake: `
    @keyframes shake {
      0%, 100% { transform: translateX(0); }
      10%, 30%, 50%, 70%, 90% { transform: translateX(-10px); }
      20%, 40%, 60%, 80% { transform: translateX(10px); }
    }
  `,
	glow: `
    @keyframes glow {
      0%, 100% { box-shadow: 0 0 5px rgba(221, 83, 53, 0.5); }
      50% { box-shadow: 0 0 20px rgba(221, 83, 53, 0.8); }
    }
  `,
	float: `
    @keyframes float {
      0%, 100% { transform: translateY(0px); }
      50% { transform: translateY(-10px); }
    }
  `,
};

// Micro-interaction timing tokens
export const microInteraction = {
	hover: duration.fast,
	focus: duration.fast,
	active: duration.instant,
	disabled: duration.normal,
};

// Complete animation system
export const animations: AnimationSystem = {
	duration,
	easing,
	keyframes,
	microInteraction,
};

// Framer Motion variants for common animations
export const motionVariants = {
	fadeIn: {
		initial: { opacity: 0 },
		animate: { opacity: 1 },
		exit: { opacity: 0 },
		transition: { duration: 0.3, ease: "easeOut" },
	},
	slideUp: {
		initial: { opacity: 0, y: 20 },
		animate: { opacity: 1, y: 0 },
		exit: { opacity: 0, y: -20 },
		transition: { duration: 0.3, ease: "easeOut" },
	},
	scaleIn: {
		initial: { opacity: 0, scale: 0.9 },
		animate: { opacity: 1, scale: 1 },
		exit: { opacity: 0, scale: 0.9 },
		transition: { duration: 0.2, ease: "easeOut" },
	},
	spring: {
		initial: { opacity: 0, scale: 0.8 },
		animate: { opacity: 1, scale: 1 },
		exit: { opacity: 0, scale: 0.8 },
		transition: {
			type: "spring",
			stiffness: 300,
			damping: 30,
		},
	},
	stagger: {
		animate: {
			transition: {
				staggerChildren: 0.1,
			},
		},
	},
};
