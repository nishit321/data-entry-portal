import { IsDefined } from 'class-validator';

export class UpdateSettingDto {
  /**
   * Deliberately untyped at the edge.
   *
   * A setting is a boolean or a number depending on which one it is, and the registry is what
   * knows which. Validating the shape here would mean a DTO per setting, or a union that lets a
   * boolean through for a number and leaves the service to catch it anyway.
   */
  @IsDefined({ message: 'Give the setting a value.' })
  value!: boolean | number;
}
