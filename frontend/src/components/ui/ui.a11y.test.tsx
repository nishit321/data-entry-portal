import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { expectNoViolations, renderAndCheck } from '../../test/a11y';
import {
  Alert,
  Badge,
  Breadcrumb,
  Button,
  Checkbox,
  Combobox,
  ConfirmDialog,
  DatePicker,
  DescriptionList,
  Drawer,
  Dropdown,
  EmptyState,
  Field,
  FormField,
  Input,
  Modal,
  Pagination,
  PasswordInput,
  Progress,
  RadioGroup,
  ReorderList,
  SearchInput,
  Select,
  Skeleton,
  Spinner,
  StatCard,
  Tabs,
  Textarea,
  Timeline,
  Tooltip,
} from './index';

/**
 * Every design-system primitive, rendered and put through axe (FRONTEND_STANDARDS §6).
 *
 * The library is where accessibility is either won or lost: every screen composes from here, so a
 * label that goes missing in `Field` goes missing on thirty-five pages at once. Each primitive is
 * rendered in the state most likely to be wrong — open, invalid, disabled, empty — rather than
 * only its happy one.
 */

const noop = () => undefined;

function withProviders(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

const OPTIONS = [
  { value: 'a', label: 'Juba' },
  { value: 'b', label: 'Wau' },
  { value: 'c', label: 'Malakal', disabled: true },
];

describe('actions', () => {
  it('button, in every variant and state', async () => {
    await renderAndCheck(
      <div>
        <Button>Save</Button>
        <Button variant="secondary">Cancel</Button>
        <Button variant="danger">Delete</Button>
        <Button disabled>Unavailable</Button>
        <Button isLoading>Saving</Button>
      </div>,
    );
  });

  it('dropdown menu, open', async () => {
    const { container } = await renderAndCheck(
      <Dropdown
        label="Row actions"
        items={[
          { label: 'Edit', onClick: noop },
          { label: 'Delete', onClick: noop, danger: true, separatorBefore: true },
          { label: 'Archive', onClick: noop, disabled: true },
        ]}
      />,
    );
    fireEvent.click(container.querySelector('button') as HTMLElement);
    // Assert the menu is really open. Without this the axe run below would happily pass over a
    // document where the panel never mounted, which proves nothing at all.
    await screen.findByRole('menu');
    await expectNoViolations();
  });
});

describe('form controls', () => {
  it('field wrapper, with a label, hint and error', async () => {
    await renderAndCheck(
      <div>
        <Field label="Licence number" htmlFor="lic" hint="As printed on the licence" required>
          <Input id="lic" />
        </Field>
        <Field label="Operator" htmlFor="op" error="Choose an operator">
          <Input id="op" aria-invalid />
        </Field>
      </div>,
    );
  });

  it('form field wrapper, with an error', async () => {
    await renderAndCheck(
      <FormField label="Contact email" htmlFor="em" error="That address is not valid" required>
        <Input id="em" aria-invalid />
      </FormField>,
    );
  });

  it('text inputs', async () => {
    await renderAndCheck(
      <div>
        <Field label="Name" htmlFor="n">
          <Input id="n" />
        </Field>
        <Field label="Notes" htmlFor="t">
          <Textarea id="t" />
        </Field>
        <Field label="Password" htmlFor="p">
          <PasswordInput id="p" />
        </Field>
        <SearchInput value="" onChange={noop} />
      </div>,
    );
  });

  it('checkbox and radio group', async () => {
    await renderAndCheck(
      <div>
        <Checkbox checked onChange={noop} label="Send me the reminder" hint="Two days before" />
        <Checkbox checked={false} onChange={noop} label="Disabled" disabled />
        <RadioGroup
          value="a"
          onChange={noop}
          name="site"
          aria-label="Site type"
          options={[
            { value: 'a', label: 'Tower' },
            { value: 'b', label: 'Rooftop', hint: 'Shared mast' },
          ]}
        />
      </div>,
    );
  });

  it('select, closed and open', async () => {
    const { container } = await renderAndCheck(
      <Select value="a" onChange={noop} options={OPTIONS} aria-label="State" searchable />,
    );
    fireEvent.click(container.querySelector('button') as HTMLElement);
    await screen.findByRole('listbox');
    await expectNoViolations();
  });

  it('select, with no matching options', async () => {
    const { container } = await renderAndCheck(
      <Select value="" onChange={noop} options={[]} aria-label="State" />,
    );
    fireEvent.click(container.querySelector('button') as HTMLElement);
    await screen.findByRole('listbox');
    await expectNoViolations();
  });

  it('combobox, closed and open', async () => {
    const source = {
      queryKey: 'test',
      fetch: vi.fn(async () => ({ options: OPTIONS, hasNext: false })),
    };
    const { container } = await renderAndCheck(
      withProviders(<Combobox value="a" onChange={noop} source={source} aria-label="Operator" />),
    );
    fireEvent.click(container.querySelector('button') as HTMLElement);
    await screen.findByRole('listbox');
    await expectNoViolations();
  });

  it('lets the keyboard clear a combobox', async () => {
    const source = {
      queryKey: 'test',
      fetch: vi.fn(async () => ({ options: OPTIONS, hasNext: false })),
    };
    const cleared = vi.fn();
    render(
      withProviders(
        <Combobox value="a" onChange={cleared} source={source} aria-label="Operator" />,
      ),
    );

    // A real button, in the tab order, that does the thing. It used to be a span with
    // tabIndex={-1} nested inside the trigger button, so no keyboard could reach it at all.
    const clear = await screen.findByRole('button', { name: 'Clear Operator' });
    expect(clear).not.toHaveAttribute('tabindex');
    expect(clear.closest('button')).toBe(clear);

    fireEvent.click(clear);
    expect(cleared).toHaveBeenCalledWith('', null);
    // And focus comes back to the trigger rather than being dropped on the body, which is where a
    // keyboard user would otherwise have to start again from.
    expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'Operator' }));
  });

  it('date picker, closed and open', async () => {
    const { container } = await renderAndCheck(
      <DatePicker value="2026-03-15" onChange={noop} aria-label="Licence issued" />,
    );
    fireEvent.click(container.querySelector('button') as HTMLElement);
    await screen.findByRole('grid');
    await expectNoViolations();
  });

  it('date picker, invalid', async () => {
    await renderAndCheck(
      <Field label="Licence issued" htmlFor="li" error="Pick a date">
        <DatePicker id="li" value="" onChange={noop} invalid aria-label="Licence issued" />
      </Field>,
    );
  });
});

