import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths: the build works at a domain root or under a sub-path.
  base: './',
  server: { port: 5181, strictPort: true },
  build: { target: 'es2022' },
});
