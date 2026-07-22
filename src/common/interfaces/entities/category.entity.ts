import { Embeddable } from '../embeddable.interface';

/** A document in the `Category` container (global/shared, not user-scoped). */
export interface CategoryEntity extends Embeddable {
  id: string;
  name?: string;
  description?: string;
}
