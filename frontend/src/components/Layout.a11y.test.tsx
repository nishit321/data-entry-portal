import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { axe } from 'vitest-axe';
import { Layout } from './Layout';

/**
 * The shell, checked as a page rather than as parts (FRONTEND_STANDARDS §6).
 *
 * Two things can only be judged here. **Landmarks:** every screen renders inside this, so if the
 * content region is not a landmark then no screen in the product has one, and a screen-reader user
 * has no way to skip past the navigation. **The skip link:** the sidebar carries around twenty
 * nav items, and without a way past them a keyboard user pays for all twenty on every single page
 * before reaching the thing they came for.
 *
 * So `region` — which asks that all content sit inside a landmark — is switched on here. It is
 * switched off in the component tests, where a single primitive is rendered with no page around
 * it and the rule would only ever be reporting on the test.
 */

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: {
      id: 'u1',
      email: 'a.deng@example.org',
      firstName: 'Achol',
      lastName: 'Deng',
      role: 'NCA_ADMIN',
      isActive: true,
    },
    isLoading: false,
    logout: () => undefined,
    setSession: () => undefined,
  }),
}));

vi.mock('./layout/useNavCounts', () => ({
  useNavCounts: () => ({}),
}));

vi.mock('./layout/NotificationBell', () => ({
  NotificationBell: () => <button type="button">Notifications</button>,
}));

function renderShell() {
  return render(
    <MemoryRouter initialEntries={['/submissions']}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/submissions" element={<h2>Returns</h2>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('the authenticated shell', () => {
  it('puts the page inside a main landmark', () => {
    renderShell();
    // By role, not by text: the top bar names the current page too, so the words appear twice.
    expect(screen.getByRole('main')).toContainElement(
      screen.getByRole('heading', { level: 2, name: 'Returns' }),
    );
  });

  it('offers a way past the navigation, as the first thing a keyboard reaches', () => {
    const { container } = renderShell();

    const skip = screen.getByRole('link', { name: /skip to content/i });
    expect(skip).toHaveAttribute('href', '#main-content');
    expect(document.getElementById('main-content')).toBe(screen.getByRole('main'));

    // First in the document order, so the very first Tab lands on it.
    const focusable = container.querySelectorAll('a[href], button, input, [tabindex="0"]');
    expect(focusable[0]).toBe(skip);
  });

  it('has no violations, landmarks included', async () => {
    renderShell();
    const results = await axe(document.body, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(results.violations ?? []).toEqual([]);
  });
});
