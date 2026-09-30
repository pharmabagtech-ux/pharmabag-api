import { ProductApprovalStatus } from '@prisma/client';

/**
 * A listing cannot be made buyer-visible until an admin has approved it.
 *
 * This one rule was implemented three times as the catalogue guards went in —
 * `ProductsService.assertMayActivate` (a seller PATCHing `isActive: true`),
 * `AdminService.enableProduct` (an admin re-enabling a disabled listing), and
 * now `ProductsService.upsertExistingProduct` (a seller's create-as-upsert
 * republishing a row) — each re-stating "approvalStatus must be APPROVED".
 * One helper, so a future approval state does not have to be remembered in
 * three places.
 *
 * Deliberately just a predicate, not a throwing assertion: the three call
 * sites want different things when it fails — two throw with their own
 * wording, the third silently declines to activate — so the decision belongs
 * here and the reaction stays with the caller.
 */
export function isApprovedForActivation(
  approvalStatus: ProductApprovalStatus,
): boolean {
  return approvalStatus === ProductApprovalStatus.APPROVED;
}
