import { defineProject } from 'vitest/config';

export default defineProject({
  resolve: {
    alias: { '@': new URL('./src', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1') },
  },
  test: { name: 'web', include: ['test/**/*.test.ts'] },
});
