import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RequestContext } from '../common/utils/request-context.util';
import {
  BooleanSettingKey,
  NumberSettingKey,
  SETTINGS,
  SettingKey,
  isSettingKey,
  parseSetting,
} from './settings.registry';

/** One setting as an administrator sees it: what it is, what it is set to, and what it can be. */
export interface SettingView {
  key: SettingKey;
  label: string;
  description: string;
  type: 'boolean' | 'number';
  value: boolean | number;
  /** True when a row exists, so the screen can say whether anybody has changed it. */
  isCustomised: boolean;
  min?: number;
  max?: number;
  unit?: string;
}

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Every stored value, as a map. One query, because callers usually want more than one. */
  private async stored(): Promise<Map<string, string>> {
    const rows = await this.prisma.systemSetting.findMany({ select: { key: true, value: true } });
    return new Map(rows.map((r) => [r.key, r.value]));
  }

  private resolve(key: SettingKey, stored: Map<string, string>): boolean | number {
    const raw = stored.get(key);
    return raw === undefined ? SETTINGS[key].default : parseSetting(key, raw);
  }

  async getBoolean(key: BooleanSettingKey): Promise<boolean> {
    return this.resolve(key, await this.stored()) as boolean;
  }

  async getNumber(key: NumberSettingKey): Promise<number> {
    return this.resolve(key, await this.stored()) as number;
  }

  /** The administrator's view: everything, with its bounds, in registry order. */
  async all(): Promise<SettingView[]> {
    const stored = await this.stored();
    return (Object.keys(SETTINGS) as SettingKey[]).map((key) => {
      const definition = SETTINGS[key];
      return {
        key,
        label: definition.label,
        description: definition.description,
        type: definition.type,
        value: this.resolve(key, stored),
        isCustomised: stored.has(key),
        ...(definition.type === 'number'
          ? { min: definition.min, max: definition.max, unit: definition.unit }
          : {}),
      };
    });
  }

  /**
   * What the sign-in screen may know before anybody has signed in.
   *
   * Only the settings marked public, and only their values. A reader who is not signed in has no
   * business learning the shape of the Authority's configuration, and an endpoint that returned
   * everything would hand them one.
   */
  async publicValues(): Promise<Record<string, boolean | number>> {
    const stored = await this.stored();
    const out: Record<string, boolean | number> = {};
    for (const key of Object.keys(SETTINGS) as SettingKey[]) {
      if (SETTINGS[key].isPublic) out[key] = this.resolve(key, stored);
    }
    return out;
  }

  async set(
    key: string,
    value: unknown,
    actorId: string,
    ctx: RequestContext,
  ): Promise<SettingView[]> {
    if (!isSettingKey(key)) {
      throw new BadRequestException(`There is no setting called "${key}".`);
    }
    const definition = SETTINGS[key];

    let raw: string;
    if (definition.type === 'boolean') {
      if (typeof value !== 'boolean') {
        throw new BadRequestException(`"${definition.label}" is either on or off.`);
      }
      raw = String(value);
    } else {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new BadRequestException(`"${definition.label}" has to be a number.`);
      }
      if (value < definition.min || value > definition.max) {
        throw new BadRequestException(
          `"${definition.label}" has to be between ${definition.min} and ${definition.max} ${definition.unit}.`,
        );
      }
      raw = String(value);
    }

    const before = this.resolve(key, await this.stored());
    await this.prisma.systemSetting.upsert({
      where: { key },
      create: { key, value: raw, updatedById: actorId },
      update: { value: raw, updatedById: actorId },
    });

    // Recorded with both sides. "Signup was turned on" is a question somebody will eventually ask
    // about a date, and the answer has to be in the trail rather than in anybody's memory.
    await this.audit.record({
      action: AuditAction.SETTING_UPDATED,
      actorId,
      entityType: 'SystemSetting',
      entityId: key,
      context: ctx,
      metadata: { key, from: before, to: definition.type === 'boolean' ? value : Number(value) },
    });

    return this.all();
  }
}
