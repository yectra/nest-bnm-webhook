import { IsObject, IsOptional, IsString } from 'class-validator';

/**
 * Event Grid envelope accepted by the manual test endpoint. Mirrors the shape
 * Azure Event Grid delivers, so the same payload can be replayed by hand.
 */
export class RequirementsEventDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsOptional()
  @IsString()
  eventType?: string;

  @IsOptional()
  @IsString()
  subject?: string;

  @IsOptional()
  @IsString()
  topic?: string;

  @IsOptional()
  @IsString()
  eventTime?: string;

  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;
}
