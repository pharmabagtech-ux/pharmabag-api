import { IsDateString, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * Date range plus the optional product page path.
 *
 * `path` lets the report also match plain page views of the product's detail
 * page, which is how historical traffic is attributed — see
 * `productGeography` for why both identifiers are needed.
 */
export class ProductGeoRangeDto {
  @IsDateString()
  from: string;

  @IsDateString()
  to: string;

  /**
   * Site-relative product page path, e.g. `/products/paracetamol-650-apex`.
   * Constrained to a rooted path so it cannot be used to probe arbitrary
   * stored values.
   */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Matches(/^\/[A-Za-z0-9\-._~/%]*$/, {
    message: 'path must be a site-relative path beginning with /',
  })
  path?: string;
}

/** Validates the `:productId` path segment. */
export class ProductIdParamDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  productId: string;
}
