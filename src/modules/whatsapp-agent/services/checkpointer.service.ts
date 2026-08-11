import { Injectable } from '@nestjs/common';
import { MemorySaver } from '@langchain/langgraph';
import type { BaseCheckpointSaver } from '@langchain/langgraph';

/**
 * Conversation persistence: one LangGraph checkpointer shared by all
 * conversations, with thread_id = the sender's normalized phone number.
 *
 * MemorySaver keeps threads for the lifetime of the process. There is
 * currently no Cosmos-backed LangGraph checkpointer in
 * @langchain/azure-cosmosdb; when one ships (or another official
 * BaseCheckpointSaver is preferred), swap it in via set() without touching
 * the agent.
 */
@Injectable()
export class CheckpointerService {
  private checkpointer: BaseCheckpointSaver = new MemorySaver();

  get(): BaseCheckpointSaver {
    return this.checkpointer;
  }

  set(saver: BaseCheckpointSaver): void {
    this.checkpointer = saver;
  }
}
