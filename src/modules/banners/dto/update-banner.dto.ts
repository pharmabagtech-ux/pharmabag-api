import { PartialType } from '@nestjs/swagger';
import { CreateBannerDto } from './create-banner.dto';

/**
 * Every field of CreateBannerDto, all optional.
 *
 * Derived with PartialType rather than retyped BY DESIGN. The admin form sends
 * its whole payload on every save and the global pipe runs with
 * forbidNonWhitelisted, so a field added to the create DTO and forgotten here
 * would 400 every edit with a message naming a field the admin never touched —
 * the masterProductId failure of September 2026, which took three days to find
 * because legacy rows without the field kept working and it looked
 * intermittent.
 *
 * Deriving makes that class of bug structurally impossible. Do not replace
 * this with a hand-written class; `banner-dtos.spec.ts` asserts the two key
 * sets are identical and will fail if you do.
 */
export class UpdateBannerDto extends PartialType(CreateBannerDto) {}
