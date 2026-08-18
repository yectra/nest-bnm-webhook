import { PromptInjectionRule } from '../interfaces/prompt-injection.interface';

/**
 * Heuristic rule set for the adversarial-input guard.
 *
 * These run against the "Post Your Requirements" free-text the customer typed,
 * so they must stay biased towards genuine attack grammar: a homeowner
 * describing a kitchen renovation must never trip them. Every pattern is
 * case-insensitive and matched against whitespace-normalized text.
 */
export const PROMPT_INJECTION_RULES: PromptInjectionRule[] = [
  // --- Instruction override -------------------------------------------------
  {
    id: 'override.ignore-previous',
    label: 'Ignore/disregard previous instructions',
    category: 'instruction-override',
    severity: 'critical',
    pattern:
      /\b(ignore|disregard|forget|discard|bypass)\b[^.?!]{0,40}\b(all\s+)?(previous|prior|above|earlier|preceding|initial|original|system)\b[^.?!]{0,20}\b(instruction|instructions|prompt|prompts|rule|rules|message|messages|context|directive|directives)\b/i,
  },
  {
    id: 'override.forget-everything',
    label: 'Forget everything / start over as a new agent',
    category: 'instruction-override',
    severity: 'high',
    pattern:
      /\b(forget|erase|wipe|clear)\b[^.?!]{0,20}\b(everything|all)\b[^.?!]{0,30}\b(you\s+(were|have\s+been)\s+told|above|before|so\s+far|your\s+training)\b/i,
  },
  {
    id: 'override.new-objective',
    label: 'Replaces the agent objective',
    category: 'instruction-override',
    severity: 'high',
    pattern:
      /\byour\s+(new|real|actual|only|true)\s+(task|goal|objective|job|purpose|instruction|instructions|mission)\s+(is|are)\b/i,
  },
  {
    id: 'override.regardless-of',
    label: 'Demands compliance regardless of the system prompt',
    category: 'instruction-override',
    severity: 'medium',
    pattern:
      /\b(regardless|no\s+matter)\s+(of\s+)?(what|whatever)\b[^.?!]{0,40}\b(system|instructions?|rules?|prompt|policy|guidelines?|you\s+were\s+told)\b/i,
  },

  // --- System prompt / context extraction -----------------------------------
  {
    id: 'extraction.system-prompt',
    label: 'Asks the agent to reveal its system prompt',
    category: 'prompt-extraction',
    severity: 'critical',
    pattern:
      /\b(reveal|show|print|repeat|output|display|expose|dump|share|tell\s+me|give\s+me|what\s+(is|are|were))\b[^.?!]{0,40}\b(system|initial|original|hidden|internal|developer)\s+(prompt|prompts|instruction|instructions|message|messages|rules?)\b/i,
  },
  {
    id: 'extraction.repeat-above',
    label: 'Asks the agent to repeat everything above / verbatim context',
    category: 'prompt-extraction',
    severity: 'high',
    pattern:
      /\b(repeat|print|output|echo|recite)\b[^.?!]{0,30}\b(everything|all\s+(of\s+)?(the\s+)?(text|content|words))\b[^.?!]{0,20}\b(above|before\s+this|you\s+(were\s+)?(given|told))\b|\brepeat\s+the\s+(words|text)\s+above\s+(starting|verbatim)\b/i,
  },
  {
    id: 'extraction.configuration',
    label: 'Probes model/tool configuration',
    category: 'prompt-extraction',
    severity: 'medium',
    pattern:
      /\b(list|show|tell\s+me|what)\b[^.?!]{0,30}\b(tools?|functions?|plugins?|api\s+keys?|credentials?|secrets?|environment\s+variables?|env\s+vars?)\b[^.?!]{0,30}\b(you\s+(have|can\s+(use|call|access))|available\s+to\s+you|are\s+configured)\b/i,
  },
  {
    id: 'extraction.credentials',
    label: 'Requests keys, secrets or credentials',
    category: 'credential-probe',
    severity: 'high',
    pattern:
      /\b(reveal|show|give|share|send|print|leak|what\s+is)\b[^.?!]{0,30}\b(api[\s_-]?key|access[\s_-]?token|bearer\s+token|password|secret\s+key|connection\s+string|credentials?)\b/i,
  },

  // --- Role / persona manipulation ------------------------------------------
  {
    id: 'role.you-are-now',
    label: 'Reassigns the agent persona',
    category: 'role-manipulation',
    severity: 'high',
    pattern:
      /\b(you\s+are\s+now|from\s+now\s+on\s+you\s+(are|will|must)|you\s+will\s+now\s+(act|behave|respond)|act\s+as\s+(if\s+you\s+are\s+)?(an?\s+)?(unrestricted|uncensored|unfiltered|evil|different)|pretend\s+(to\s+be|you\s+are)|roleplay\s+as|simulate\s+being)\b/i,
  },
  {
    id: 'role.jailbreak-persona',
    label: 'Known jailbreak persona / developer mode',
    category: 'jailbreak',
    severity: 'critical',
    pattern:
      /\b(dan\s+mode|do\s+anything\s+now|developer\s+mode|god\s+mode|jailbreak(ing|en)?|sudo\s+mode|root\s+mode|opposite\s+day|stay\s+in\s+character\s+as)\b/i,
  },
  {
    id: 'role.chat-turn-spoof',
    label: 'Spoofed chat role turn (system:/assistant:)',
    category: 'context-spoofing',
    severity: 'high',
    pattern:
      /(^|\n|\s)(system|assistant|developer|tool)\s*[:>]\s*(you|your|ignore|now|the|new|always|respond|reply|act)\b/i,
  },
  {
    id: 'role.chat-template-tokens',
    label: 'Chat-template control tokens in user text',
    category: 'context-spoofing',
    severity: 'critical',
    pattern:
      /<\|(im_start|im_end|system|user|assistant|endoftext|eot_id|start_header_id|end_header_id)\|>|\[\/?INST\]|<<\s*SYS\s*>>|<\/?(system|assistant)>|###\s*(system|instruction)\s*:/i,
  },
  {
    id: 'role.fake-boundary',
    label: 'Fake prompt boundary / new system block',
    category: 'context-spoofing',
    severity: 'high',
    pattern:
      /\b(begin|start|end\s+of)\s+(new\s+)?(system|admin|developer)\s+(prompt|message|instructions?|block)\b|-{3,}\s*(system|admin)\s+(prompt|instructions?)\s*-{3,}/i,
  },
  {
    id: 'role.authority-claim',
    label: 'Claims administrator/developer authority',
    category: 'social-engineering',
    severity: 'medium',
    pattern:
      /\b(i\s+am|this\s+is|as)\s+(the\s+)?(your\s+)?(system\s+)?(admin|administrator|developer|openai|anthropic|engineer)\b[^.?!]{0,40}\b(override|authorize|permission|instruct|command|allow)\b/i,
  },

  // --- Guardrail bypass -----------------------------------------------------
  {
    id: 'bypass.no-restrictions',
    label: 'Demands operation without restrictions/filters',
    category: 'jailbreak',
    severity: 'high',
    pattern:
      /\b(without|no|ignore|disable|turn\s+off|remove|skip)\b[^.?!]{0,25}\b(restrictions?|filters?|guardrails?|safety\s+(rules?|checks?|guidelines?)|content\s+polic(y|ies)|moderation|censorship|limitations?)\b/i,
  },
  {
    id: 'bypass.not-bound',
    label: 'Asserts the agent is not bound by its rules',
    category: 'jailbreak',
    severity: 'medium',
    pattern:
      /\b(you\s+are\s+(no\s+longer|not)\s+bound|rules?\s+(do\s+not|don't)\s+apply|you\s+(can|may)\s+(now\s+)?ignore\s+(your|the)\s+(rules?|policy|guidelines?))\b/i,
  },

  // --- Output manipulation --------------------------------------------------
  {
    id: 'output.forced-response',
    label: 'Forces a fixed reply regardless of the question',
    category: 'output-manipulation',
    severity: 'medium',
    pattern:
      /\b(always|only|just)\s+(respond|reply|answer|say|output|return)\s+(with|by\s+saying)\b|\byour\s+(response|reply|answer)\s+must\s+(only\s+)?(be|contain)\b[^.?!]{0,30}\b(exactly|verbatim|nothing\s+else)\b/i,
  },
  {
    id: 'output.approve-anything',
    label: 'Attempts to force a business decision (quote/approval)',
    category: 'business-logic-abuse',
    severity: 'high',
    pattern:
      /\b(approve|authorize|confirm|mark|set|give|apply)\b[^.?!]{0,30}\b(this\s+)?(order|quote|quotation|requirement|request|lead|booking|invoice|discount|price|refund)\b[^.?!]{0,30}\b(automatically|as\s+(approved|paid|free|verified)|100%|free\s+of\s+charge|without\s+(review|approval|verification))\b/i,
  },

  // --- Tool / command / data-store abuse ------------------------------------
  {
    id: 'abuse.command-execution',
    label: 'Requests shell/code execution',
    category: 'tool-abuse',
    severity: 'critical',
    pattern:
      /\b(execute|run|eval)\b[^.?!]{0,25}\b(command|shell|bash|script|code|python|node)\b|\b(rm\s+-rf\s+\/|os\.system\s*\(|subprocess\.(run|popen)|child_process|eval\s*\(\s*(atob|require))/i,
  },
  {
    id: 'abuse.sql-injection',
    label: 'SQL/NoSQL injection payload',
    category: 'injection-payload',
    severity: 'critical',
    pattern:
      /\b(drop|truncate|delete\s+from|update)\s+(table|database|container|from)\b|\bunion\s+select\b|'\s*(or|and)\s+'?1'?\s*=\s*'?1|--\s*$|\$where\s*:|\{\s*\$ne\s*:/i,
  },
  {
    id: 'abuse.tool-invocation',
    label: 'Attempts to invoke agent tools/functions directly',
    category: 'tool-abuse',
    severity: 'high',
    pattern:
      /\b(call|invoke|use|trigger)\s+(the\s+)?(tool|function|api|endpoint|webhook|mcp\s+server)\b[^.?!]{0,30}\b(with|named|called|to)\b|"(tool_calls?|function_call)"\s*:/i,
  },

  // --- Data exfiltration ----------------------------------------------------
  {
    id: 'exfil.send-data',
    label: 'Asks the agent to send data to an external destination',
    category: 'data-exfiltration',
    severity: 'critical',
    pattern:
      /\b(send|forward|email|post|upload|transmit|leak|exfiltrate)\b[^.?!]{0,40}\b(conversation|chat\s+history|context|prompt|data|details|records?|customer\s+(data|list|details)|database|documents?)\b[^.?!]{0,30}\b(to|at)\b[^.?!]{0,30}(https?:\/\/|@|\bwebhook\b|\bserver\b)/i,
  },
  {
    id: 'exfil.markdown-beacon',
    label: 'Markdown image/link beacon pointing at an external host',
    category: 'data-exfiltration',
    severity: 'high',
    pattern: /!\[[^\]]*\]\(\s*https?:\/\/[^)]*(\?|&)[^)]*=[^)]*\)/i,
  },

  // --- Obfuscation ----------------------------------------------------------
  {
    id: 'obfuscation.decode-and-follow',
    label: 'Asks the agent to decode and follow hidden content',
    category: 'obfuscation',
    severity: 'high',
    pattern:
      /\b(decode|decrypt|un-?scramble|base64|rot13|reverse)\b[^.?!]{0,40}\b(then|and)\b[^.?!]{0,25}\b(follow|execute|run|obey|do|apply)\b/i,
  },
  {
    id: 'obfuscation.hidden-characters',
    label: 'Zero-width or bidirectional control characters',
    category: 'obfuscation',
    severity: 'medium',
    // Zero-width space/joiner/BOM plus RTL/LTR overrides used to hide payloads.
    pattern: /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/,
  },
];

/** Weight each severity contributes to the aggregate score. */
export const SEVERITY_WEIGHT: Record<string, number> = {
  low: 1,
  medium: 2,
  high: 4,
  critical: 6,
};
