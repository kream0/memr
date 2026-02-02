import type { Event, Belief, BeliefDomain } from '../types.js';

export function formatEventsForPrompt(events: Event[], maxLength: number = 4000): string {
  const formatted = events.map((e) => {
    const parts = [`[${e.type}] ${new Date(e.timestamp).toISOString()}`];

    if (e.payload.tool_name) {
      parts.push(`Tool: ${e.payload.tool_name}`);
    }
    if (e.payload.message_content) {
      parts.push(`Message: ${e.payload.message_content.slice(0, 200)}`);
    }
    if (e.payload.file_path) {
      parts.push(`File: ${e.payload.file_path}`);
    }
    if (e.payload.error_message) {
      parts.push(`Error: ${e.payload.error_message.slice(0, 100)}`);
    }

    return `Event ${e.id}:\n${parts.join('\n')}`;
  });

  let result = formatted.join('\n\n');

  if (result.length > maxLength) {
    result = result.slice(0, maxLength) + '\n... (truncated)';
  }

  return result;
}

export function formatBeliefsForPrompt(beliefs: Belief[], maxLength: number = 2000): string {
  const formatted = beliefs.map((b) => {
    return `[${b.domain}] (confidence: ${b.confidence.toFixed(2)}, importance: ${b.importance})
"${b.text}"
Evidence: ${b.evidence_ids.length} events, ${b.supporting_count} supporting, ${b.contradicting_count} contradicting`;
  });

  let result = formatted.join('\n\n');

  if (result.length > maxLength) {
    result = result.slice(0, maxLength) + '\n... (truncated)';
  }

  return result;
}

export function buildInferencePrompt(
  events: Event[],
  existingBeliefs: Belief[],
  domain?: BeliefDomain
): string {
  const domainFilter = domain ? `Focus on the "${domain}" domain.` : 'Consider all relevant domains.';

  return `Analyze these recent events and derive 0-3 new beliefs or updates to existing beliefs.

${domainFilter}

EVENTS:
${formatEventsForPrompt(events)}

EXISTING BELIEFS:
${existingBeliefs.length > 0 ? formatBeliefsForPrompt(existingBeliefs) : '(none)'}

Derive conclusions that are:
1. Supported by multiple events when possible
2. Specific and actionable
3. Not redundant with existing beliefs (unless updating them)

For each new belief, provide:
- text: The belief statement
- domain: One of: code_pattern, user_preference, project_structure, workflow, decision, constraint
- confidence: 0.0-1.0 based on evidence strength
- evidence_ids: Event IDs that support this (from above)
- importance: 1-10
- tags: Relevant keywords

If an existing belief should be updated or invalidated, explain why.`;
}

export function buildContradictionPrompt(event: Event, belief: Belief): string {
  return `Does this event contradict the belief?

EVENT:
Type: ${event.type}
Time: ${new Date(event.timestamp).toISOString()}
${event.payload.tool_name ? `Tool: ${event.payload.tool_name}` : ''}
${event.payload.message_content ? `Message: ${event.payload.message_content.slice(0, 500)}` : ''}
${event.payload.file_path ? `File: ${event.payload.file_path}` : ''}
${event.payload.error_message ? `Error: ${event.payload.error_message}` : ''}

BELIEF:
"${belief.text}"
Domain: ${belief.domain}
Confidence: ${belief.confidence}

Relationship: SUPPORTS | NEUTRAL | WEAKLY_CONTRADICTS | STRONGLY_CONTRADICTS`;
}
