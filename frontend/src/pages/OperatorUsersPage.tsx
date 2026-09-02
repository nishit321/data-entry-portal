import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Power, Trash2, Users } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  FormField,
  IconButton,
  Input,
  FilterField,
  ListShell,
  Modal,
  PageHeader,
  Select,
  useToast,
  type ActiveFilterChip,
  type SelectOption,
} from '../components/ui';
import { DataTable, type Column, type Density } from '../components/DataTable';
import { useListParams } from '../hooks/useListParams';
import {
  operatorUserKeys,
  operatorUsersApi,
  type OperatorCreateUserInput,
  type OperatorRole,
} from '../lib/operator-users.api';
import type { UserListParams } from '../lib/auth.api';
import { getErrorMessage } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { activeLabel, activeTone } from '../lib/status';
import { formatDateTime } from '../lib/format';
import { ROLE_LABELS, type User } from '../lib/types';

const OPERATOR_ROLES: OperatorRole[] = ['OPERATOR_ADMIN', 'OPERATOR_SUBMITTER'];

const ROLE_OPTIONS: SelectOption[] = OPERATOR_ROLES.map((r) => ({
  value: r,
  label: ROLE_LABELS[r],
}));

const ROLE_FILTER_OPTIONS: SelectOption[] = [{ value: '', label: 'All roles' }, ...ROLE_OPTIONS];

const STATUS_FILTER_OPTIONS: SelectOption[] = [
  { value: '', label: 'All statuses' },
  { value: 'true', label: 'Active' },
  { value: 'false', label: 'Inactive' },
];
const STATUS_OPTIONS: SelectOption[] = [
  { value: 'true', label: 'Active' },
  { value: 'false', label: 'Inactive' },
];

const createSchema = z.object({
  firstName: z.string().min(1, 'First name is required').max(100),
  lastName: z.string().min(1, 'Last name is required').max(100),
  email: z.string().email('Enter a valid email'),
  role: z.enum(['OPERATOR_ADMIN', 'OPERATOR_SUBMITTER']),
  password: z.string().min(8, 'At least 8 characters').max(72).optional().or(z.literal('')),
});

const editSchema = z.object({
  firstName: z.string().min(1, 'First name is required').max(100),
  lastName: z.string().min(1, 'Last name is required').max(100),
  role: z.enum(['OPERATOR_ADMIN', 'OPERATOR_SUBMITTER']),
  isActive: z.boolean(),
});

type CreateForm = z.infer<typeof createSchema>;
type EditForm = z.infer<typeof editSchema>;

