# Design Tokens System

A comprehensive design token system for the gara-g application, providing consistent design values across all components and platforms.

## Overview

This design token system follows modern best practices and includes:

- **Semantic color scales** (50-950) with HSL values
- **8pt grid spacing system** for consistent layouts
- **Typography scales** with clear hierarchy
- **Shadow system** with elevation levels
- **Animation tokens** for consistent motion
- **Accessibility tokens** for WCAG compliance
- **Responsive breakpoints** for mobile-first design
- **Theme variants** (light, dark, high-contrast)

## Features

### 🎨 Color System
- Primary, secondary, success, warning, error, info color scales
- Semantic color tokens (background, foreground, border)
- Gradient definitions for modern effects
- Theme variants with automatic CSS custom properties

### 📏 Spacing System
- 8pt grid-based spacing scale
- Semantic spacing tokens for components and layouts
- Touch target sizes for accessibility
- Z-index scale for consistent layering

### 🔤 Typography System
- Font size scale from xs to 9xl
- Font weight definitions
- Line height and letter spacing tokens
- Semantic typography styles (headings, body, labels)

### 🌟 Visual Effects
- Shadow system with elevation levels
- Glassmorphism effects
- Drop shadows and text shadows
- Focus ring styles

### 🎬 Animation System
- Duration tokens (instant to slowest)
- Easing function definitions
- Keyframe animations
- Framer Motion variants
- Reduced motion support

### ♿ Accessibility
- WCAG 2.1 AA compliant contrast ratios
- Touch target minimum sizes
- Focus management tokens
- Screen reader utilities
- High contrast mode support

### 📱 Responsive Design
- Mobile-first breakpoint system
- Container max-widths
- Grid system configuration
- Device-specific media queries

## Usage

### TypeScript/JavaScript

```typescript
import { designTokens } from '@gara-g/shared';

// Access color tokens
const primaryColor = designTokens.colors.primary.DEFAULT;
const backgroundColor = designTokens.colors.background.primary;

// Access spacing tokens
const mediumSpacing = designTokens.spacing[4]; // 16px
const componentPadding = designTokens.semanticSpacing.componentPadding.md;

// Access typography tokens
const headingSize = designTokens.typography.fontSize['2xl'];
const bodyText = designTokens.semanticTypography.body.base;

// Access animation tokens
const fastDuration = designTokens.animations.duration.fast;
const springEasing = designTokens.animations.easing.spring;
```

### CSS Custom Properties

```css
.my-component {
  /* Colors */
  background-color: var(--color-background-primary);
  color: var(--color-foreground-primary);
  border-color: var(--color-border-primary);

  /* Spacing */
  padding: var(--space-4);
  margin: var(--space-2);

  /* Shadows */
  box-shadow: var(--shadow-md);

  /* Animations */
  transition: all var(--duration-normal) var(--ease-out);
}

/* Focus states */
.my-button:focus-visible {
  box-shadow: var(--shadow-focus);
}

/* Glass effect */
.glass-card {
  background: var(--gradient-glass);
  backdrop-filter: blur(10px);
  box-shadow: var(--shadow-glass);
}
```

### Tailwind CSS

```html
<!-- Using color tokens -->
<div class="bg-primary-500 text-white">Primary colored element</div>
<div class="bg-background-primary text-foreground-primary">Semantic colors</div>

<!-- Using spacing tokens -->
<div class="p-4 m-2 space-y-6">Consistent spacing</div>

<!-- Using shadow tokens -->
<div class="shadow-md hover:shadow-lg">Elevated card</div>

<!-- Using animation classes -->
<div class="animate-fade-in transition-all duration-normal ease-out">
  Animated element
</div>

<!-- Using glass effects -->
<div class="glass backdrop-blur-md">Glass morphism effect</div>
```

## Theme System

The design token system supports multiple themes:

### Light Theme (Default)
```typescript
import { lightTheme } from '@gara-g/shared';
```

### Dark Theme
```typescript
import { darkTheme } from '@gara-g/shared';
```

### High Contrast Theme
```typescript
import { highContrastTheme } from '@gara-g/shared';
```

### Dynamic Theme Switching

```typescript
import { generateCSSCustomProperties } from '@gara-g/shared';

// Generate CSS for a theme
const lightCSS = generateCSSCustomProperties(lightTheme);
const darkCSS = generateCSSCustomProperties(darkTheme);

// Apply theme by adding CSS class
document.documentElement.classList.add('dark'); // or 'high-contrast'
```

## Validation

The system includes built-in validation for:

- Color contrast ratios (WCAG compliance)
- Spacing consistency (8pt grid)
- Touch target sizes
- Animation performance
- Token completeness

```typescript
import { validateDesignTokens, formatValidationResults } from '@gara-g/shared';

const results = validateDesignTokens();
console.log(formatValidationResults(results));
```

## Build Process

The design tokens are automatically validated and built:

```bash
# Build tokens and validate
npm run build

# Only build tokens
npm run build:tokens

# Only validate tokens
npm run validate:tokens
```

## File Structure

```
design-tokens/
├── index.ts              # Main export file
├── colors.ts             # Color system and scales
├── spacing.ts            # Spacing and layout tokens
├── typography.ts         # Typography system
├── shadows.ts            # Shadow and elevation system
├── animations.ts         # Animation and timing tokens
├── accessibility.ts      # Accessibility tokens
├── breakpoints.ts        # Responsive design tokens
├── themes.ts             # Theme variants
├── tokens.ts             # Complete token system
├── validate.ts           # Validation system
├── tailwind.config.ts    # Tailwind CSS integration
├── globals.css           # Global CSS with tokens
└── README.md             # This file
```

## Best Practices

### Using Color Tokens
- Use semantic tokens (`background.primary`) over direct color values
- Ensure proper contrast ratios for accessibility
- Test with different themes (light, dark, high-contrast)

### Using Spacing Tokens
- Follow the 8pt grid system for consistency
- Use semantic spacing tokens for common patterns
- Ensure touch targets meet minimum size requirements

### Using Animation Tokens
- Respect `prefers-reduced-motion` user preference
- Use appropriate durations for different types of animations
- Test performance on low-end devices

### Using Typography Tokens
- Use semantic typography styles for consistency
- Ensure proper heading hierarchy
- Test readability across different screen sizes

## Contributing

When adding new tokens:

1. Follow existing naming conventions
2. Add validation rules if needed
3. Update documentation
4. Test across all themes
5. Ensure accessibility compliance

## Migration Guide

When updating from older design systems:

1. Replace hardcoded values with token references
2. Update component styles to use CSS custom properties
3. Test with all theme variants
4. Validate accessibility compliance
5. Update documentation

---

This design token system provides a solid foundation for consistent, accessible, and maintainable design across the gara-g application.