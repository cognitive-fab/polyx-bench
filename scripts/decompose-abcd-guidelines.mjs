#!/usr/bin/env node
// Decompose the ABCD guidelines into atomic clauses (TS §9.1).
//
// Reads the ANSWER KEY — corpora/abcd/kb.json (subflow → ordered buttons) and
// corpora/abcd/guidelines.json (the text) — and writes policies/abcd-guidelines.yaml.
// This script lives under scripts/, outside the boundary check's reach, and
// nothing under src/ except src/evaluate reads what it writes.
//
// A clause is one precedence relation inside one subflow: "in S, X comes
// after Y", for every ordered pair (Y before X) in S's action list. Whether
// polyx can even state it — `expressible` — depends on the alphabet: the
// subject must be a consequential action and the guard an action. A clause
// about "record reason after pull up account" is real guidance polyx cannot
// represent, and it is counted as such rather than quietly dropped.
//
// Every free-text instruction ("wrap up by nicely asking…") is an
// inexpressible clause too. Recall is reported over expressible clauses only,
// with the inexpressible count beside it (TS §9.1).
//
// Mechanical, reproducible, and reviewed by a person once: the `review`
// block at the top records who read it and what they changed.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// The corpora and alphabets live in the polyx checkout; the clause sets live
// here. Point POLYX_ROOT at the sibling checkout when it is somewhere else.
const polyx = process.env.POLYX_ROOT ?? join(root, '..', 'polyx');
const kb = JSON.parse(readFileSync(join(polyx, 'corpora/abcd/kb.json'), 'utf8'));
const guidelines = JSON.parse(readFileSync(join(polyx, 'corpora/abcd/guidelines.json'), 'utf8'));
const ontology = JSON.parse(readFileSync(join(polyx, 'corpora/abcd/ontology.json'), 'utf8'));
const alphabet = parse(readFileSync(join(polyx, 'alphabets/alphabet.abcd.yaml'), 'utf8'));

// button → alphabet type, via the alphabet's own match rules (the same
// mapping ingestion applies, so a clause names the type a rule would name).
const typeOf = new Map();
for (const t of alphabet.event_types) {
  const b = t.match?.button;
  if (b === undefined) continue;
  for (const button of Array.isArray(b) ? b : [b]) typeOf.set(button, t);
}
const consequential = new Set(alphabet.event_types.filter((t) => t.consequential && t.reversibility !== 'free').map((t) => t.id));

// guideline subflow names ↔ ontology ids, by position within each flow
const flowTitle = {
  account_access: 'Account Access', manage_account: 'Manage Account', order_issue: 'Order Issue', product_defect: 'Product Defect',
  purchase_dispute: 'Purchase Dispute', shipping_issue: 'Shipping Issue', single_item_query: 'Single-Item Query',
  storewide_query: 'Storewide Query', subscription_inquiry: 'Subscription Inquiry', troubleshoot_site: 'Troubleshoot Site',
};
const titleOf = new Map();
const instructionsOf = new Map();
for (const [flow, subflows] of Object.entries(ontology.intents.subflows)) {
  const g = guidelines[flowTitle[flow]];
  const names = Object.keys(g.subflows);
  subflows.forEach((id, i) => {
    titleOf.set(id, names[i]);
    instructionsOf.set(id, g.subflows[names[i]].instructions ?? []);
  });
}