export function OperatorUsersPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { user: currentUser } = useAuth();
  const [formOpen, setFormOpen] = useState(false);
  const [confirming, setConfirming] = useState<User | null>(null);
  const [tempPassword, setTempPassword] = useState('');
  const [formError, setFormError] = useState('');
  const [editing, setEditing] = useState<User | null>(null);
  const [editError, setEditError] = useState('');
  const list = useListParams({
    defaultSort: 'createdAt',
    defaultOrder: 'desc',
    preferenceKey: 'operator-users',
    filters: { role: '', isActive: '' },
  });
  const [density, setDensity] = useState<Density>('comfortable');

  const params: UserListParams = {
    page: list.page,
    pageSize: list.pageSize,
    sort: list.sort as UserListParams['sort'],
    order: list.order,
    search: list.search.trim() || undefined,
    role: (list.filters.role || undefined) as OperatorRole | undefined,
    isActive: list.filters.isActive === '' ? undefined : list.filters.isActive === 'true',
  };
  const listQuery = useQuery({
    queryKey: [...operatorUserKeys.list(), params],
    queryFn: () => operatorUsersApi.list(params),
  });

  const activeFilters: ActiveFilterChip[] = [
    ...(list.search
      ? [{ key: 'search', label: 'Matching ' + list.search, onRemove: () => list.setSearch('') }]
      : []),
    ...(list.filters.role
      ? [
          {
            key: 'role',
            label: ROLE_LABELS[list.filters.role as OperatorRole],
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

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateForm>({
    resolver: zodResolver(createSchema),
    defaultValues: { role: 'OPERATOR_SUBMITTER' },
  });

  const editForm = useForm<EditForm>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      firstName: '',
      lastName: '',
      role: 'OPERATOR_SUBMITTER',
      isActive: true,
    },
  });

  const openCreate = () => {
    reset({
      firstName: '',
      lastName: '',
      email: '',
      role: 'OPERATOR_SUBMITTER',
      password: '',
    });
    setFormError('');
    setTempPassword('');
    setFormOpen(true);
  };

  const createMutation = useMutation({
    mutationFn: (v: CreateForm) => {
      const body: OperatorCreateUserInput = {
        firstName: v.firstName,
        lastName: v.lastName,
        email: v.email,
        role: v.role,
        password: v.password || undefined,
      };
      return operatorUsersApi.create(body);
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: operatorUserKeys.all });
      setFormOpen(false);
      if (res.temporaryPassword) {
        setTempPassword(res.temporaryPassword);
      } else {
        toast.success('User created.');
      }
    },
    onError: (err) => setFormError(getErrorMessage(err, "We couldn't create the user")),
  });

  const openEdit = (u: User) => {
    editForm.reset({
      firstName: u.firstName,
      lastName: u.lastName,
      role: u.role as OperatorRole,
      isActive: u.isActive,
    });
    setEditError('');
    setEditing(u);
  };

  const editMutation = useMutation({
    mutationFn: (v: EditForm) => {
      if (!editing) throw new Error('No user selected');
      return operatorUsersApi.update(editing.id, {
        firstName: v.firstName,
        lastName: v.lastName,
        role: v.role,
        isActive: v.isActive,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: operatorUserKeys.all });
      setEditing(null);
      toast.success('User updated.');
    },
    onError: (err) => setEditError(getErrorMessage(err, "We couldn't update the user")),
  });

  const toggleMutation = useMutation({
    mutationFn: (u: User) => operatorUsersApi.update(u.id, { isActive: !u.isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: operatorUserKeys.all }),
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't update the user")),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => operatorUsersApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: operatorUserKeys.all });
      setConfirming(null);
      toast.success('User deleted.');
    },
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't delete the user")),
  });

  const rows = listQuery.data?.data ?? [];
  // You cannot change your own role or active status.
  const editingSelf = editing?.id === currentUser?.id;

  const columns: Column<User>[] = [
    {
      header: 'Name',
      sortKey: 'firstName',
      cell: (u) => (
        <span className="font-medium text-gray-900">
          {u.firstName} {u.lastName}
          {u.id === currentUser?.id && (
            <span className="ml-2 text-xs font-normal text-gray-500">(you)</span>
          )}
        </span>
      ),
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
      cell: (u) => (
        <div className="flex justify-end gap-1">
          <IconButton icon={Pencil} label="Edit this team member" onClick={() => openEdit(u)} />
          <IconButton
            icon={Power}
            label={u.isActive ? 'Deactivate this team member' : 'Activate this team member'}
            disabled={u.id === currentUser?.id}
            onClick={() => toggleMutation.mutate(u)}
          />
          <IconButton
            icon={Trash2}
            label="Delete this team member"
            variant="danger"
            disabled={u.id === currentUser?.id}
            onClick={() => setConfirming(u)}
          />
        </div>
      ),
    },
  ];

  return (
    <ListShell
      header={
        <div className="space-y-4">
          <PageHeader
            description="Manage the users in your organisation who submit and administer returns."
            actions={
              <Button onClick={openCreate} icon={Plus}>
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
        label: 'Search team members',
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
      footnote={
        <p className="flex items-center gap-1.5 text-xs text-gray-500">
          <Users size={13} aria-hidden /> These users belong to your entity only.
        </p>
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
        emptyMessage={
          list.hasActiveFilters ? 'No team members match your filters.' : 'No team members yet.'
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

      <Modal open={formOpen} title="Add a team member" onClose={() => setFormOpen(false)}>
        <form onSubmit={handleSubmit((v) => createMutation.mutate(v))} className="space-y-4">
          {formError && <Alert tone="danger">{formError}</Alert>}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              htmlFor="firstName"
              label="First name"
              error={errors.firstName?.message}
              required
            >
              {(field) => <Input {...field} placeholder="e.g. Grace" {...register('firstName')} />}
            </FormField>
            <FormField
              htmlFor="lastName"
              label="Last name"
              error={errors.lastName?.message}
              required
            >
              {(field) => <Input {...field} placeholder="e.g. Deng" {...register('lastName')} />}
            </FormField>
            <FormField htmlFor="email" label="Email" error={errors.email?.message} required>
              {(field) => (
                <Input
                  type="email"
                  {...field}
                  placeholder="name@example.com"
                  {...register('email')}
                />
              )}
            </FormField>
            <FormField htmlFor="role" label="Role" error={errors.role?.message}>
              {(field) => (
                <Controller
                  control={control}
                  name="role"
                  render={({ field: { value, onChange } }) => (
                    <Select
                      id={field.id}
                      invalid={field['aria-invalid']}
                      value={value}
                      onChange={onChange}
                      options={ROLE_OPTIONS}
                      placeholder="Select a role"
                    />
                  )}
                />
              )}
            </FormField>
          </div>
          <FormField
            htmlFor="password"
            label="Temporary password (optional)"
            error={errors.password?.message}
          >
            {(field) => (
              <Input
                type="text"
                placeholder="Leave blank to auto-generate"
                {...field}
                {...register('password')}
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

      <Modal open={editing !== null} title="Edit user" onClose={() => setEditing(null)}>
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
                error={editForm.formState.errors.role?.message}
              >
                {(field) => (
                  <Controller
                    control={editForm.control}
                    name="role"
                    render={({ field: { value, onChange } }) => (
                      <Select
                        id={field.id}
                        invalid={field['aria-invalid']}
                        value={value}
                        onChange={onChange}
                        options={ROLE_OPTIONS}
                        disabled={editingSelf}
                      />
                    )}
                  />
                )}
              </FormField>
              <FormField htmlFor="edit-status" label="Status">
                {(field) => (
                  <Controller
                    control={editForm.control}
                    name="isActive"
                    render={({ field: { value, onChange } }) => (
                      <Select
                        id={field.id}
                        value={value ? 'true' : 'false'}
                        onChange={(next) => onChange(next === 'true')}
                        options={STATUS_OPTIONS}
                        disabled={editingSelf}
                      />
                    )}
                  />
                )}
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
        open={confirming !== null}
        title="Delete user"
        message={confirming ? `Delete ${confirming.email}? This cannot be undone.` : ''}
        confirmLabel="Delete"
        tone="danger"
        isLoading={deleteMutation.isPending}
        onConfirm={() => confirming && deleteMutation.mutate(confirming.id)}
        onClose={() => setConfirming(null)}
      />
    </ListShell>
  );
}
