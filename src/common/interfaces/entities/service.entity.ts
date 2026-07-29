import { Embeddable } from '../embeddable.interface';

/** A document in the `Service` container. */
export interface ServiceEntity extends Embeddable {
  id: string;
  name?: string;
  description?: string;
  status?: string;
  location?: string;
  category?: string;
  /** Owner user id; absent on public/global services. */
  userId?: string;
}
