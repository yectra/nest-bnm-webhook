import { Embeddable } from '../embeddable.interface';

/** A document in the `AskOurExpert` container. */
export interface ExpertEntity extends Embeddable {
  id: string;
  name?: string;
  description?: string;
  specialization?: string;
  status?: string;
  userId?: string;
}
