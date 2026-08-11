/**
 * Layer (a) of the adversary guard: cheap local regexes for well-known
 * injection shapes. Runs first because it costs nothing and cannot fail.
 */
export type AdversarialCategory =
  | 'instruction_override'
  | 'prompt_exfiltration'
  | 'role_override'
  | 'safety_bypass'
  | 'data_exfiltration';

const PATTERNS: Array<{ category: AdversarialCategory; re: RegExp }> = [
  // Instruction override: "ignore all previous instructions"
  {
    category: 'instruction_override',
    re: /\b(ignore|disregard|forget|override)\b[\s\S]{0,40}\b(previous|prior|above|earlier|all|any|your|system)\b[\s\S]{0,25}\b(instructions?|prompts?|rules?|directives?|guidelines?)\b/i,
  },
  {
    category: 'instruction_override',
    re: /\b(these are|here are|follow) (your |my )?new instructions\b/i,
  },
  // System-prompt exfiltration
  {
    category: 'prompt_exfiltration',
    re: /\b(show|reveal|print|display|repeat|output|share|tell me|give me)\b[\s\S]{0,60}\b(system prompt|initial prompt|hidden prompt|original prompt|your (instructions?|prompt|rules?|guidelines?|configuration))\b/i,
  },
  {
    category: 'prompt_exfiltration',
    re: /\bwhat (are|is|were) your (system\s+)?(instructions?|prompt|rules?)\b/i,
  },
  // Role override / jailbreak personas
  { category: 'role_override', re: /\byou are now\b/i },
  { category: 'role_override', re: /\bjailbreak\b/i },
  { category: 'role_override', re: /\bdeveloper mode\b/i },
  {
    category: 'role_override',
    re: /\b(act|behave|roleplay) as\b[\s\S]{0,40}\b(unrestricted|uncensored|unfiltered|dan|jailbroken|evil|rogue)\b/i,
  },
  {
    category: 'role_override',
    re: /\bpretend (to be|you are|you have no)\b/i,
  },
  // Safety / PII filter bypass
  {
    category: 'safety_bypass',
    re: /\b(bypass|disable|ignore|turn off|remove|skip)\b[\s\S]{0,30}\b(safety|guardrails?|filters?|filtering|moderation|restrictions?|censorship|privacy|pii)\b/i,
  },
  {
    category: 'safety_bypass',
    re: /\bwithout (any )?(restrictions?|filters?|limits?|censorship|safety)\b/i,
  },
  // Data exfiltration: other customers' data, bulk dumps
  {
    category: 'data_exfiltration',
    re: /\b(list|dump|show|give me|export|send|share)\b[\s\S]{0,40}\b(all|every|each|other)\b[\s\S]{0,30}\b(users?|customers?|phone numbers?|accounts?|records?|contacts?|data)\b/i,
  },
  {
    category: 'data_exfiltration',
    re: /\bother (customers?|users?|people)['’]?s? (data|numbers?|details|information|messages?)\b/i,
  },
];

export function matchAdversarialPattern(
  text: string,
): { category: AdversarialCategory } | undefined {
  for (const { category, re } of PATTERNS) {
    if (re.test(text)) {
      return { category };
    }
  }
  return undefined;
}
