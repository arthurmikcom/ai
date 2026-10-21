// The app's own lint (Expo's rules); the site's config in the root skips mobile/.
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([expoConfig, { ignores: ["dist/*", ".expo/*"] }]);
