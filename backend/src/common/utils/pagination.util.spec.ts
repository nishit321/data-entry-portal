import { paginate, toSkipTake } from './pagination.util';

describe('pagination.util', () => {
  describe('toSkipTake', () => {
    it('maps page/pageSize to skip/take', () => {
      expect(toSkipTake({ page: 1, pageSize: 20 })).toEqual({ skip: 0, take: 20 });
      expect(toSkipTake({ page: 3, pageSize: 20 })).toEqual({ skip: 40, take: 20 });
    });
  });

  describe('paginate', () => {
    it('builds an accurate meta envelope for a middle page', () => {
      const { data, meta } = paginate(['a', 'b'], 137, { page: 3, pageSize: 20 });
      expect(data).toEqual(['a', 'b']);
      expect(meta).toEqual({
        page: 3,
        pageSize: 20,
        total: 137,
        totalPages: 7,
        hasNext: true,
        hasPrev: true,
      });
    });

    it('flags the last page as having no next', () => {
      const { meta } = paginate([], 40, { page: 2, pageSize: 20 });
      expect(meta.totalPages).toBe(2);
      expect(meta.hasNext).toBe(false);
      expect(meta.hasPrev).toBe(true);
    });

    it('handles an empty result set', () => {
      const { meta } = paginate([], 0, { page: 1, pageSize: 20 });
      expect(meta.totalPages).toBe(0);
      expect(meta.hasNext).toBe(false);
      expect(meta.hasPrev).toBe(false);
    });
  });
});
