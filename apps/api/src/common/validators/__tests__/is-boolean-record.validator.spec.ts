// reflect-metadata must load before any decorated class below is defined.
// This spec does not import @nestjs/core (which pulls it in transitively for the
// service specs), so we load the polyfill explicitly.
import 'reflect-metadata';
import { IsOptional, validateSync } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { IsBooleanRecord } from '../is-boolean-record.validator';
import { UpdatePreferencesDto } from '../../../users/users.dto';

// Mirrors a DTO field that is both optional and a boolean-record.
class OptionalHolder {
  @IsOptional()
  @IsBooleanRecord()
  toggles?: Record<string, boolean>;
}

// Isolates the validator's own logic from @IsOptional's null/undefined skip.
class RequiredHolder {
  @IsBooleanRecord()
  toggles!: unknown;
}

const optionalErrors = (toggles: unknown) =>
  validateSync(plainToInstance(OptionalHolder, { toggles }));
const requiredErrors = (toggles: unknown) =>
  validateSync(plainToInstance(RequiredHolder, { toggles }));

describe('IsBooleanRecord', () => {
  it('accepts a record whose values are all booleans', () => {
    expect(optionalErrors({ ROUTER: true, SWITCH: false })).toHaveLength(0);
  });

  it('accepts an empty object', () => {
    expect(requiredErrors({})).toHaveLength(0);
  });

  it('rejects a record with a non-boolean value', () => {
    const errors = requiredErrors({ ROUTER: 'yes' });
    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('isBooleanRecord');
  });

  it('rejects a record mixing boolean and non-boolean values', () => {
    expect(requiredErrors({ ROUTER: true, SWITCH: 1 })).toHaveLength(1);
  });

  it('rejects an array', () => {
    expect(requiredErrors([])).toHaveLength(1);
  });

  it('rejects a primitive string', () => {
    expect(requiredErrors('nope')).toHaveLength(1);
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

describe('UpdatePreferencesDto.layerToggles wiring', () => {
  it('rejects non-boolean layerToggles values through the real DTO', () => {
    const errors = validateSync(
      plainToInstance(UpdatePreferencesDto, { layerToggles: { ROUTER: 'yes' } }),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('layerToggles');
    expect(errors[0].constraints).toHaveProperty('isBooleanRecord');
  });

  it('accepts boolean layerToggles values through the real DTO', () => {
    expect(
      validateSync(
        plainToInstance(UpdatePreferencesDto, { layerToggles: { ROUTER: true } }),
      ),
    ).toHaveLength(0);
  });
});
