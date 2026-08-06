import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Separate build target for the owner-only Capacitor mobile app.
// Deliberately independent from vite.config.ts (the staff web app) -
// different entry point, different output directory, different base
// path (relative, since Capacitor serves from a local scheme rather
// than a URL subpath). Running `npm run build` for the staff app is
// completely unaffected by this file.
//
// root is set to src/mobile (which contains index.html) rather than
// using a custom-named HTML file at the project root, because
// Capacitor hard-requires the web asset directory's entry file to be
// literally named index.html - a differently-named file (e.g.
// mobile.html) is not recognized, even with a matching
// rollupOptions.input. This is the standard Vite multi-root pattern
// for exactly this situation.
export default defineConfig({
  plugins: [react()],
  base: './',
  root: 'src/mobile',
  // envDir defaults to whatever `root` is set to, NOT the project root,
  // when they differ (confirmed against Vite's own docs and a matching
  // reported issue - vitejs/vite#7557). Without this, Vite was looking
  // for .env.local inside src/mobile/ instead of the actual project
  // root, so Supabase env vars silently never loaded for this build -
  // this line is the fix.
  envDir: '../../',
  build: {
    outDir: '../../dist/mobile',
    emptyOutDir: true
  },
  define: {
    'process.env.SUPABASE_URL': JSON.stringify(process.env.SUPABASE_URL || ''),
    'process.env.SUPABASE_ANON_KEY': JSON.stringify(process.env.SUPABASE_ANON_KEY || '')
  }
})