// Subflows whose guidelines explicitly free the order of actions. kb.json
// still lists their buttons in *an* order, but the rulebook does not assert
// it, so no precedence clause from these flows belongs in the recall
// denominator — scoring polyx against them marks it down for failing to find
// rules the policy declines to make. Ruled on by a human, 29 Aug 2026; the
// quote is the justification and the cross-check below catches any new ones.
const ORDER_IS_FREE = {
  credit_card: 'Choose these in any order.',
  shopping_cart: 'Choose these in any order.',
  search_results: 'Option 1 … Option 5 — a menu of alternatives, not a sequence.',
  slow_speed: 'Pick these actions in any order you wish. Feel free to be creative.',
};
{
  const ORDERLESS = /in any order|any order you wish|pick these actions|choose these in/i;
  for (const [subflow, g] of [...titleOf].map(([id]) => [id, guidelines[flowTitle[Object.entries(ontology.intents.subflows).find(([, v]) => v.includes(id))[0]]].subflows[titleOf.get(id)]])) {
    const text = [...(g.instructions ?? []), ...g.actions.flatMap((a) => [a.text, ...(a.subtext ?? [])])].filter((x) => typeof x === 'string');
    if (text.some((x) => ORDERLESS.test(x)) && !(subflow in ORDER_IS_FREE)) {
      console.error(`WARNING: ${subflow} reads as order-free but is not in ORDER_IS_FREE — a person should rule on it`);
    }
  }
}

// Subflows that occur in the CONVERSATIONS but have no entry in kb.json, so no
// clause can ever be written for them and any rule mined there can never
// align. kb.json keys the FAQ flows coarsely ('pricing') while the data labels
// them finely ('pricing_1'..'pricing_4'); two more are simply absent. The
// effect on the headline figures is 2 rules of 87 — but a gap in an answer key
// has to be visible rather than silent (human ruling, 29 Aug 2026).
const uncovered = [];
{
  const corpusFile = join(polyx, 'corpora/abcd/abcd_v1.1.json');
  if (existsSync(corpusFile)) {
    const d = JSON.parse(readFileSync(corpusFile, 'utf8'));
    const counts = new Map();
    for (const split of ['train', 'dev', 'test']) for (const c of d[split] ?? []) counts.set(c.scenario.subflow, (counts.get(c.scenario.subflow) ?? 0) + 1);
    for (const [sub, n] of [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))) if (!(sub in kb)) uncovered.push({ subflow: sub, conversations: n });
    if (uncovered.length) {
      const tot = uncovered.reduce((a, b) => a + b.conversations, 0);
      console.error('NOTE: ' + uncovered.length + ' subflow(s) occur in the conversations with no kb.json entry (' + tot + ' conversations). No clause covers them; a rule mined there can never align.');
    }
  } else {
    console.error('NOTE: corpus not present, so subflow coverage was not checked');
  }
}

const clauses = [];
let inexpressible = 0;
for (const [subflow, buttons] of Object.entries(kb)) {
  const title = titleOf.get(subflow) ?? subflow;
  const orderFree = ORDER_IS_FREE[subflow];
  for (let i = 0; i < buttons.length; i++) {
    for (let j = 0; j < i; j++) {
      const x = typeOf.get(buttons[i]);
      const y = typeOf.get(buttons[j]);
      const subject = x?.id ?? `?:${buttons[i]}`;
      const guard = y?.id ?? `?:${buttons[j]}`;
      const kindOf = (t) => t.kind ?? (t.match?.speaker === 'action' ? 'action' : 'other');
      const expressible = !orderFree && Boolean(x && y && consequential.has(x.id) && kindOf(y) === 'action');
      const reason = orderFree
        ? `the guidelines free the order in this subflow: "${orderFree}"`
        : !x || !y
          ? 'button not in the alphabet'
          : !consequential.has(x.id)
            ? 'subject is not a consequential action'
            : kindOf(y) !== 'action'
              ? 'guard is not an action'
              : undefined;
      if (!expressible) inexpressible++;
      clauses.push({
        id: `c-${subflow}-${buttons[i]}-${buttons[j]}`,
        text: `In ${title}, [${buttons[i]}] comes after [${buttons[j]}].`,
        expressible,
        ...(reason ? { reason } : {}),
        shape: 'precedence',
        subject,
        guard,
        // Whether the rulebook lists these two buttons next to each other.
        // A sequential policy is violated by doing E before A, so every pair
        // is a clause — but 173 pairs are not 173 independent facts, so
        // recall is reported over both denominators (human ruling, 29 Aug 2026).
        adjacent: i - j === 1,
        when: { fact: 'episode.intent', value: `intent:${subflow}` },
      });
    }
  }
  for (const [k, text] of instructionsOf.get(subflow).entries()) {
    inexpressible++;
    clauses.push({ id: `c-${subflow}-instruction-${k}`, text: `In ${title}: ${text}`, expressible: false, reason: 'free-text instruction' });
  }
}

