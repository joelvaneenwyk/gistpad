import globals from "globals";
import pluginJs from "@eslint/js";
import pluginTypescript from "typescript-eslint";

/** @type { import("eslint").Linter.FlatConfig[] } */
export default [
  {
    languageOptions: {
      globals: globals.browser
    }
  },
  pluginJs.configs.recommended,
  ...pluginTypescript.configs.recommended,
];
