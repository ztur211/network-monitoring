import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

export interface StringOrNumberRecordOptions {
  /** Maximum number of keys the record may contain. Default 50. */
  maxKeys?: number;
  /** Maximum length of any string value. Default 1000. */
  maxStringLength?: number;
  /** Maximum absolute magnitude of any numeric value. Default 1e9. */
  maxNumber?: number;
}

const DEFAULT_MAX_KEYS = 50;
const DEFAULT_MAX_STRING_LENGTH = 1000;
const DEFAULT_MAX_NUMBER = 1e9;

/**
 * Validates that a property is a plain object whose every value is EITHER a
 * bounded string or a finite, bounded number — i.e. a genuine
 * `Record<string, string | number>` that can't be used to smuggle an
 * unbounded string or an absurd number past the API boundary.
 *
 * class-validator's `@IsObject()` accepts any non-array object, so a payload
 * like `{ name: '<a megabyte of text>' }` or `{ downMbps: 1e308 }` would slip
 * through. The onboarding state machine already drops wrong-TYPED values
 * (readField/readNumberField), but it does NOT bound size or magnitude, so an
 * over-long string or a huge number would otherwise reach
 * `networksService.createNetwork(...)` internally — bypassing the
 * `@MaxLength`/`@Min`/`@Max` guards on `CreateNetworkDto` that only fire on the
 * public network endpoints. This validator closes that size/magnitude gap.
 *
 * An empty object is valid. Arrays, `null`, and primitives are not. Pair with
 * `@IsOptional()` to allow the field to be omitted entirely.
 */
export function IsStringOrNumberRecord(
  opts: StringOrNumberRecordOptions = {},
  validationOptions?: ValidationOptions,
) {
  const maxKeys = opts.maxKeys ?? DEFAULT_MAX_KEYS;
  const maxStringLength = opts.maxStringLength ?? DEFAULT_MAX_STRING_LENGTH;
  const maxNumber = opts.maxNumber ?? DEFAULT_MAX_NUMBER;

  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isStringOrNumberRecord',
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
          const values = Object.values(value);
          if (values.length > maxKeys) {
            return false;
          }
          return values.every((v) => {
            if (typeof v === 'string') {
              return v.length <= maxStringLength;
            }
            if (typeof v === 'number') {
              return Number.isFinite(v) && Math.abs(v) <= maxNumber;
            }
            return false;
          });
        },
        defaultMessage(args: ValidationArguments): string {
          return (
            `${args.property} must be an object with at most ${maxKeys} entries ` +
            `whose values are each a string (≤ ${maxStringLength} chars) or a ` +
            `finite number (magnitude ≤ ${maxNumber})`
          );
        },
      },
    });
  };
}
