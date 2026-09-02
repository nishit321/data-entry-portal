import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Power, Trash2, UserPlus } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Combobox,
  FilterField,
  ConfirmDialog,
  FormField,
  IconButton,
  Input,
  ListShell,
  Modal,
  PageHeader,
  Select,
  useToast,
  type ActiveFilterChip,
} from '../components/ui';
import { DataTable, type Column, type Density } from '../components/DataTable';
import { useListParams } from '../hooks/useListParams';
import { useAuth } from '../context/AuthContext';
import { usersApi, type UserListParams } from '../lib/auth.api';
import { entityPicker } from '../lib/pickers';
import { getErrorMessage } from '../lib/api';
import { activeLabel, activeTone } from '../lib/status';
import { formatDateTime } from '../lib/format';
import { isOperatorRole, ROLE_LABELS, ROLES, type Role, type User } from '../lib/types';

// Query keys scoped to this screen.
const usersKeys = {
  all: ['users'] as const,
  list: ['users', 'list'] as const,
};

const ROLE_OPTIONS = ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }));
const ROLE_FILTER_OPTIONS = [{ value: '', label: 'All roles' }, ...ROLE_OPTIONS];
const STATUS_FILTER_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'true', label: 'Active' },
  { value: 'false', label: 'Inactive' },
];
const STATUS_OPTIONS = [
  { value: 'true', label: 'Active' },
  { value: 'false', label: 'Inactive' },
];

// Operator roles must carry an entity; non-operator roles must not. Shared by
// the create and edit forms so the rule lives in one place.
const requireEntityForOperator = (val: { role: Role; entityId?: string }, ctx: z.RefinementCtx) => {
  if (isOperatorRole(val.role) && !val.entityId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['entityId'],
      message: 'An operator user must be linked to an entity',
    });
  }
};

const createSchema = z
  .object({
    firstName: z.string().min(1, 'First name is required').max(100),
    lastName: z.string().min(1, 'Last name is required').max(100),
    email: z.string().email('Enter a valid email'),
    role: z.enum(ROLES),
    entityId: z.string().uuid('Select an entity').optional().or(z.literal('')),
    password: z.string().min(8, 'At least 8 characters').max(72).optional().or(z.literal('')),
  })
  .superRefine(requireEntityForOperator);

const editSchema = z
  .object({
    firstName: z.string().min(1, 'First name is required').max(100),
    lastName: z.string().min(1, 'Last name is required').max(100),
    role: z.enum(ROLES),
    entityId: z.string().uuid('Select an entity').optional().or(z.literal('')),
    isActive: z.boolean(),
  })
  .superRefine(requireEntityForOperator);

type CreateForm = z.infer<typeof createSchema>;
type EditForm = z.infer<typeof editSchema>;

