# polyx-bench

**Clause-set decompositions of public agent benchmarks, and the human verdicts
on how well an automated matcher aligned them.** Apache-2.0.

A mined rule is only measurable against something written down. These files are
the *something written down*: public benchmark rulebooks, decomposed by hand
into atomic clauses, each marked with whether a precedence-and-absence rule
language can state it at all.

```
policies/
  abcd-guidelines.yaml       499 clauses from ABCD's kb.json + guidelines.json
                             155 expressible, 48 of those adjacent pairs
  abcd-guidelines-gold.yaml  human verdicts on a stratified sample of the
                             matcher's alignments, plus the ones it declined
  tau2-retail-policy.yaml    a hand decomposition of tau2-bench's
                             domains/retail/policy.md
scripts/
  decompose-abcd-guidelines.mjs  regenerates abcd-guidelines.yaml from the corpus
  review-abcd-clauses.mjs        stratified sample for a human read
```

## Why this is public

The point of a decomposed clause set is that someone else can check it. A
precision figure measured against an answer key nobody may read is a claim, not
a measurement — so the decompositions of *public* benchmarks belong in the open,
where a reader can disagree with a specific clause rather than with a number.

The gold file is here for the same reason, and it carries its own bad news: an
early rating pass was misled by showing the matcher's verdict before the rater's,
and those verdicts were *superseded rather than deleted*, with the reason. A
rating pass that turned out to be misled is itself a finding.

What is **not** here is any clause set derived from a private corpus. Those live
in a separate repository that is licensed to nobody, because a shipped answer key
is a shipped evaluation.

## The expressibility split is the interesting number

Of ABCD's 499 clauses, 155 can be stated as a precedence between two typed
actions. The other 344 are real guidance about intent, argument values, or free
text — recorded with a reason rather than quietly dropped, because the honest
denominator for recall is the part a rule language can reach, and the honest
report says how much that leaves out.

## Using them

These are plain YAML and carry no dependency on polyx. If you want to run polyx
against them:

```
POLYX_POLICIES=/path/to/polyx-bench/policies node bin/polyx.mjs evaluate abcd
```

polyx looks for `../polyx-bench/policies` beside its own checkout by default.
The two scripts read the corpora and alphabets from a polyx checkout; set
`POLYX_ROOT` if it is not the sibling directory.

## Attribution

The decompositions are derived work and the upstream terms travel with them:

- **ABCD** — Chen, Chen, Yang, Lin, Yu (2021), *Action-Based Conversations
  Dataset*, NAACL. MIT. `guidelines.json` and `kb.json` are the source of
  `abcd-guidelines.yaml`.
- **tau2-bench** — Barres et al. (2025), *tau2-Bench*. MIT.
  `domains/retail/policy.md` is the source of `tau2-retail-policy.yaml`.

No benchmark data is redistributed here — only the clause decompositions and the
human verdicts, which are our own work and are licensed under Apache-2.0 with the
attributions above.
