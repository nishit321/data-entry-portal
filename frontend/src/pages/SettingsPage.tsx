import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Settings2 } from 'lucide-react';
import {
  Button,
  Card,
  Checkbox,
  Field,
  Input,
  Page,
  PageHeader,
  Skeleton,
  useToast,
} from '../components/ui';
import { settingsApi, settingsKeys, type SettingView } from '../lib/settings.api';
import { getErrorMessage } from '../lib/api';

/**
 * The switches the Authority can throw for itself (NCA, 15 October 2026).
 *
 * Small on purpose. This is not a preferences screen: everything here changes how the portal
 * behaves for everybody, so each one says what it does in full rather than relying on its label,
 * and each is saved on its own so a half-finished change to one cannot be carried in on the back
 * of another.
 *
 * What belongs here is a decision the Authority should be able to make without a deployment.
 * Anything that needs a migration, a key, or a restart does not; it belongs in the environment
 * file, where changing it is deliberately somebody else's job.
 */
export function SettingsPage() {
  const toast = useToast();
  const queryClient = useQueryClient();

  const query = useQuery({ queryKey: settingsKeys.all, queryFn: settingsApi.all });

  const save = useMutation({
    mutationFn: ({ key, value }: { key: string; value: boolean | number }) =>
      settingsApi.set(key, value),
    onSuccess: (settings) => {
      queryClient.setQueryData(settingsKeys.all, settings);
      // The sign-in screen reads its own cut-down copy of this, and it is now stale.
      void queryClient.invalidateQueries({ queryKey: settingsKeys.public });
      toast.success('Saved.');
    },
    onError: (err) => toast.error(getErrorMessage(err, "We couldn't save that.")),
  });

  return (
    <Page>
      <div className="space-y-6">
        <PageHeader
          title="Settings"
          description="Changes here take effect for everybody, straight away."
        />

        {query.isLoading ? (
          <div className="space-y-4">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-28 w-full" />
            ))}
          </div>
        ) : (
          (query.data ?? []).map((setting) => (
            <SettingCard
              key={setting.key}
              setting={setting}
              isSaving={save.isPending && save.variables?.key === setting.key}
              onSave={(value) => save.mutate({ key: setting.key, value })}
            />
          ))
        )}
      </div>
    </Page>
  );
}

function SettingCard({
  setting,
  isSaving,
  onSave,
}: {
  setting: SettingView;
  isSaving: boolean;
  onSave: (value: boolean | number) => void;
}) {
  return (
    <Card>
      <div className="flex items-start gap-3">
        <Settings2 size={18} className="mt-0.5 shrink-0 text-gray-400" aria-hidden />
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-gray-900">{setting.label}</h3>
          <p className="mt-1 text-sm text-gray-600">{setting.description}</p>
          <div className="mt-4">
            {setting.type === 'boolean' ? (
              <BooleanSetting setting={setting} isSaving={isSaving} onSave={onSave} />
            ) : (
              <NumberSetting setting={setting} isSaving={isSaving} onSave={onSave} />
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

function BooleanSetting({
  setting,
  isSaving,
  onSave,
}: {
  setting: SettingView;
  isSaving: boolean;
  onSave: (value: boolean) => void;
}) {
  // Saved on the click. A switch with a Save button beside it invites somebody to flick it, walk
  // away, and believe it took.
  return (
    <Checkbox
      id={`setting-${setting.key}`}
      checked={setting.value === true}
      disabled={isSaving}
      onChange={onSave}
      label={setting.value === true ? 'On' : 'Off'}
    />
  );
}

function NumberSetting({
  setting,
  isSaving,
  onSave,
}: {
  setting: SettingView;
  isSaving: boolean;
  onSave: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(setting.value));
  const parsed = Number(draft);
  const valid =
    draft.trim() !== '' &&
    Number.isFinite(parsed) &&
    parsed >= (setting.min ?? -Infinity) &&
    parsed <= (setting.max ?? Infinity);
  const unchanged = parsed === setting.value;

  return (
    <div className="flex flex-wrap items-end gap-3">
      <Field
        label={setting.unit ? `Value in ${setting.unit}` : 'Value'}
        htmlFor={`setting-${setting.key}`}
        hint={
          setting.min !== undefined && setting.max !== undefined
            ? `Between ${setting.min} and ${setting.max}`
            : undefined
        }
        error={valid || draft.trim() === '' ? undefined : 'Outside what this setting allows.'}
      >
        <Input
          id={`setting-${setting.key}`}
          type="number"
          inputMode="numeric"
          min={setting.min}
          max={setting.max}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="w-32"
        />
      </Field>
      <Button
        size="sm"
        isLoading={isSaving}
        disabled={!valid || unchanged}
        onClick={() => onSave(parsed)}
      >
        Save
      </Button>
    </div>
  );
}
