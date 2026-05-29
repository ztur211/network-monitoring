import { Allow, IsString } from 'class-validator';

/**
 * A single field-level change in an optimistic-concurrency PATCH changeset.
 * Shared by every entity's Patch DTO (devices, networks, circuits, fiber-runs,
 * connections), which previously each declared a byte-identical copy. Each
 * PatchXDto keeps its own ArrayMinSize/ArrayMaxSize bounds on the `changes`
 * array — only the per-element shape is shared here.
 */
export class ChangesetChangeDto {
  @IsString()
  field: string;

  @Allow()
  oldValue: unknown;

  @Allow()
  newValue: unknown;
}
