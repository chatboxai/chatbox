/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['class'],
  content: ['./src/renderer/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        chatbox: {
          // Tint colors
          tint: {
            primary: 'var(--chatbox-tint-primary)',
            secondary: 'var(--chatbox-tint-secondary)',
            tertiary: 'var(--chatbox-tint-tertiary)',
            white: 'var(--chatbox-tint-white)',
            black: 'var(--chatbox-tint-black)',
            gray: 'var(--chatbox-tint-gray)',
            disabled: 'var(--chatbox-tint-disabled)',
            brand: 'var(--chatbox-tint-brand)',
            placeholder: 'var(--chatbox-tint-placeholder)',
            error: 'var(--chatbox-tint-error)',
            'error-disabled': 'var(--chatbox-tint-error-disabled)',
            warning: 'var(--chatbox-tint-warning)',
            success: 'var(--chatbox-tint-success)',
          },

          // Border colors
          border: {
            primary: 'var(--chatbox-border-primary)',
            secondary: 'var(--chatbox-border-secondary)',
            warning: 'var(--chatbox-border-warning)',
            error: 'var(--chatbox-border-error)',
            success: 'var(--chatbox-border-success)',
            brand: 'var(--chatbox-border-brand)',
          },

          // Background colors
          background: {
            primary: 'var(--chatbox-background-primary)',
            'primary-hover': 'var(--chatbox-background-primary-hover)',
            secondary: 'var(--chatbox-background-secondary)',
            'secondary-hover': 'var(--chatbox-background-secondary-hover)',
            tertiary: 'var(--chatbox-background-tertiary)',
            'tertiary-hover': 'var(--chatbox-background-tertiary-hover)',
            disabled: 'var(--chatbox-background-disabled)',

            // Brand
            'brand-primary': 'var(--chatbox-background-brand-primary)',
            'brand-primary-hover': 'var(--chatbox-background-brand-primary-hover)',
            'brand-secondary': 'var(--chatbox-background-brand-secondary)',
            'brand-secondary-hover': 'var(--chatbox-background-brand-secondary-hover)',

            // Gray
            'gray-primary': 'var(--chatbox-background-gray-primary)',
            'gray-primary-hover': 'var(--chatbox-background-gray-primary-hover)',
            'gray-secondary': 'var(--chatbox-background-gray-secondary)',
            'gray-secondary-hover': 'var(--chatbox-background-gray-secondary-hover)',

            // Success
            'success-primary': 'var(--chatbox-background-success-primary)',
            'success-primary-hover': 'var(--chatbox-background-success-primary-hover)',
            'success-secondary': 'var(--chatbox-background-success-secondary)',
            'success-secondary-hover': 'var(--chatbox-background-success-secondary-hover)',

            // Error
            'error-primary': 'var(--chatbox-background-error-primary)',
            'error-primary-hover': 'var(--chatbox-background-error-primary-hover)',
            'error-secondary': 'var(--chatbox-background-error-secondary)',
            'error-secondary-hover': 'var(--chatbox-background-error-secondary-hover)',

            // Warning
            'warning-primary': 'var(--chatbox-background-warning-primary)',
            'warning-primary-hover': 'var(--chatbox-background-warning-primary-hover)',
            'warning-secondary': 'var(--chatbox-background-warning-secondary)',
            'warning-secondary-hover': 'var(--chatbox-background-warning-secondary-hover)',

            // Mask
            'mask-overlay': 'var(--chatbox-background-mask-overlay)',
            'mask-lighten': 'var(--chatbox-background-mask-lighten)',
          },
        },
      },
      spacing: {
        none: 'var(--chatbox-spacing-none)',
        '3xs': 'var(--chatbox-spacing-3xs)',
        xxs: 'var(--chatbox-spacing-xxs)',
        xs: 'var(--chatbox-spacing-xs)',
        sm: 'var(--chatbox-spacing-sm)',
        md: 'var(--chatbox-spacing-md)',
        lg: 'var(--chatbox-spacing-lg)',
        xl: 'var(--chatbox-spacing-xl)',
        xxl: 'var(--chatbox-spacing-xxl)',
      },
      borderRadius: {
        none: 'var(--chatbox-radius-none)',
        xs: 'var(--chatbox-radius-xs)',
        sm: 'var(--chatbox-radius-sm)',
        md: 'var(--chatbox-radius-md)',
        lg: 'var(--chatbox-radius-lg)',
        xl: 'var(--chatbox-radius-xl)',
        xxl: 'var(--chatbox-radius-xxl)',
      },
      animation: {
        'fade-in': 'fadeIn 1s ease-out',
        flash: 'flash 0.5s ease-in-out 2',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        flash: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.3' },
        },
      },
    },
  },
  plugins: [require('tailwindcss-animate'), require('tailwind-scrollbar')],
  corePlugins: {
    preflight: false,
  },
}
