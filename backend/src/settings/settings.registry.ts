/**
 * Every switch the Authority can change for itself, and what each one is allowed to be.
 *
 * A registry rather than a free-for-all table. The row in the database is only a value; what the
 * key means, what type it is and what it falls back to lives here, in code that is reviewed. A
 * typo in a request therefore cannot quietly create a setting that nothing reads and nobody
 * notices is doing nothing.
 *
 * There is no seeding step and no migration per setting. A row appears the first time somebody
 * changes something; until then the default below is the answer.
 */

interface Common {
  readonly label: string;
  readonly description: string;
  /**
   * Readable without signing in.
   *
   * Only ever for a switch the sign-in screen itself has to obey. Everything else is behind the
   * administrator's door, because a list of what a system has turned off is a map for somebody
   * looking for a way in.
   */
  readonly isPublic: boolean;
}

export type SettingDefinition =
  | (Common & { readonly type: 'boolean'; readonly default: boolean })
  | (Common & {
      readonly type: 'number';
      readonly default: number;
      readonly min: number;
      readonly max: number;
      readonly unit: string;
    });

export const SETTINGS = {
  'signup.enabled': {
    type: 'boolean',
    // Off. A regulator issues accounts to the operators it has licensed; it does not take
    // applications from whoever finds the address. This was open, and the sign-in screen invited
    // people to use it.
    default: false,
    label: 'Let people create their own account',
    description:
      'When this is off, the sign-in screen stops offering to create an account and the portal ' +
      'refuses any attempt to. Accounts are then made by an administrator on the Users screen.',
    isPublic: true,
  },
  'public.complaintsByOperator': {
    type: 'boolean',
    // Off. The public pages have been sector totals only, on the Authority's own instruction, and
    // naming operators beside their complaint figures cannot be taken back once it is public.
    // That makes it the Authority's decision to take deliberately, and an audited one.
    default: false,
    label: 'Publish complaint figures for each operator',
    description:
      'When this is on, the public open-data page shows, for each operator with at least ten ' +
      'complaints in the last twelve months, how many it received, how many reached an end and how ' +
      'quickly. Operators with fewer are counted together and not named. When it is off, the ' +
      'public page shows sector totals only, as it always has.',
    isPublic: false,
  },
  'session.idleMinutes': {
    type: 'number',
    default: 20,
    min: 5,
    max: 120,
    unit: 'minutes',
    label: 'Sign people out after this long without activity',
    description:
      'Counted from the last thing the person did, not from when they signed in, so nobody is ' +
      'interrupted in the middle of filling in a return. Unsaved work is kept: returns save ' +
      'themselves as they are typed, and signing back in returns to the same page.',
    isPublic: true,
  },
} as const satisfies Record<string, SettingDefinition>;

export type SettingKey = keyof typeof SETTINGS;
export type BooleanSettingKey = {
  [K in SettingKey]: (typeof SETTINGS)[K]['type'] extends 'boolean' ? K : never;
}[SettingKey];
export type NumberSettingKey = {
  [K in SettingKey]: (typeof SETTINGS)[K]['type'] extends 'number' ? K : never;
}[SettingKey];

export function isSettingKey(key: string): key is SettingKey {
  return Object.prototype.hasOwnProperty.call(SETTINGS, key);
}

/** The value a stored row holds, read back as the type the registry promised. */
export function parseSetting(key: SettingKey, raw: string): boolean | number {
  const definition = SETTINGS[key];
  if (definition.type === 'boolean') return raw === 'true';
  const parsed = Number(raw);
  // A row that cannot be read is treated as absent rather than as zero. Zero would mean "sign
  // everybody out immediately", which is not what a corrupt row should be allowed to say.
  if (!Number.isFinite(parsed)) return definition.default;
  return Math.min(definition.max, Math.max(definition.min, parsed));
}
