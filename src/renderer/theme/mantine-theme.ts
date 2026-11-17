import {
  Avatar,
  Button,
  Card,
  Checkbox,
  Combobox,
  colorsTuple,
  createTheme,
  Drawer,
  HoverCard,
  Input,
  Menu,
  Modal,
  NativeSelect,
  Paper,
  Popover,
  rem,
  Select,
  Slider,
  Switch,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import { GLASS_DROPDOWN_CLASS_NAMES } from '@/lib/glass-surface'

export const creteMantineTheme = (scale = 1) =>
  createTheme({
    /** Put your mantine theme override here */
    scale,
    // Controls (buttons, rows, icon buttons, inputs) use md; surfaces (modals, cards, papers) opt into lg below.
    defaultRadius: 'md',
    primaryColor: 'chatbox-brand',
    colors: {
      'chatbox-brand': colorsTuple(Array.from({ length: 10 }, () => 'var(--chatbox-tint-brand)')),
      'chatbox-gray': colorsTuple(Array.from({ length: 10 }, () => 'var(--chatbox-tint-gray)')),
      'chatbox-success': colorsTuple(Array.from({ length: 10 }, () => 'var(--chatbox-tint-success)')),
      'chatbox-error': colorsTuple(Array.from({ length: 10 }, () => 'var(--chatbox-tint-error)')),
      'chatbox-warning': colorsTuple(Array.from({ length: 10 }, () => 'var(--chatbox-tint-warning)')),

      'chatbox-primary': colorsTuple(Array.from({ length: 10 }, () => 'var(--chatbox-tint-primary)')),
      'chatbox-secondary': colorsTuple(Array.from({ length: 10 }, () => 'var(--chatbox-tint-secondary)')),
      'chatbox-tertiary': colorsTuple(Array.from({ length: 10 }, () => 'var(--chatbox-tint-tertiary)')),
    },
    headings: {
      fontWeight: 'Bold',
      sizes: {
        h1: {
          fontSize: 'calc(2.5rem * var(--mantine-scale))', // 40px
          lineHeight: '1.2', // 48px
        },
        h2: {
          fontSize: 'calc(2rem * var(--mantine-scale))', // 32px
          lineHeight: '1.25', //  40px
        },
        h3: {
          fontSize: 'calc(1.5rem * var(--mantine-scale))', // 24px
          lineHeight: '1.3333333333', // 32px
        },
        h4: {
          fontSize: 'calc(1.125rem * var(--mantine-scale))', // 18px
          lineHeight: '1.3333333333', // 24px
        },
        h5: {
          fontSize: 'calc(1rem * var(--mantine-scale))', // 16px
          lineHeight: '1.25', // 20px
        },
        h6: {
          fontSize: 'calc(0.75rem * var(--mantine-scale))', // 12px
          lineHeight: '1.3333333333', // 16px
        },
      },
    },
    fontSizes: {
      xxs: 'calc(0.625rem * var(--mantine-scale))', // 10px
      xs: 'calc(0.75rem * var(--mantine-scale))', // 12px
      sm: 'calc(0.875rem * var(--mantine-scale))', // 14px
      md: 'calc(1rem * var(--mantine-scale))', // 16px
      lg: 'calc(1.125rem * var(--mantine-scale))', // 18px
      xl: 'calc(1.25rem * var(--mantine-scale))', // 20px
    },
    lineHeights: {
      xxs: '1.3', // 13px
      xs: '1.3333333333', // 16px
      sm: '1.4285714286', // 20px
      md: '1.5', // 24px
      lg: '1.5555555556', // 28px
      xl: '1.6', // 32px
    },
    radius: {
      xs: 'calc(0.125rem * var(--mantine-scale))',
      sm: 'calc(0.25rem * var(--mantine-scale))',
      md: 'calc(0.5rem * var(--mantine-scale))',
      lg: 'calc(1rem * var(--mantine-scale))',
      xl: 'calc(1.5rem * var(--mantine-scale))',
      xxl: 'calc(2rem * var(--mantine-scale))',
    },
    spacing: {
      '3xs': 'calc(0.125rem * var(--mantine-scale))',
      xxs: 'calc(0.25rem * var(--mantine-scale))',
      xs: 'calc(0.5rem * var(--mantine-scale))',
      sm: 'calc(0.75rem * var(--mantine-scale))',
      md: 'calc(1rem * var(--mantine-scale))',
      lg: 'calc(1.25rem * var(--mantine-scale))',
      xl: 'calc(1.5rem * var(--mantine-scale))',
      xxl: 'calc(2rem * var(--mantine-scale))',
    },
    components: {
      Text: Text.extend({
        defaultProps: {
          size: 'sm',
          c: 'chatbox-primary',
        },
      }),
      Title: Title.extend({
        defaultProps: {
          c: 'chatbox-primary',
        },
      }),
      Button: Button.extend({
        defaultProps: {
          color: 'chatbox-brand',
        },
        styles: () => ({
          root: {
            '--button-height-sm': rem('32px'),
            '--button-height-compact-xs': rem('24px'),
            fontWeight: '400',
          },
        }),
      }),
      Input: Input.extend({
        styles: (_theme, props) => ({
          wrapper: {
            '--input-height-sm': rem('32px'),
            ...(props.error
              ? {
                  '--input-color': 'var(--chatbox-tint-error)',
                  '--input-bd': 'var(--chatbox-tint-error)',
                }
              : {}),
          },
        }),
      }),
      TextInput: TextInput.extend({
        defaultProps: {
          size: 'sm',
        },
        styles: () => ({
          label: {
            marginBottom: 'var(--chatbox-spacing-xxs)',
            fontWeight: '600',
            lineHeight: '1.5',
          },
        }),
      }),
      Textarea: TextInput.extend({
        defaultProps: {
          size: 'sm',
        },
        styles: () => ({
          label: {
            marginBottom: 'var(--chatbox-spacing-xxs)',
            fontWeight: '600',
            lineHeight: '1.5',
          },
        }),
      }),
      Select: Select.extend({
        defaultProps: {
          size: 'sm',
          allowDeselect: false,
        },
        styles: () => ({
          label: {
            marginBottom: 'var(--chatbox-spacing-xxs)',
            fontWeight: '600',
            lineHeight: '1.5',
          },
        }),
      }),
      NativeSelect: NativeSelect.extend({
        defaultProps: {
          size: 'sm',
        },
        styles: () => ({
          label: {
            marginBottom: 'var(--chatbox-spacing-xxs)',
            fontWeight: '600',
            lineHeight: '1.5',
          },
        }),
      }),
      Switch: Switch.extend({
        defaultProps: {
          size: 'sm',
        },
        styles: (_theme, props) => {
          return {
            label: {
              color: props.checked ? 'var(--chatbox-tint-primary)' : 'var(--chatbox-tint-tertiary)',
            },
          }
        },
      }),
      Checkbox: Checkbox.extend({
        defaultProps: {
          size: 'sm',
        },
        styles: (_theme, props) => ({
          label: {
            color: props.checked ? 'var(--chatbox-tint-primary)' : 'var(--chatbox-tint-tertiary)',
          },
        }),
      }),
      Modal: Modal.extend({
        defaultProps: {
          zIndex: 2000,
          radius: 'lg',
        },
        styles: () => ({
          title: {
            fontWeight: '600',
            color: 'var(--chatbox-tint-primary)',
            fontSize: 'var(--mantine-font-size-sm)',
          },
          close: {
            width: rem('24px'),
            height: rem('24px'),
            color: 'var(--chatbox-tint-secondary)',
          },
          header: {
            backgroundColor: 'var(--chatbox-background-primary)',
          },
          content: {
            backgroundColor: 'var(--chatbox-background-primary)',
          },
          overlay: {
            '--overlay-bg': 'var(--chatbox-background-mask-overlay)',
            '--overlay-filter': 'blur(4px)',
          },
        }),
      }),
      Drawer: Drawer.extend({
        defaultProps: {
          zIndex: 2000,
        },
        styles: () => ({
          title: {
            fontWeight: '600',
            color: 'var(--chatbox-tint-primary)',
            fontSize: 'var(--mantine-font-size-sm)',
          },
          close: {
            width: rem('24px'),
            height: rem('24px'),
            color: 'var(--chatbox-tint-secondary)',
          },
          content: {
            backgroundColor: 'var(--chatbox-background-primary)',
          },
          overlay: {
            '--overlay-bg': 'var(--chatbox-background-mask-overlay)',
          },
        }),
      }),
      // Dropdowns turn to frosted glass over a chat wallpaper (lib/glass-surface.ts). Select and other
      // Combobox-based inputs inherit it from Combobox.
      Combobox: Combobox.extend({
        defaultProps: {
          shadow: 'md',
          zIndex: 2100,
        },
        classNames: GLASS_DROPDOWN_CLASS_NAMES,
      }),
      Menu: Menu.extend({
        classNames: GLASS_DROPDOWN_CLASS_NAMES,
      }),
      HoverCard: HoverCard.extend({
        classNames: GLASS_DROPDOWN_CLASS_NAMES,
      }),
      Paper: Paper.extend({
        defaultProps: {
          radius: 'lg',
        },
      }),
      Card: Card.extend({
        defaultProps: {
          radius: 'lg',
        },
      }),
      Avatar: Avatar.extend({
        styles: () => ({
          image: {
            objectFit: 'contain',
          },
        }),
      }),
      Popover: Popover.extend({
        defaultProps: {
          zIndex: 3000,
        },
        classNames: GLASS_DROPDOWN_CLASS_NAMES,
      }),
      Slider: Slider.extend({
        classNames: {
          trackContainer: 'max-sm:pointer-events-none',
          thumb: 'max-sm:pointer-events-auto',
        },
      }),
    },
  })
