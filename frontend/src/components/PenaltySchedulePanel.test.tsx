import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from './ui';
import { PenaltySchedulePanel } from './PenaltySchedulePanel';

/*
 * One line of the schedule, so the per-line remove button has somewhere to appear.
 */
vi.mock('../lib/penalty.api', async (original) => {
  const actual = await original<typeof import('../lib/penalty.api')>();
  return {
    ...actual,
    penaltyApi: {
      ...actual.penaltyApi,
      list: () =>
        Promise.resolve([
          {
            id: 'r1',
            label: 'Late filing',
            reason: 'MISSED_DEADLINE',
            entityType: null,
            amountPerDay: '1000',
            effectiveFrom: '2026-01-01',
            effectiveTo: null,
          },
        ]),
    },
  };
});

function renderPanel(props: { canManage: boolean; canEditSchedule: boolean }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <PenaltySchedulePanel {...props} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

/**
 * Who may change the penalty schedule, as the screen shows it.
 *
 * The server holds two permissions apart: a supervisor working the cases may bring open cases up
 * to date, but the schedule itself is NCA Legal and Licensing's, entered by an administrator. The
 * screen used one flag for both, so a supervisor was shown "Add a line" and a remove button on
 * every line, and every click on either was refused by the server.
 */
describe('the penalty schedule panel', () => {
  it('lets a supervisor update open cases, and not edit the schedule', async () => {
    renderPanel({ canManage: true, canEditSchedule: false });
    expect(await screen.findByText('Late filing')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Update open cases/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add a line/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove the/ })).not.toBeInTheDocument();
  });

  it('gives an administrator both', async () => {
    renderPanel({ canManage: true, canEditSchedule: true });
    expect(await screen.findByText('Late filing')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Update open cases/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add a line/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Remove the Late filing line/ })).toBeInTheDocument();
  });

  it('shows everybody else the schedule and nothing to press', async () => {
    renderPanel({ canManage: false, canEditSchedule: false });
    expect(await screen.findByText('Late filing')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Update open cases|Add a line|Remove the/ })).toBe(
      null,
    );
  });
});
