/**
 * Peer statistics and the disclosure control around them (Phase 2, benchmarking).
 *
 * An operator is entitled to know where it stands. It is not entitled to know what a named
 * competitor reported — Q4 is explicit that operator-level figures (revenue, subscriber counts,
 * float balances) are commercially sensitive. Those two facts pull in opposite directions, and the
 * rules below are where the line is drawn:
 *
 * - The **Authority** sees everything, named. Nothing here applies to it.
 * - An **operator** sees its own figure, its rank, its share of the group, and the peer **median
 *   and mean**. It never sees a minimum, a maximum, or a per-entity row.
 * - Below a minimum peer count the comparison is **withheld entirely**, because with one or two
 *   others any aggregate is arithmetic away from a competitor's exact figure.
 *
 * Minimum and maximum are excluded deliberately, not by oversight: the largest operator in a
 * sector is usually public knowledge, so "the highest peer reported 1.2m" names a company. A
 * median over four or more does not.
 */

/**
 * How many *other* operators the peer group needs before any aggregate is shown to an operator.
 *
 * Three is the conventional threshold rule from statistical disclosure control: no published
 * aggregate may rest on fewer than three contributors. With one peer, every aggregate is that
 * peer's exact figure; with two, simple arithmetic recovers it. At three, a median is still one
 * operator's number, but which of the three it belongs to is not recoverable, and that is the
 * standard the rule is built on.
 *
 * It is a constant rather than configuration on purpose: a threshold that can be turned down in a
 * hurry is not a control. Raise it here if NCA's disclosure policy turns out to be stricter.
 */
export const MIN_PEERS_FOR_DISCLOSURE = 3;

/** One operator's figure for the metric being compared. */
export interface PeerValue {
  entityId: string;
  entityName: string;
  value: number;
}

/** What an operator is shown: its own standing, and the shape of the group around it. */
export interface PeerSummary {
  /** How many operators are in the comparison, including the reader. */
  groupSize: number;
  /** The reader's own figure, when it filed one. */
  value: number | null;
  /** 1 is the highest figure. Null when the reader has nothing to rank. */
  rank: number | null;
  /** The reader's figure as a share of the group total (0-1). Null when the total is zero. */
  shareOfTotal: number | null;
  median: number | null;
  mean: number | null;
  /**
   * Set when the peer group is too small to say anything without pointing at a competitor. The
   * reader still gets its own figure; every peer aggregate is null.
   */
  withheld: boolean;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Where one operator sits among its peers, with the disclosure rules above applied.
 *
 * `all` is the whole peer group including the reader; `entityId` is the reader. Ranking is highest
 * first, and ties share the better rank — two operators on the same figure are both second, and
 * neither is told it is behind the other on a number they both reported identically.
 */
export function summarisePeers(all: PeerValue[], entityId: string): PeerSummary {
  const own = all.find((v) => v.entityId === entityId) ?? null;
  const peers = all.filter((v) => v.entityId !== entityId);
  const total = all.reduce((sum, v) => sum + v.value, 0);

  const withheld = peers.length < MIN_PEERS_FOR_DISCLOSURE;
  const rank = own === null ? null : all.filter((v) => v.value > own.value).length + 1;

  return {
    groupSize: all.length,
    value: own?.value ?? null,
    rank,
    // A share is a ratio against a total of four or more, so it points at no one in particular.
    shareOfTotal: own !== null && total !== 0 ? own.value / total : null,
    median: withheld ? null : median(peers.map((v) => v.value)),
    mean: withheld ? null : mean(peers.map((v) => v.value)),
    withheld,
  };
}
