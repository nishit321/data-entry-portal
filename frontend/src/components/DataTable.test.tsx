import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataTable, type Column } from './DataTable';

interface Row {
  id: string;
  name: string;
}

const rows: Row[] = [
  { id: '1', name: 'First' },
  { id: '2', name: 'Second' },
];

/**
 * Row click and row actions are the pair that keeps breaking each other, so they get a test.
 *
 * The failure mode is not obvious from reading the code: a clickable row carries `role="button"`
 * for the keyboard, and a guard written as `closest('[role="button"]')` therefore matches the row
 * itself and silently swallows every row click. It looks correct and does the opposite of what it
 * says. Both directions are asserted here so neither can regress into the other again.
 */
describe('DataTable row activation', () => {
  const plainColumns: Column<Row>[] = [{ header: 'Name', cell: (r) => r.name }];

  it('opens the record when the row itself is clicked', async () => {
    const onRowClick = vi.fn();
    render(
      <DataTable columns={plainColumns} rows={rows} rowKey={(r) => r.id} onRowClick={onRowClick} />,
    );

    await userEvent.click(screen.getByText('First'));

    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick).toHaveBeenCalledWith(rows[0]);
  });

  it('does not open the record when a row action is pressed', async () => {
    const onRowClick = vi.fn();
    const onAction = vi.fn();
    const columns: Column<Row>[] = [
      ...plainColumns,
      {
        header: 'Actions',
        cell: (r) => (
          <button type="button" onClick={() => onAction(r.id)}>
            Deactivate
          </button>
        ),
      },
    ];

    render(
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} onRowClick={onRowClick} />,
    );

    await userEvent.click(screen.getAllByRole('button', { name: 'Deactivate' })[0]!);

    expect(onAction).toHaveBeenCalledWith('1');
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('opens the record on Enter when the row has focus', async () => {
    const onRowClick = vi.fn();
    render(
      <DataTable columns={plainColumns} rows={rows} rowKey={(r) => r.id} onRowClick={onRowClick} />,
    );

    const row = screen.getAllByRole('button')[0]!;
    row.focus();
    await userEvent.keyboard('{Enter}');

    expect(onRowClick).toHaveBeenCalledWith(rows[0]);
  });

  it('leaves rows inert when no row handler is supplied', async () => {
    render(<DataTable columns={plainColumns} rows={rows} rowKey={(r) => r.id} />);

    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});

/**
 * The truncation tooltip, and specifically the case where it must stay away.
 *
 * The tempting implementation offers a tooltip on every cell, which repeats text the reader can
 * already see and turns the whole table into hover noise. The "not clipped" test below is the one
 * that keeps that from creeping back in; the "clipped" test only proves the feature exists.
 *
 * jsdom reports every width as 0, so the layout has to be stubbed. That is honest here: the
 * component's contract is "compare scrollWidth against clientWidth", and that is exactly what is
 * being exercised.
 */
describe('DataTable truncation tooltip', () => {
  const columns: Column<Row>[] = [{ header: 'Name', cell: (r) => <span>{r.name}</span> }];

  function stubLayout({ clipped }: { clipped: boolean }) {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(100);
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(clipped ? 240 : 100);
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('offers the full text when the cell is clipped', async () => {
    stubLayout({ clipped: true });
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} />);

    await userEvent.hover(screen.getByText('First'));

    expect(await screen.findByRole('tooltip')).toHaveTextContent('First');
  });

  it('stays silent when the text already fits', async () => {
    stubLayout({ clipped: false });
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} />);

    await userEvent.hover(screen.getByText('First'));

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('leaves a cell alone when its content carries its own tooltip', async () => {
    stubLayout({ clipped: true });
    const withTime: Column<Row>[] = [
      { header: 'When', cell: () => <time dateTime="2026-08-19">2 hours ago</time> },
    ];
    render(<DataTable columns={withTime} rows={rows} rowKey={(r) => r.id} />);

    await userEvent.hover(screen.getAllByText('2 hours ago')[0]!);

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('honours a column that opts out', async () => {
    stubLayout({ clipped: true });
    const optedOut: Column<Row>[] = [
      { header: 'Name', noTooltip: true, cell: (r) => <span>{r.name}</span> },
    ];
    render(<DataTable columns={optedOut} rows={rows} rowKey={(r) => r.id} />);

    await userEvent.hover(screen.getByText('First'));

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});
