import { Embeddable } from '../embeddable.interface';

/** A document in the `Quote` container. */
export interface QuoteEntity extends Embeddable {
  id: string;
  userName?: string;
  email?: string;
  alternateContactNumber?: string;
  message?: string;
  location?: string;
  quoteStatus?: string;
  userId?: string;
}
