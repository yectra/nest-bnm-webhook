import { Embeddable } from '../embeddable.interface';

/** A document in the `Vendor` container. */
export interface VendorEntity extends Embeddable {
  id: string;
  companyName?: string;
  publicUrl?: string;
  status?: string;
  productServiceOfferings?: string;
  locationOfService?: string;
  userId?: string;
}
