import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

/**
 * An optional boolean query parameter, read from the raw query string.
 *
 * A plain `@IsBoolean()` does not survive this app's `enableImplicitConversion`. Implicit
 * conversion runs first and coerces the string `"false"` with `Boolean("false")`, which is `true` —
 * so `?flag=false` arrives as **true**, and a caller switching a feature off silently switches it
 * on. Reading `obj` rather than `value` takes the parameter as the client actually sent it, before
 * anything has had a chance to coerce it.
 *
 * Anything that is not recognisably false is treated as true, so `?flag`, `?flag=1` and
 * `?flag=true` all mean the same thing, which is what a person typing a URL expects.
 */
export function BooleanQuery(name: string) {
  return applyDecorators(
    IsOptional(),
    Transform(({ obj }: { obj: Record<string, unknown> }) => {
      const raw = obj?.[name];
      if (raw === undefined || raw === null || raw === '') return undefined;
      if (raw === false || raw === 'false' || raw === '0' || raw === 0) return false;
      return true;
    }),
    IsBoolean(),
  );
}
