// reflect-metadata must load before any decorated class below is defined.
// This spec does not import @nestjs/core (which pulls it in transitively for the
// service specs), so we load the polyfill explicitly.
import 'reflect-metadata';
import { IsOptional, validateSync } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { IsStringOrNumberRecord } from '../is-string-or-number-record.validator';
import { OnboardingTurnDto } from '../../../onboarding/onboarding.dto';

// Mirrors a DTO field that is both optional and a string-or-number record,
// with the same options the real DTO applies.
class OptionalHolder {
  @IsOptional()
  @IsStringOrNumberRecord({ maxStringLength: 1000 })
  values?: Record<string, string | number>;
}

// Isolates the validator's own logic from @IsOptional's null/undefined skip.
class RequiredHolder {
  @IsStringOrNumberRecord({ maxStringLength: 1000 })
  values!: unknown;
}

const optionalErrors = (values: unknown) =>
  validateSync(plainToInstance(OptionalHolder, { values }));
const requiredErrors = (values: unknown) =>
  validateSync(plainToInstance(RequiredHolder, { values }));

describe('IsStringOrNumberRecord', () => {
  it('accepts a record mixing string and number values', () => {
    expect(optionalErrors({ name: 'home', downMbps: 100 })).toHaveLength(0);
  });

  it('accepts an empty object', () => {
    expect(requiredErrors({})).toHaveLength(0);
  });

  it('accepts a string at exactly the max length', () => {
    expect(requiredErrors({ name: 'a'.repeat(1000) })).toHaveLength(0);
  });

  it('rejects an over-long string value', () => {
    const errors = requiredErrors({ name: 'a'.repeat(1001) });
    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('isStringOrNumberRecord');
  });

  it('rejects Infinity', () => {
    expect(requiredErrors({ downMbps: Infinity })).toHaveLength(1);
  });

  it('rejects NaN', () => {
    expect(requiredErrors({ downMbps: NaN })).toHaveLength(1);
  });

  it('rejects a number above the magnitude cap', () => {
    expect(requiredErrors({ downMbps: 1e9 + 1 })).toHaveLength(1);
  });

  it('rejects a number below the negative magnitude cap', () => {
    expect(requiredErrors({ downMbps: -(1e9 + 1) })).toHaveLength(1);
  });

  it('accepts a number at exactly the magnitude cap', () => {
    expect(requiredErrors({ downMbps: 1e9 })).toHaveLength(0);
  });

  it('rejects a record with a boolean value (neither string nor number)', () => {
    expect(requiredErrors({ flag: true })).toHaveLength(1);
  });

  it('rejects a record with more than maxKeys entries', () => {
    const tooMany: Record<string, number> = {};
    for (let i = 0; i < 51; i++) tooMany[`k${i}`] = i;
    expect(requiredErrors(tooMany)).toHaveLength(1);
  });

  it('rejects an array', () => {
    expect(requiredErrors([])).toHaveLength(1);
  });

  it('rejects a primitive string', () => {
    expect(requiredErrors('nope')).toHaveLength(1);
  });

  it('rejects a primitive number', () => {
    expect(requiredErrors(5)).toHaveLength(1);
  });

  it('rejects null and undefined when the field is required', () => {
    expect(requiredErrors(null)).toHaveLength(1);
    expect(requiredErrors(undefined)).toHaveLength(1);
  });

  it('skips null/undefined when paired with @IsOptional', () => {
    expect(optionalErrors(undefined)).toHaveLength(0);
    expect(optionalErrors(null)).toHaveLength(0);
  });
});

describe('OnboardingTurnDto.fieldValues wiring', () => {
  it('rejects an over-long string field value through the real DTO', () => {
    const errors = validateSync(
      plainToInstance(OnboardingTurnDto, {
        browserDeviceId: 'browser-1',
        fieldValues: { name: 'a'.repeat(1001) },
      }),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('fieldValues');
    expect(errors[0].constraints).toHaveProperty('isStringOrNumberRecord');
  });

  it('accepts a bounded string + finite number through the real DTO', () => {
    expect(
      validateSync(
        plainToInstance(OnboardingTurnDto, {
          browserDeviceId: 'browser-1',
          fieldValues: { name: 'home', downMbps: 100 },
        }),
      ),
    ).toHaveLength(0);
  });

  it('accepts the DTO with fieldValues omitted entirely', () => {
    expect(
      validateSync(
        plainToInstance(OnboardingTurnDto, { browserDeviceId: 'browser-1' }),
      ),
    ).toHaveLength(0);
  });
});
