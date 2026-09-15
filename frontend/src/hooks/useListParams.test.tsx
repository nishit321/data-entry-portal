import { act, renderHook } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigationType } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { DEFAULT_PAGE_SIZE, useListParams, type ListParams } from './useListParams';

/**
 * The URL is the state of every list screen.
 *
 * That is the whole design: paste a link to a filtered, sorted, paged view and the person who
 * opens it sees what you saw. It also means the back button has to behave — which is a promise
 * about *how* each change is written, not just what ends up in the query string, and the two are
 * easy to get subtly wrong in ways no screen test would notice.
 *
 * These run the hook against a real router rather than a stubbed one, because the parts worth
 * checking are exactly the parts `useSearchParams` owns: what lands in the URL, and whether it
 * replaced the entry or pushed a new one.
 */

type Filters = { status: string; type: string };

const CONFIG = {
  defaultSort: 'createdAt',
  filters: { status: '', type: '' } as Filters,
  preferenceKey: 'test-list',
};

/** Renders the hook inside a router, and reports the URL the way a browser would show it. */
function setup(initial = '/things') {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>
  );
  return renderHook(
    () => ({
      params: useListParams<Filters>(CONFIG),
      location: useLocation(),
      navigation: useNavigationType(),
    }),
    { wrapper },
  );
}

const query = (search: string) => Object.fromEntries(new URLSearchParams(search));

describe('useListParams', () => {
  beforeEach(() => {
    // The page size is a remembered preference, so one test's choice would otherwise be the next
    // test's default.
    try {
      window.localStorage.clear();
    } catch {
      /* a browser with site data blocked still has to work */
    }
  });

  describe('reading the URL', () => {
    it('starts at the defaults when the URL says nothing', () => {
      const { result } = setup();
      expect(result.current.params.page).toBe(1);
      expect(result.current.params.pageSize).toBe(DEFAULT_PAGE_SIZE);
      expect(result.current.params.sort).toBe('createdAt');
      expect(result.current.params.order).toBe('desc');
      expect(result.current.params.search).toBe('');
      expect(result.current.params.filters).toEqual({ status: '', type: '' });
      expect(result.current.params.hasActiveFilters).toBe(false);
    });

    it('reads a shared link back exactly as it was sent', () => {
      const { result } = setup(
        '/things?page=3&pageSize=50&sort=name&order=asc&search=juba&status=OPEN',
      );
      expect(result.current.params.page).toBe(3);
      expect(result.current.params.pageSize).toBe(50);
      expect(result.current.params.sort).toBe('name');
      expect(result.current.params.order).toBe('asc');
      expect(result.current.params.search).toBe('juba');
      expect(result.current.params.filters.status).toBe('OPEN');
    });

    it('ignores a page size nobody offered', () => {
      // Query strings get edited by hand and mangled by chat clients. An unsupported size must not
      // reach the API as a page of ten thousand rows.
      const { result } = setup('/things?pageSize=10000');
      expect(result.current.params.pageSize).toBe(DEFAULT_PAGE_SIZE);
    });

    it.each(['0', '-2', 'abc', ''])('refuses "%s" as a page number', (raw) => {
      const { result } = setup(`/things?page=${raw}`);
      expect(result.current.params.page).toBe(1);
    });

    it('keeps a filter key it was never told about out of the way', () => {
      // Only declared filters are read. An unknown parameter in the URL is somebody else's
      // business — a tracking tag, an old link — and must not turn into a filter sent to the API.
      const { result } = setup('/things?utm_source=email&status=OPEN');
      expect(result.current.params.filters).toEqual({ status: 'OPEN', type: '' });
    });
  });

  describe('writing the URL', () => {
    it('carries only what the user actually chose', () => {
      // Page 1 and the default sort are implied. Putting them in every link makes a URL that is
      // long, and that looks different from the identical view somebody else arrived at.
      const { result } = setup();
      act(() => result.current.params.setSort('createdAt', 'desc'));
      expect(result.current.location.search).toBe('');

      act(() => result.current.params.setSort('name', 'asc'));
      expect(query(result.current.location.search)).toEqual({ sort: 'name', order: 'asc' });
    });

    // Page 4 of the old results is not page 4 of the new ones, and is often not there at all.
    it.each([
      ['a search', (p: ListParams<Filters>) => p.setSearch('juba')],
      ['a filter', (p: ListParams<Filters>) => p.setFilters({ status: 'OPEN' })],
      ['a sort', (p: ListParams<Filters>) => p.setSort('name', 'asc')],
    ])('returns to the first page when %s changes the result set underneath', (_name, change) => {
      const { result } = setup('/things?page=4');
      act(() => change(result.current.params));
      expect(result.current.params.page).toBe(1);
      expect(query(result.current.location.search).page).toBeUndefined();
    });

    it('drops a filter cleared back to nothing, rather than sending an empty one', () => {
      const { result } = setup('/things?status=OPEN&type=MNO');
      act(() => result.current.params.clearFilter('status'));
      expect(query(result.current.location.search)).toEqual({ type: 'MNO' });
    });

    it('clears the search along with the filters', () => {
      // "Clear all" on a list that is still text-searched would look broken, and the empty-state
      // copy tells the user there are no matches without saying what for.
      const { result } = setup('/things?search=juba&status=OPEN&type=MNO&page=2');
      act(() => result.current.params.clearAll());
      expect(result.current.location.search).toBe('');
      expect(result.current.params.hasActiveFilters).toBe(false);
    });

    it('leaves the sort alone when everything else is cleared', () => {
      // Sorting is not a narrowing. Somebody who sorted by name and then cleared their filters
      // still wants the list by name.
      const { result } = setup('/things?sort=name&order=asc&search=juba');
      act(() => result.current.params.clearAll());
      expect(query(result.current.location.search)).toEqual({ sort: 'name', order: 'asc' });
    });
  });

  describe('the back button', () => {
    it('adds a history entry for paging, and none for anything else', () => {
      /*
       * The distinction the hook exists to get right. Paging is a step a person expects to walk
       * back through. Typing in a search box is not — writing an entry per keystroke means the
       * back button replays the word letter by letter instead of returning to the previous screen.
       */
      const { result } = setup();

      // `useNavigationType` reports how the last navigation was made, which is the promise itself.
      // Counting `window.history` would measure nothing here: a memory router keeps its own stack.
      act(() => result.current.params.setSearch('j'));
      expect(result.current.navigation).toBe('REPLACE');
      act(() => result.current.params.setSearch('ju'));
      expect(result.current.navigation).toBe('REPLACE');

      act(() => result.current.params.setFilters({ status: 'OPEN' }));
      expect(result.current.navigation).toBe('REPLACE');
      act(() => result.current.params.setSort('name', 'asc'));
      expect(result.current.navigation).toBe('REPLACE');

      act(() => result.current.params.setPage(2));
      expect(result.current.navigation).toBe('PUSH');
    });
  });

  describe('the chips a user removes one at a time', () => {
    it('lists the search and every narrowing filter', () => {
      const { result } = setup('/things?search=juba&status=OPEN');
      expect(result.current.params.activeFilters).toEqual([
        { key: 'search', value: 'juba' },
        { key: 'status', value: 'OPEN' },
      ]);
      expect(result.current.params.hasActiveFilters).toBe(true);
    });

    it('says nothing is active when a filter is set to its own default', () => {
      // `?status=` is not a narrowing, and a chip reading "status:" would be nonsense to remove.
      const { result } = setup('/things?status=');
      expect(result.current.params.activeFilters).toEqual([]);
      expect(result.current.params.hasActiveFilters).toBe(false);
    });
  });
});
