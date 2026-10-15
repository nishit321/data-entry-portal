import { useQuery } from '@tanstack/react-query';
import { settingsApi, settingsKeys, type PublicSettings } from '../lib/settings.api';

/**
 * The settings the sign-in screen and the session timer need, read once per visit.
 *
 * Deliberately long-lived in the cache: these change when an administrator changes them, which is
 * rarely, and a sign-in screen that refetches its configuration on every focus would be asking a
 * question nobody is answering differently.
 *
 * While it is loading there is no answer yet, and callers are expected to say so rather than
 * guess. Guessing "signing up is allowed" would show a link that then refuses; guessing the other
 * way would hide a link the Authority had deliberately switched on.
 */
export function usePublicSettings() {
  const query = useQuery({
    queryKey: settingsKeys.public,
    queryFn: settingsApi.publicValues,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const settings: PublicSettings | undefined = query.data;
  return {
    isLoading: query.isLoading,
    /** Undefined until the answer arrives, so a caller can tell "off" from "not known yet". */
    signupEnabled: settings?.['signup.enabled'] as boolean | undefined,
    idleMinutes: settings?.['session.idleMinutes'] as number | undefined,
  };
}