describe('overlays', () => {
  it('modal', async () => {
    await renderAndCheck(
      <Modal open title="Add an operator" onClose={noop} footer={<Button>Save</Button>}>
        <p>Body</p>
      </Modal>,
    );
  });

  it('drawer', async () => {
    await renderAndCheck(
      <Drawer open title="Return details" description="Q1 2026" onClose={noop}>
        <p>Body</p>
      </Drawer>,
    );
  });

  it('confirm dialog', async () => {
    await renderAndCheck(
      <ConfirmDialog
        open
        title="Delete this agent?"
        message="This cannot be undone."
        onConfirm={noop}
        onClose={noop}
      />,
    );
  });

  it('tooltip, shown on focus', async () => {
    const { container } = await renderAndCheck(
      <Tooltip content="Sites this operator runs">
        <button type="button">Sites</button>
      </Tooltip>,
    );
    fireEvent.focus(container.querySelector('button') as HTMLElement);
    await screen.findByText('Sites this operator runs');
    await expectNoViolations();
  });
});

describe('navigation and lists', () => {
  it('tabs', async () => {
    await renderAndCheck(
      <Tabs
        aria-label="Return sections"
        value="a"
        onChange={noop}
        tabs={[
          { id: 'a', label: 'Coverage', count: 12 },
          { id: 'b', label: 'Revenue' },
        ]}
      />,
    );
  });

  it('pagination', async () => {
    await renderAndCheck(
      <Pagination
        meta={{ page: 2, pageSize: 25, total: 120, totalPages: 5, hasNext: true, hasPrev: true }}
        onPageChange={noop}
        onPageSizeChange={noop}
      />,
    );
  });

  it('breadcrumb', async () => {
    await renderAndCheck(withProviders(<Breadcrumb />));
  });

  it('reorder list', async () => {
    await renderAndCheck(
      <ReorderList
        aria-label="Sections"
        items={[
          { id: '1', label: 'Coverage' },
          { id: '2', label: 'Revenue' },
        ]}
        onReorder={noop}
        renderItem={(i) => <span>{i.label}</span>}
      />,
    );
  });
});

describe('display and state', () => {
  it('alerts', async () => {
    await renderAndCheck(
      <div>
        <Alert>Something went wrong.</Alert>
        <Alert tone="success">Return submitted.</Alert>
        <Alert tone="warning" onRetry={noop}>
          Could not load the list.
        </Alert>
      </div>,
    );
  });

  it('badges, stat cards, progress', async () => {
    await renderAndCheck(
      <div>
        <Badge tone="success">Approved</Badge>
        <StatCard label="Returns due" value={12} tone="warning" />
        <Progress value={40} label="Completeness" />
      </div>,
    );
  });

  it('description list and timeline', async () => {
    await renderAndCheck(
      <div>
        <DescriptionList
          items={[
            { label: 'Licence', value: 'NCA/OP/001' },
            { label: 'Status', value: 'Active' },
          ]}
        />
        <Timeline
          events={[
            { id: '1', title: 'Submitted', actor: 'A. Deng', when: '2 days ago' },
            { id: '2', title: 'Approved', when: 'today', tone: 'success' },
          ]}
        />
      </div>,
    );
  });

  it('loading and empty states', async () => {
    await renderAndCheck(
      <div>
        <Spinner label="Loading returns" />
        <Skeleton className="h-4 w-32" />
        <EmptyState message="No returns yet" action={<Button>Start one</Button>} />
      </div>,
    );
  });
});
