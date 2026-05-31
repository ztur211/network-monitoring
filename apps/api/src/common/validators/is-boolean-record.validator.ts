import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

/**
 * Validates that a property is a plain object whose every value is a boolean —
 * i.e. a genuine `Record<string, boolean>`.
 *
 * class-validator's `@IsObject()` accepts any non-array object, so a payload
 * like `{ ROUTER: 'yes' }` would slip through, and `@IsBoolean({ each: true })`
 * only applies to arrays, not records. This closes that gap so the API boundary
 * rejects mistyped values instead of trusting the frontend to send booleans.
 *
 * An empty object is valid (vacuously all-boolean). Arrays, `null`, and
 * primitives are not. Pair with `@IsOptional()` to allow the field to be
 * omitted entirely.
 */
export function IsBooleanRecord(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isBooleanRecord',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          if (
            typeof value !== 'object' ||
            value === null ||
            Array.isArray(value)
          ) {
            return false;
          }
          return Object.values(value).every((v) => typeof v === 'boolean');
        },
        defaultMessage(args: ValidationArguments): string {
          return `${args.property} must be an object whose values are all booleans`;
        },
      },
    });
  };
}