export function UsersPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { user: currentUser } = useAuth();

  const [formOpen, setFormOpen] = useState(false);
  const [formError, setFormError] = useState('');
  const [tempPassword, setTempPassword] = useState('');
  const [editing, setEditing] = useState<User | null>(null);
  const [editError, setEditError] = useState('');
  const [pendingDelete, setPendingDelete] = useState<User | null>(null);

  const list = useListParams({
    defaultSort: 'createdAt',
    defaultOrder: 'desc',
    preferenceKey: 'users',
    filters: { role: '', isActive: '' },
  });
  const [density, setDensity] = useState<Density>('comfortable');

  const params: UserListParams = {
    page: list.page,
    pageSize: list.pageSize,
    sort: list.sort as UserListParams['sort'],
    order: list.order,
    search: list.search.trim() || undefined,
    role: (list.filters.role || undefined) as Role | undefined,
    isActive: list.filters.isActive === '' ? undefined : list.filters.isActive === 'true',
  };
  const listQuery = useQuery({
    queryKey: [...usersKeys.list, params],
    queryFn: () => usersApi.list(params),
  });

  const activeFilters: ActiveFilterChip[] = [
    ...(list.search
      ? [{ key: 'search', label: `Matching ${list.search}`, onRemove: () => list.setSearch('') }]
      : []),
    ...(list.filters.role
      ? [
          {
            key: 'role',
            label: ROLE_LABELS[list.filters.role as Role],
            onRemove: () => list.clearFilter('role'),
          },
        ]
      : []),
    ...(list.filters.isActive
      ? [
          {
            key: 'isActive',
            label: list.filters.isActive === 'true' ? 'Active only' : 'Inactive only',
            onRemove: () => list.clearFilter('isActive'),
          },
        ]
      : []),
  ];

  const form = useForm<CreateForm>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      firstName: '',
      lastName: '',
      email: '',
      role: 'OPERATOR_SUBMITTER',
      entityId: '',
      password: '',
    },
  });

  const editForm = useForm<EditForm>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      firstName: '',
      lastName: '',
      role: 'OPERATOR_SUBMITTER',
      entityId: '',
      isActive: true,
    },
  });

  // Operator roles must be linked to an entity, so offer a picker for them.
  const createNeedsEntity = isOperatorRole(form.watch('role'));
  const editNeedsEntity = isOperatorRole(editForm.watch('role'));

  const openCreate = () => {
    form.reset({
      firstName: '',
      lastName: '',
      email: '',
      role: 'OPERATOR_SUBMITTER',
      entityId: '',
      password: '',
    });
    setFormError('');
    setFormOpen(true);
  };

  const createMutation = useMutation({
    mutationFn: (v: CreateForm) =>
      usersApi.create({
        firstName: v.firstName,
        lastName: v.lastName,
        email: v.email,
        role: v.role,
        // Only operator roles carry an entity; the API rejects it for the others.
        entityId: isOperatorRole(v.role) ? v.entityId || undefined : undefined,
        password: v.password || undefined,
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: usersKeys.all });
      setFormOpen(false);
      toast.success('User created.');
      // Keep the generated password on-screen so the admin can copy it — a toast would vanish.
      setTempPassword(res.temporaryPassword ?? '');
    },
    onError: (err) => setFormError(getErrorMessage(err, "We couldn't create the user")),
  });

  const openEdit = (u: User) => {
    editForm.reset({
      firstName: u.firstName,
      lastName: u.lastName,
      role: u.role,
      entityId: u.entityId ?? '',
      isActive: u.isActive,
    });
    setEditError('');
    setEditing(u);
  };

  const editMutation = useMutation({
    mutationFn: (v: EditForm) => {
      if (!editing) throw new Error('No user selected');
      return usersApi.update(editing.id, {
        firstName: v.firstName,
        lastName: v.lastName,
        role: v.role,
        isActive: v.isActive,
        // Send the entity only for operator roles; null clears a stale link.
        entityId: isOperatorRole(v.role) ? v.entityId || undefined : null,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: usersKeys.all });
      setEditing(null);
      toast.success('User updated.');
    },
    onError: (err) => setEditError(getErrorMessage(err, "We couldn't update the user")),
  });

  const toggleMutation = useMutation({
    mutationFn: (u: User) => usersApi.update(u.id, { isActive: !u.isActive }),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: usersKeys.all });
      toast.success(updated.isActive ? 'User activated.' : 'User deactivated.');
    },
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't update the user")),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => usersApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: usersKeys.all });
      setPendingDelete(null);
      toast.success('User deleted.');
    },
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't delete the user")),
  });

  const rows = listQuery.data?.data ?? [];

  // Bulk activate / deactivate (FRONTEND_STANDARDS §3.11). Turning off access for a departed team
  // is a real administrative task, and doing it one power-button at a time across a paginated list
  // is where mistakes get made.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pendingBulk, setPendingBulk] = useState<'activate' | 'deactivate' | null>(null);

  const selectedUsers = rows.filter((u) => selected.has(u.id));
  /** You can't deactivate your own account, so it's never a valid target for a bulk action. */
  const isRowSelectable = (u: User) => u.id !== currentUser?.id;

  const bulkMutation = useMutation({
    mutationFn: async (action: 'activate' | 'deactivate') => {
      const isActive = action === 'activate';
      await Promise.all(
        selectedUsers
          .filter((u) => u.isActive !== isActive)
          .map((u) => usersApi.update(u.id, { isActive })),
      );
      return selectedUsers.length;
    },
    onSuccess: (count, action) => {
      qc.invalidateQueries({ queryKey: usersKeys.all });
      setSelected(new Set());
      setPendingBulk(null);
      toast.success(
        `${count} ${count === 1 ? 'account' : 'accounts'} ${
          action === 'activate' ? 'activated' : 'deactivated'
        }.`,
      );
    },
    onError: (err) => {
      setPendingBulk(null);
      toast.error(getErrorMessage(err, "We couldn't update every account"));
    },
  });
  // You cannot change your own role, entity, or active status.
  const editingSelf = editing?.id === currentUser?.id;

  const columns: Column<User>[] = [
    {
      header: 'Name',
      sortKey: 'firstName',
      cell: (u) => {
        const isSelf = u.id === currentUser?.id;
        return (
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700">
              {`${u.firstName.charAt(0)}${u.lastName.charAt(0)}`.toUpperCase()}
            </span>
            <span className="font-medium text-gray-900">
              {u.firstName} {u.lastName}
              {isSelf && <span className="ml-2 text-xs font-normal text-gray-500">(you)</span>}
            </span>
          </div>
        );
      },
    },
    {
      header: 'Email',
      sortKey: 'email',
      cell: (u) => <span className="text-gray-600">{u.email}</span>,
    },
    {
      header: 'Role',
      sortKey: 'role',
      cell: (u) => <span className="text-gray-700">{ROLE_LABELS[u.role]}</span>,
    },
    {
      header: 'Entity',
      cell: (u) => <span className="text-gray-600">{u.entity?.name ?? '—'}</span>,
    },
    {
      header: 'Status',
      sortKey: 'isActive',
      cell: (u) => <Badge tone={activeTone(u.isActive)}>{activeLabel(u.isActive)}</Badge>,
    },
    {
      header: 'Last login',
      cell: (u) => <span className="text-gray-500">{formatDateTime(u.lastLoginAt)}</span>,
    },
    {
      header: 'Created',
      sortKey: 'createdAt',
      cell: (u) => <span className="text-gray-500">{formatDateTime(u.createdAt)}</span>,
    },
    {
      header: 'Actions',
      align: 'right',
      cell: (u) => {
        const isSelf = u.id === currentUser?.id;
        return (
          <div className="flex justify-end gap-1">
            <IconButton icon={Pencil} label="Edit this user" onClick={() => openEdit(u)} />
            <IconButton
              icon={Power}
              label={u.isActive ? 'Deactivate this user' : 'Activate this user'}
              disabled={isSelf}
              onClick={() => toggleMutation.mutate(u)}
            />
            <IconButton
              icon={Trash2}
              label="Delete this user"
              variant="danger"
              disabled={isSelf}
              onClick={() => setPendingDelete(u)}
            />
          </div>
        );
      },
    },
  ];

  return (
    <ListShell
      header={
        <div className="space-y-4">
          <PageHeader
            description="Create accounts, assign roles, and manage access across the portal."
            actions={
              <Button onClick={openCreate} icon={UserPlus}>
                New user
              </Button>
            }
          />
          {tempPassword && (
            <Alert tone="info">
              User created. Copy this temporary password now. You will not see it again.{' '}
              <span className="font-mono font-semibold">{tempPassword}</span>
            </Alert>
          )}
        </div>
      }
      search={{
        value: list.search,
        onChange: list.setSearch,
        placeholder: 'Search by name or email',
        label: 'Search users',
      }}
      filters={
        <>
          <FilterField label="Role" width="lg">
            <Select
              aria-label="Filter by role"
              value={list.filters.role}
              options={ROLE_FILTER_OPTIONS}
              onChange={(role) => list.setFilters({ role })}
            />
          </FilterField>
          <FilterField label="Status" width="sm">
            <Select
              aria-label="Filter by status"
              value={list.filters.isActive}
              options={STATUS_FILTER_OPTIONS}
              onChange={(isActive) => list.setFilters({ isActive })}
            />
          </FilterField>
        </>
      }
      activeFilters={activeFilters}
      onClearFilters={list.clearAll}
      meta={listQuery.data?.meta}
      onPageChange={list.setPage}
      onPageSizeChange={list.setPageSize}
      refreshing={listQuery.isFetching && !listQuery.isLoading}
      onDensityChange={setDensity}
      selectionBar={
        selected.size > 0 ? (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2">
            <span className="text-sm font-medium text-brand-800">{selected.size} selected</span>
            <div className="ml-auto flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => setPendingBulk('activate')}>
                Activate
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setPendingBulk('deactivate')}>
                Deactivate
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setSelected(new Set())}>
                Clear
              </Button>
            </div>
          </div>
        ) : undefined
      }
    >
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(u) => u.id}
        loading={listQuery.isLoading}
        refreshing={listQuery.isFetching && !listQuery.isLoading}
        error={listQuery.isError}
        onRetry={() => void listQuery.refetch()}
        sort={list.sort}
        order={list.order}
        onSortChange={list.setSort}
        density={density}
        selectable
        selectedKeys={selected}
        onSelectionChange={setSelected}
        isRowSelectable={isRowSelectable}
        emptyMessage={
          list.hasActiveFilters
            ? 'No users match your filters.'
            : 'No accounts have been created yet.'
        }
        emptyAction={
          list.hasActiveFilters ? (
            <Button variant="secondary" onClick={list.clearAll}>
              Clear filters
            </Button>
          ) : (
            <Button variant="secondary" onClick={openCreate}>
              Add a user
            </Button>
          )
        }
      />

      <Modal open={formOpen} title="Create a new user" onClose={() => setFormOpen(false)} size="lg">
        <form onSubmit={form.handleSubmit((v) => createMutation.mutate(v))} className="space-y-4">
          {formError && <Alert tone="danger">{formError}</Alert>}

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              htmlFor="firstName"
              label="First name"
              required
              error={form.formState.errors.firstName?.message}
            >
              {(field) => (
                <Input {...field} placeholder="e.g. Grace" {...form.register('firstName')} />
              )}
            </FormField>
            <FormField
              htmlFor="lastName"
              label="Last name"
              required
              error={form.formState.errors.lastName?.message}
            >
              {(field) => (
                <Input {...field} placeholder="e.g. Deng" {...form.register('lastName')} />
              )}
            </FormField>
            <FormField
              htmlFor="email"
              label="Email"
              required
              error={form.formState.errors.email?.message}
            >
              {(field) => (
                <Input
                  {...field}
                  type="email"
                  placeholder="name@example.com"
                  {...form.register('email')}
                />
              )}
            </FormField>
            <FormField
              htmlFor="role"
              label="Role"
              required
              error={form.formState.errors.role?.message}
            >
              <Controller
                control={form.control}
                name="role"
                render={({ field: { value, onChange } }) => (
                  <Select
                    id="role"
                    value={value ?? ''}
                    onChange={(next) => {
                      onChange(next);
                      // Entity only applies to operator roles — drop a stale selection.
                      if (!isOperatorRole(next as Role)) {
                        form.setValue('entityId', '', { shouldValidate: false });
                      }
                    }}
                    options={ROLE_OPTIONS}
                    placeholder="Select a role"
                    invalid={!!form.formState.errors.role}
                    aria-label="Role"
                  />
                )}
              />
            </FormField>
            {createNeedsEntity && (
              <FormField
                htmlFor="entityId"
                label="Entity"
                required
                error={form.formState.errors.entityId?.message}
              >
                <Controller
                  control={form.control}
                  name="entityId"
                  render={({ field: { value, onChange } }) => (
                    <Combobox
                      id="entityId"
                      value={value ?? ''}
                      onChange={onChange}
                      source={entityPicker}
                      emptyLabel="Select an entity"
                      placeholder="Search entities…"
                      invalid={!!form.formState.errors.entityId}
                      aria-label="Entity"
                    />
                  )}
                />
              </FormField>
            )}
          </div>

          <FormField
            htmlFor="password"
            label="Temporary password (optional)"
            error={form.formState.errors.password?.message}
          >
            {(field) => (
              <Input
                {...field}
                type="text"
                placeholder="Leave blank to auto-generate"
                {...form.register('password')}
              />
            )}
          </FormField>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" isLoading={createMutation.isPending}>
              Create user
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={editing !== null} title="Edit user" onClose={() => setEditing(null)} size="lg">
        {editing && (
          <form
            onSubmit={editForm.handleSubmit((v) => editMutation.mutate(v))}
            className="space-y-4"
          >
            {editError && <Alert tone="danger">{editError}</Alert>}

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                htmlFor="edit-firstName"
                label="First name"
                required
                error={editForm.formState.errors.firstName?.message}
              >
                {(field) => <Input {...field} {...editForm.register('firstName')} />}
              </FormField>
              <FormField
                htmlFor="edit-lastName"
                label="Last name"
                required
                error={editForm.formState.errors.lastName?.message}
              >
                {(field) => <Input {...field} {...editForm.register('lastName')} />}
              </FormField>
            </div>

            {/* Email is the login identity and is changed through a separate verified flow. */}
            <FormField htmlFor="edit-email" label="Email">
              {(field) => <Input {...field} value={editing.email} disabled readOnly />}
            </FormField>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                htmlFor="edit-role"
                label="Role"
                required
                error={editForm.formState.errors.role?.message}
              >
                <Controller
                  control={editForm.control}
                  name="role"
                  render={({ field: { value, onChange } }) => (
                    <Select
                      id="edit-role"
                      value={value ?? ''}
                      onChange={(next) => {
                        onChange(next);
                        if (!isOperatorRole(next as Role)) {
                          editForm.setValue('entityId', '', { shouldValidate: false });
                        }
                      }}
                      options={ROLE_OPTIONS}
                      disabled={editingSelf}
                      invalid={!!editForm.formState.errors.role}
                      aria-label="Role"
                    />
                  )}
                />
              </FormField>
              {editNeedsEntity && (
                <FormField
                  htmlFor="edit-entityId"
                  label="Entity"
                  required
                  error={editForm.formState.errors.entityId?.message}
                >
                  <Controller
                    control={editForm.control}
                    name="entityId"
                    render={({ field: { value, onChange } }) => (
                      <Combobox
                        id="edit-entityId"
                        value={value ?? ''}
                        onChange={onChange}
                        source={entityPicker}
                        emptyLabel="Select an entity"
                        placeholder="Search entities…"
                        disabled={editingSelf}
                        invalid={!!editForm.formState.errors.entityId}
                        aria-label="Entity"
                      />
                    )}
                  />
                </FormField>
              )}
              <FormField htmlFor="edit-status" label="Status">
                <Controller
                  control={editForm.control}
                  name="isActive"
                  render={({ field: { value, onChange } }) => (
                    <Select
                      id="edit-status"
                      value={value ? 'true' : 'false'}
                      onChange={(next) => onChange(next === 'true')}
                      options={STATUS_OPTIONS}
                      disabled={editingSelf}
                      aria-label="Status"
                    />
                  )}
                />
              </FormField>
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button type="submit" isLoading={editMutation.isPending}>
                Save changes
              </Button>
            </div>
          </form>
        )}
      </Modal>

      <ConfirmDialog
        open={pendingBulk !== null}
        title={
          pendingBulk === 'activate' ? 'Activate these accounts?' : 'Deactivate these accounts?'
        }
        message={
          pendingBulk === 'activate'
            ? `${selectedUsers.length} ${
                selectedUsers.length === 1 ? 'person' : 'people'
              } will be able to sign in again.`
            : `${selectedUsers.length} ${
                selectedUsers.length === 1 ? 'person' : 'people'
              } will be blocked from signing in. You can undo this by activating them again.`
        }
        tone={pendingBulk === 'activate' ? 'primary' : 'danger'}
        confirmLabel={pendingBulk === 'activate' ? 'Activate' : 'Deactivate'}
        isLoading={bulkMutation.isPending}
        onConfirm={() => pendingBulk && bulkMutation.mutate(pendingBulk)}
        onClose={() => setPendingBulk(null)}
      />

      <ConfirmDialog
        open={!!pendingDelete}
        title="Delete user"
        message={
          pendingDelete ? (
            <>
              Delete <span className="font-medium">{pendingDelete.email}</span>? This cannot be
              undone.
            </>
          ) : (
            ''
          )
        }
        tone="danger"
        isLoading={deleteMutation.isPending}
        onConfirm={() => pendingDelete && deleteMutation.mutate(pendingDelete.id)}
        onClose={() => setPendingDelete(null)}
      />
    </ListShell>
  );
}
