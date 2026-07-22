import { Embeddable } from '../embeddable.interface';

/** A document in the `Project` container. */
export interface ProjectEntity extends Embeddable {
  id: string;
  name?: string;
  description?: string;
  status?: string;
  email?: string;
  askExpert?: string;
  vendor?: string;
  userId?: string;
}
