import {
  MIN_PEERS_FOR_DISCLOSURE,
  mean,
  median,
  summarisePeers,
  type PeerValue,
} from './peer-statistics';

/** A peer group of `n` operators with the given figures; the reader is always `e0`. */
function group(values: number[]): PeerValue[] {
  return values.map((value, i) => ({ entityId: `e${i}`, entityName: `Operator ${i}`, value }));
}

describe('median', () => {
  it('takes the middle of an odd-length list', () => {
    expect(median([5, 1, 3])).toBe(3);
  });

  it('averages the middle pair of an even-length list', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('has nothing to say about an empty list', () => {
    expect(median([])).toBeNull();
    expect(mean([])).toBeNull();
  });
});

describe('summarisePeers', () => {
  it('places the reader among its peers', () => {
    const s = summarisePeers(group([100, 400, 300, 200, 50]), 'e0');
    expect(s.groupSize).toBe(5);
    expect(s.value).toBe(100);
    // 400, 300 and 200 are all above 100.
    expect(s.rank).toBe(4);
    expect(s.median).toBe(250); // peers are 400, 300, 200, 50
    expect(s.withheld).toBe(false);
  });

  it('gives the top operator rank 1', () => {
    const s = summarisePeers(group([900, 100, 200, 300, 400]), 'e0');
    expect(s.rank).toBe(1);
  });

  it('lets operators on the same figure share the better rank', () => {
    const s = summarisePeers(group([200, 200, 100, 50, 25]), 'e0');
    expect(s.rank).toBe(1);
    const tied = summarisePeers(group([200, 200, 100, 50, 25]), 'e1');
    expect(tied.rank).toBe(1);
  });

  it('reports a share of the group total', () => {
    const s = summarisePeers(group([250, 250, 250, 250]), 'e0');
    expect(s.shareOfTotal).toBeCloseTo(0.25);
  });

  it('does not divide by zero when nobody reported anything', () => {
    const s = summarisePeers(group([0, 0, 0, 0]), 'e0');
    expect(s.shareOfTotal).toBeNull();
  });

  it('withholds every peer aggregate when the group is too small', () => {
    // Two peers: a median would be arithmetic away from a competitor's exact figure.
    const s = summarisePeers(group([100, 900, 500]), 'e0');
    expect(s.withheld).toBe(true);
    expect(s.median).toBeNull();
    expect(s.mean).toBeNull();
    // The reader still gets its own standing, which is what it is entitled to.
    expect(s.value).toBe(100);
    expect(s.rank).toBe(3);
    expect(s.shareOfTotal).toBeCloseTo(100 / 1500);
  });

  it('starts disclosing at exactly the minimum peer count', () => {
    const s = summarisePeers(group(Array(MIN_PEERS_FOR_DISCLOSURE + 1).fill(100)), 'e0');
    expect(s.withheld).toBe(false);
    expect(s.median).toBe(100);
  });

  it('never returns a minimum or maximum, which would name the market leader', () => {
    const s = summarisePeers(group([100, 5000, 300, 200, 250]), 'e0');
    expect(Object.keys(s)).not.toContain('max');
    expect(Object.keys(s)).not.toContain('min');
    // The 5000 is visible in neither the median nor the mean as a recoverable figure.
    expect(s.median).toBe(275); // peers 5000, 300, 200, 250 → (250 + 300) / 2
  });

  it('handles a reader who filed nothing', () => {
    const s = summarisePeers(group([100, 200, 300, 400]), 'missing');
    expect(s.value).toBeNull();
    expect(s.rank).toBeNull();
    expect(s.shareOfTotal).toBeNull();
    // Nobody was excluded as the reader, so all four count as peers.
    expect(s.median).toBe(250);
  });

  it('withholds when the reader is alone', () => {
    const s = summarisePeers(group([100]), 'e0');
    expect(s.withheld).toBe(true);
    expect(s.groupSize).toBe(1);
    expect(s.rank).toBe(1);
  });
});
