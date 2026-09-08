#!/usr/bin/env node
// Print a sample of the ABCD clause decomposition beside the guideline text it
// came from, so a person can say whether it is a fair reading (plan §8 item 5).
//
// The sample is STRATIFIED, not random: it over-samples the shapes most likely
// to be a misreading — pairs far apart in the button order (where "comes
// after" may be an artefact of listing rather than a rule), and clauses marked
// inexpressible — because a uniform draw would be mostly easy adjacent pairs.
//
// Deterministic: same corpus, same 20.
//
//   node scripts/review-abcd-clauses.mjs [n]
import { readFileSync } from 'node:fs';
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
const policy = parse(readFileSync(join(root, 'policies/abcd-guidelines.yaml'), 'utf8'));

const flowTitle = {
  account_access: 'Account Access', manage_account: 'Manage Account', order_issue: 'Order Issue', product_defect: 'Product Defect',
  purchase_dispute: 'Purchase Dispute', shipping_issue: 'Shipping Issue', single_item_query: 'Single-Item Query',
  storewide_query: 'Storewide Query', subscription_inquiry: 'Subscription Inquiry', troubleshoot_site: 'Troubleshoot Site',
};
// subflow id → { title, actions[], instructions[] }
const guide = new Map();
for (const [flow, subflows] of Object.entries(ontology.intents.subflows)) {
  const g = guidelines[flowTitle[flow]];
  const names = Object.keys(g.subflows);
  subflows.forEach((id, i) => guide.set(id, { title: names[i], ...g.subflows[names[i]] }));
}

const clean = (s) => String(s).replace(/\s+/g, ' ').trim();
/** The guideline sentence that mentions a button, if there is one. */
function sentenceFor(subflow, button) {
  const g = guide.get(subflow);
  if (!g) return null;
  const want = button.replace(/-/g, ' ').toLowerCase();
  const hit = g.actions.find((a) => a.button.toLowerCase().replace(/[^a-z ]/g, '') === want || a.button.toLowerCase().replace(/[^a-z]/g, '') === button.replace(/[^a-z]/g, ''));
  return hit ? clean(hit.text) : null;
}

// index every precedence clause by its position distance in kb.json's order
const rows = [];
for (const c of policy.clauses) {
  if (c.shape !== 'precedence') continue;
  const subflow = String(c.when.value).replace(/^intent:/, '');
  const order = kb[subflow] ?? [];
  const m = /^c-(.+?)-(.+)-(.+)$/.exec(c.id);
  // recover the two buttons from the clause text, which is authored, not parsed
  const bm = /\[(.+?)\] comes after \[(.+?)\]/.exec(c.text);
  if (!bm) continue;
  const [, later, earlier] = bm;
  const di = order.indexOf(later);
  const dj = order.indexOf(earlier);
  rows.push({ c, subflow, later, earlier, distance: di - dj, adjacent: di - dj === 1, order });
  void m;
}

const n = Number(process.argv[2] ?? 20);
// strata: adjacent+expressible, distant+expressible, inexpressible-because-subject, inexpressible-because-guard
const strata = [
  ['adjacent, polyx can state it', rows.filter((r) => r.adjacent && r.c.expressible)],
  ['FAR APART in the order, polyx can state it', rows.filter((r) => r.distance >= 3 && r.c.expressible)],
  ['polyx cannot state it — subject is not a consequential action', rows.filter((r) => r.c.reason === 'subject is not a consequential action')],
  ['polyx cannot state it — guard is not an action', rows.filter((r) => r.c.reason === 'guard is not an action')],
];
const per = Math.max(1, Math.floor(n / strata.length));
let k = 0;
for (const [label, list] of strata) {
  if (!list.length) continue;
  console.log(`\n${'='.repeat(78)}\n${label.toUpperCase()}  (${list.length} clauses of this shape in the set)\n${'='.repeat(78)}`);
  // evenly spaced across the stratum, so it is a spread rather than the first few
  for (let s = 0; s < per && s < list.length; s++) {
    const r = list[Math.round((s * (list.length - 1)) / Math.max(1, per - 1))];
    const g = guide.get(r.subflow);
    console.log(`\n[${++k}] ${g?.title ?? r.subflow}   (kb.json order: ${r.order.join(' → ')})`);
    console.log(`    MY CLAUSE:  ${r.c.text}`);
    console.log(`    expressible: ${r.c.expressible}${r.c.reason ? ` — ${r.c.reason}` : ''}    buttons ${r.distance} apart`);
    const se = sentenceFor(r.subflow, r.earlier);
    const sl = sentenceFor(r.subflow, r.later);
    console.log(`    GUIDELINE on [${r.earlier}]: ${se ? `"${se}"` : '(no sentence names this button)'}`);
    console.log(`    GUIDELINE on [${r.later}]:   ${sl ? `"${sl}"` : '(no sentence names this button)'}`);
    if (g?.instructions?.length) console.log(`    FLOW NOTE: "${clean(g.instructions[0])}"`);
  }
}
console.log(`\n${k} clauses shown, of ${rows.length} precedence clauses (${policy.counts.expressible} expressible, ${policy.counts.inexpressible} not).`);
