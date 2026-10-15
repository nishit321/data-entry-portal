import { BadRequestException } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { SETTINGS, type SettingKey } from './settings.registry';

function build(rows: { key: string; value: string }[] = []) {
  const upsert = jest.fn().mockResolvedValue(undefined);
  const record = jest.fn().mockResolvedValue(undefined);
  const prisma = { systemSetting: { findMany: jest.fn().mockResolvedValue(rows), upsert } };
  const service = new SettingsService(prisma as never, { record } as never);
  return { service, upsert, record };
}

const ctx = { ip: '127.0.0.1', userAgent: 'test', requestId: 'r1' } as never;

describe('settings that nobody has changed', () => {
  it('answer with the registry default rather than nothing', async () => {
    const { service } = build();
    expect(await service.getBoolean('signup.enabled')).toBe(false);
    expect(await service.getNumber('session.idleMinutes')).toBe(20);
  });

  it('say so, so the screen can show what is still as it came', async () => {
    const { service } = build();
    const view = await service.all();
    expect(view.every((s) => s.isCustomised)).toBe(false);
  });
});

describe('signing up', () => {
  it('is off until somebody turns it on', () => {
    /*
     * The decision, written where it can be read. A regulator issues accounts to the operators it
     * has licensed; it does not take applications from whoever finds the address. The portal
     * shipped with this open and the sign-in screen inviting people to use it.
     */
    expect(SETTINGS['signup.enabled'].default).toBe(false);
  });

  it('is on once a row says so', async () => {
    const { service } = build([{ key: 'signup.enabled', value: 'true' }]);
    expect(await service.getBoolean('signup.enabled')).toBe(true);
  });
});

describe('changing a setting', () => {
  it('refuses a key the registry has never heard of', async () => {
    // Otherwise a typo writes a row that nothing reads, and the administrator is looking at a
    // switch that does nothing.
    const { service, upsert } = build();
    await expect(service.set('signup.enabledd', true, 'admin', ctx)).rejects.toThrow(
      BadRequestException,
    );
    expect(upsert).not.toHaveBeenCalled();
  });

  it('refuses a value of the wrong kind', async () => {
    const { service } = build();
    await expect(service.set('signup.enabled', 'yes', 'admin', ctx)).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.set('session.idleMinutes', true, 'admin', ctx)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('refuses a number outside what the setting means', async () => {
    /*
     * A two-minute idle timeout would sign somebody out while they read a page, and a two-day one
     * is not a timeout. The bounds are part of what the setting is, not a suggestion.
     */
    const { service } = build();
    await expect(service.set('session.idleMinutes', 2, 'admin', ctx)).rejects.toThrow(
      /between 5 and 120/,
    );
    await expect(service.set('session.idleMinutes', 3000, 'admin', ctx)).rejects.toThrow(
      /between 5 and 120/,
    );
  });

  it('records both sides of the change', async () => {
    // "When was signing up turned on, and by whom" is a question somebody will ask about a date.
    const { service, record } = build();
    await service.set('signup.enabled', true, 'admin-1', ctx);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'admin-1',
        entityId: 'signup.enabled',
        metadata: expect.objectContaining({ from: false, to: true }),
      }),
    );
  });
});

describe('what an anonymous reader is told', () => {
  it('is only the settings the sign-in screen has to obey', async () => {
    /*
     * The sign-in screen cannot know whether to offer "create an account" without asking, and it
     * asks before it has a token. Everything else stays behind the administrator's door: a list
     * of what a system has switched off is a map for somebody looking for a way in.
     */
    const { service } = build();
    const published = await service.publicValues();
    const keys = Object.keys(published);
    const expected = (Object.keys(SETTINGS) as SettingKey[]).filter((k) => SETTINGS[k].isPublic);
    expect(keys).toEqual(expected);
    // Values only. No labels, no bounds, nothing about what else exists.
    expect(Object.values(published).every((v) => typeof v !== 'object')).toBe(true);
  });
});

describe('a stored row that cannot be read', () => {
  it('falls back to the default instead of to zero', async () => {
    // Zero here would mean "sign everybody out immediately", which is not something a corrupt row
    // should be able to say.
    const { service } = build([{ key: 'session.idleMinutes', value: 'twenty' }]);
    expect(await service.getNumber('session.idleMinutes')).toBe(20);
  });

  it('is pulled back inside the bounds if it is out of them', async () => {
    const { service } = build([{ key: 'session.idleMinutes', value: '99999' }]);
    expect(await service.getNumber('session.idleMinutes')).toBe(120);
  });
});
