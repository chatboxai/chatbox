module.exports = {
  plugins: {
    'tailwindcss/nesting': {},
    tailwindcss: {},
    // The renderer runs in Chromium (Electron, Android WebView, Chrome) and WebKit (iOS WKWebView, Safari). Without
    // targets autoprefixer drops prefixes WebKit still requires, such as -webkit-user-select.
    autoprefixer: {
      overrideBrowserslist: ['chrome >= 100', 'and_chr >= 100', 'safari >= 14', 'ios_saf >= 14', 'firefox >= 115'],
    },
    'postcss-preset-mantine': {},
    'postcss-simple-vars': {
      variables: {
        'mantine-breakpoint-xs': '36em',
        'mantine-breakpoint-sm': '48em',
        'mantine-breakpoint-md': '62em',
        'mantine-breakpoint-lg': '75em',
        'mantine-breakpoint-xl': '88em',
      },
    },
  },
}
