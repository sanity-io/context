import {defineConfig} from '@sanity/pkg-utils'

// https://github.com/sanity-io/pkg-utils#configuration
export default defineConfig({
  tsconfig: 'tsconfig.dist.json',
  external: ['sanity'],
  extract: {
    // We already check types with `check:types` scripts
    checkTypes: false,
  },
})
