// base relativa: el mismo build funciona en GitHub Pages (subcarpeta) y en local.
export default { base: './', build: { target: 'es2022' }, esbuild: { target: 'es2022' }, optimizeDeps: { esbuildOptions: { target: 'es2022' } } };
