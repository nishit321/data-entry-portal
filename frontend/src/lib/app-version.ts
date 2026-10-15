/**
 * The build the user is looking at, named once.
 *
 * The sidebar and the footer both show it, and before this they disagreed: the sidebar read it
 * from the environment while the footer had "v0.1 (demo)" written into it. That footer would have
 * gone on calling the Authority's live server a demo for as long as nobody happened to look at
 * the bottom of the page.
 *
 * The fallback is deliberately plain. A build that forgets to set the variable should look
 * unremarkable, not make a claim about what it is.
 */
export const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? 'v0.1';
