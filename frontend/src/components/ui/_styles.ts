// Shared control styling so every text-like control (Input, Select, SearchInput,
// DatePicker) has one identical height, radius, and focus ring (FRONTEND_STANDARDS
// §3.2/§3.9). Not exported from the barrel — internal to the ui library.

export const controlBase =
  'block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm transition placeholder:text-gray-400 focus-visible:border-brand focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500';

/** Error state, driven by `aria-invalid` so a control lights up red without extra props. */
export const controlInvalid =
  'aria-[invalid=true]:border-danger-500 aria-[invalid=true]:focus-visible:border-danger-500 aria-[invalid=true]:focus-visible:ring-danger-500/30';
