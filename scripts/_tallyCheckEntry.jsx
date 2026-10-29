/* Bundle entry for `scripts/tally-check-preview.mjs` — the only thing in the
   repo that executes the TallyCheck panel, because `Sales.jsx` drags the
   supabase client in and cannot be server-rendered.

   ONLY THE COMPONENT. `parseDayTally` pulls in `xlsx`, which does a dynamic
   require of `stream` that esbuild cannot bundle into ESM — and it needs no
   bundling anyway, since the preview imports it straight from source. */
export { default as TallyCheck } from '../src/components/TallyCheck.jsx'