const doc = {
  policy: 'abcd-guidelines',
  version: 1,
  source: 'corpora/abcd/kb.json (subflow → ordered actions) and corpora/abcd/guidelines.json (text); decomposed by scripts/decompose-abcd-guidelines.mjs',
  review: {
    decomposition: 'mechanical: every ordered pair within a subflow is one precedence clause, marked adjacent when the rulebook lists the two buttons next to each other; every instruction line is one inexpressible clause; subflows whose guidelines free the order contribute no expressible clause',
    read_by: 'sampled and ruled on by the operator, 29 Aug 2026: (1) the four Troubleshoot Site subflows that say "in any order" contribute no expressible clause; (2) non-adjacent pairs are kept, because a sequential policy is violated by doing E before A, and recall is reported over both the all-pairs and adjacent-only denominators',
  },
  uncovered,
  counts: {
    clauses: clauses.length,
    expressible: clauses.length - inexpressible,
    inexpressible,
    expressibleAdjacent: clauses.filter((c) => c.expressible && c.adjacent).length,
  },
  clauses,
};

const yaml = [];
yaml.push(`# Generated by scripts/decompose-abcd-guidelines.mjs — the ABCD answer key, decomposed.`);
yaml.push(`# EVALUATION INPUT. Read only by src/evaluate. Never by the miner.`);
yaml.push(`policy: ${doc.policy}`);
yaml.push(`version: ${doc.version}`);
yaml.push(`source: ${JSON.stringify(doc.source)}`);
yaml.push(`review:`);
yaml.push(`  decomposition: ${JSON.stringify(doc.review.decomposition)}`);
yaml.push(`  read_by: ${JSON.stringify(doc.review.read_by)}`);
yaml.push(`counts: { clauses: ${doc.counts.clauses}, expressible: ${doc.counts.expressible}, inexpressible: ${doc.counts.inexpressible}, expressible_adjacent: ${doc.counts.expressibleAdjacent} }`);
if (doc.uncovered.length) {
  yaml.push('# Subflows the conversations use that kb.json does not key, so no clause');
  yaml.push('# covers them and a rule mined there can never align. Recorded, not hidden.');
  yaml.push('uncovered_subflows:');
  for (const u of doc.uncovered) yaml.push('  - { subflow: ' + u.subflow + ', conversations: ' + u.conversations + ' }');
}
yaml.push(`clauses:`);
for (const c of clauses) {
  yaml.push(`  - id: ${c.id}`);
  yaml.push(`    text: ${JSON.stringify(c.text)}`);
  yaml.push(`    expressible: ${c.expressible}`);
  if (c.reason) yaml.push(`    reason: ${JSON.stringify(c.reason)}`);
  if (c.shape) {
    yaml.push(`    shape: ${c.shape}`);
    yaml.push(`    subject: ${JSON.stringify(c.subject)}`);
    yaml.push(`    guard: ${JSON.stringify(c.guard)}`);
    yaml.push(`    adjacent: ${c.adjacent}`);
    yaml.push(`    when: { fact: ${c.when.fact}, value: ${JSON.stringify(c.when.value)} }`);
  }
}
writeFileSync(join(root, 'policies/abcd-guidelines.yaml'), yaml.join('\n') + '\n');
console.log(`wrote ${clauses.length} clauses (${doc.counts.expressible} expressible, ${inexpressible} not)`);
