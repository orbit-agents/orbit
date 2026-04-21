# @orbit/config

Shared tooling presets for the Orbit monorepo: ESLint flat config and TypeScript base tsconfigs.

## Usage

```ts
// eslint.config.js
import orbitConfig from '@orbit/config/eslint';
export default orbitConfig;
```

```jsonc
// tsconfig.json
{ "extends": "@orbit/config/tsconfig/react.json" }
```
