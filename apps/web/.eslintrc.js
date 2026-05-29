module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    sourceType: 'module',
    ecmaVersion: 2022,
    ecmaFeatures: { jsx: true },
  },
  plugins: ['@typescript-eslint/eslint-plugin', 'react-hooks'],
  extends: ['plugin:@typescript-eslint/recommended'],
  env: {
    browser: true,
    es2022: true,
    jest: true,
  },
  ignorePatterns: [
    '.eslintrc.js',
    'dist',
    '.expo',
    'node_modules',
    'babel.config.js',
    'metro.config.js',
    'jest.config.ts',
    'jest.setup.ts',
    'nativewind-env.d.ts',
    'expo-env.d.ts',
  ],
  rules: {
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
    // Honor the `_`-prefix convention for intentionally-unused bindings.
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
    ],
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',
  },
};
