import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths also work when GitHub Pages hosts the project
  // beneath a repository subpath.
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
