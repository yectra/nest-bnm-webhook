import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CrewLlmProvider } from './crew-llm.provider';
import { CrewPlan } from '../interfaces/crew.interfaces';

const PLANNER_SYSTEM_PROMPT = `You are the supervisor of a retrieval crew for a home-services marketplace.
Decide which specialist agents should run for the user's question. Respond with a JSON object:
{
  "useServices": boolean,  // search the service catalog vector index
  "useQuotes": boolean,    // look up the user's own quotes / estimates
  "useImages": boolean,    // analyze pictures attached to quotes or Post Your Requirements forms
  "rationale": string      // one short sentence
}
Rules:
- "useServices" is true unless the question is exclusively about the user's own quotes or pictures.
- "useQuotes" is true when the question mentions quotes, quotations, estimates, approvals, pricing the user requested, or "my" requests.
- "useImages" is true when the question mentions pictures, photos, images, attachments, drawings, or a Post Your Requirements form.`;

const QUOTE_KEYWORDS =
  /\b(quote|quotes|quotation|quotations|estimate|estimates|approval|approved|my request)\b/i;
const IMAGE_KEYWORDS =
  /\b(picture|pictures|photo|photos|image|images|attachment|attachments|drawing|drawings|screenshot|requirement form|post your requirements?)\b/i;

@Injectable()
export class SupervisorAgentService {
  private readonly logger = new Logger(SupervisorAgentService.name);
  private readonly imageAgentEnabled: boolean;

  constructor(
    private readonly llm: CrewLlmProvider,
    config: ConfigService,
  ) {
    const flag = config.get<boolean | string>('AGENT_CREW_IMAGE_AGENT_ENABLED');
    this.imageAgentEnabled = flag === true || flag === 'true';
  }

  /** Plan the crew run with GPT-5; fall back to keyword heuristics on failure. */
  async plan(question: string): Promise<CrewPlan> {
    const fallback = this.heuristicPlan(question);

    const parsed = await this.llm.completeJson<Partial<CrewPlan>>(
      PLANNER_SYSTEM_PROMPT,
      `User question: ${question}`,
    );

    if (!parsed || typeof parsed.useServices !== 'boolean') {
      this.logger.warn(
        'Supervisor LLM plan unavailable, using keyword heuristic plan',
      );
      return fallback;
    }

    const plan: CrewPlan = {
      useServices: parsed.useServices ?? fallback.useServices,
      useQuotes: parsed.useQuotes ?? fallback.useQuotes,
      useImages:
        this.imageAgentEnabled && (parsed.useImages ?? fallback.useImages),
      rationale:
        typeof parsed.rationale === 'string' && parsed.rationale.length > 0
          ? parsed.rationale
          : fallback.rationale,
    };

    // Never plan an empty crew: services retrieval is the safe default.
    if (!plan.useServices && !plan.useQuotes && !plan.useImages) {
      plan.useServices = true;
    }
    return plan;
  }

  private heuristicPlan(question: string): CrewPlan {
    const useQuotes = QUOTE_KEYWORDS.test(question);
    const useImages = this.imageAgentEnabled && IMAGE_KEYWORDS.test(question);
    return {
      useServices: true,
      useQuotes,
      useImages,
      rationale: 'Keyword heuristic plan (LLM planner unavailable)',
    };
  }
}
