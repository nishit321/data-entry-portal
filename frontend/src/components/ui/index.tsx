// The design-system component library — one source of truth (FRONTEND_STANDARDS §3.4).
// Every screen composes from here; nothing hand-rolls a button, table, select, or modal.
// This is a re-export barrel, so it intentionally mixes component and value exports.
/* eslint-disable react-refresh/only-export-components */

// Actions
export { Button, type ButtonVariant, type ButtonSize } from './Button';
export { IconButton } from './IconButton';
export { Dropdown, type MenuItem } from './Dropdown';

// Display
export { Badge } from './Badge';
export { Alert } from './Alert';
export { Card } from './Card';
export { StatCard } from './StatCard';
export { DescriptionList, type DescriptionItem } from './DescriptionList';
export { Timeline, type TimelineEvent } from './Timeline';
export { Progress } from './Progress';
export { RelativeTime } from './RelativeTime';
export { Tooltip } from './Tooltip';
export { ReorderList, type ReorderItem } from './ReorderList';

// Page structure
export { Page } from './Page';
export { PageHeader } from './PageHeader';
export { Breadcrumb } from './Breadcrumb';
export { ListShell, type ActiveFilterChip } from './ListShell';
export { Tabs, type TabItem } from './Tabs';

// States
export { Spinner } from './Spinner';
export { SaveStatus } from './SaveStatus';
export { Skeleton, SkeletonText, SkeletonTable } from './Skeleton';
export { PageLoading } from './PageLoading';
export { EmptyState } from './EmptyState';

// Form controls
export { Field } from './Field';
export { FormField } from './FormField';
export { Input } from './Input';
export { PasswordInput } from './PasswordInput';
export { Textarea } from './Textarea';
export { Checkbox } from './Checkbox';
export { RadioGroup, type RadioOption } from './Radio';
export { Select, type SelectOption } from './Select';
export { Combobox, type ComboboxOption, type ComboboxSource } from './Combobox';
export { SearchInput } from './SearchInput';
export { DatePicker } from './DatePicker';
export { DateRangeFilter, type DateRange } from './DateRangeFilter';
export { FilterField, type FilterWidth } from './FilterField';

// Overlays
export { Modal } from './Modal';
export { Drawer } from './Drawer';
export { ConfirmDialog } from './ConfirmDialog';
export { ToastProvider, useToast } from './Toast';

// Lists
export { Pagination, PAGE_SIZE_OPTIONS } from './Pagination';
