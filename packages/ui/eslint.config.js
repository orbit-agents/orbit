import orbitConfig from '@orbit/config/eslint';

export default [
  ...orbitConfig,
  {
    languageOptions: {
      parserOptions: {
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
];
