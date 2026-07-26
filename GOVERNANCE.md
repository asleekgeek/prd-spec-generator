# Governance

This document states who decides what, how a decision is made, and what happens
to the project if the current maintainer stops. It exists because a project that
cannot answer those questions is a project you should not depend on.

It is deliberately honest about scale: **prd-spec-generator has one
maintainer.** Several practices below would read as bureaucratic theatre at this
size, so they are described as what they actually are rather than dressed up.

## Roles and responsibilities

| Role | Who | Responsibilities |
|---|---|---|
| **Maintainer** | [@cdeust](https://github.com/cdeust) | Final say on scope, design and releases. Reviews and merges every change. Triages issues and security reports. Publishes releases and owns the signing identity. |
| **Contributor** | anyone opening a PR | Proposes changes through the process in [CONTRIBUTING.md](CONTRIBUTING.md). Owns their change through review, including tests and documentation. |
| **Security reporter** | anyone | Reports privately per [SECURITY.md](SECURITY.md). Credited in the advisory unless they ask not to be. |

There is currently **one person in the maintainer role**. That is a real
limitation and it is stated plainly rather than hidden behind a plural "the
team": it is why the OpenSSF gold criteria `contributors_unassociated` and
`two_person_review` cannot be met here, and why branch protection requires a
pull request with zero required approvals instead of pretending a review
happened (see [SECURITY.md](SECURITY.md#scorecard-controls-and-the-one-that-is-declined)).

## How decisions are made

1. **Anything observable by a consumer** — a tool contract, a schema, the
   pipeline's step order, a released artifact — is decided in a pull request,
   in writing, with the reasoning in the description. The PR is the record.
2. **Disagreement** is resolved by evidence: a measurement, a citation, or a
   test that distinguishes the two positions. Where no evidence can settle it,
   the maintainer decides and records why in the PR.
3. **Constants and thresholds** need a source — a paper, a benchmark, or an
   explicit `// source: provisional heuristic` admission. A number with no
   provenance is not merged.
4. **Reversals are cheap and expected.** A decision recorded in a PR can be
   revisited by another PR that says what new information changed it.

## How a change gets in

The full process is in [CONTRIBUTING.md](CONTRIBUTING.md). In short: fork or
branch, open a PR against `main`, pass CI (build, tests on Node 20 and 22, the
80% statement-coverage gate, CodeQL, and a smoke test that starts the shipped
artifact), and get maintainer review. `main` is protected: no direct pushes, no
force pushes, no deletion.

## Becoming a maintainer

There is no secret ceremony. A contributor who has landed several non-trivial
changes, engages with review substantively, and wants the role can ask for it by
opening an issue. The maintainer will say yes or say why not, in that issue.
Adding a second maintainer is actively wanted: it is the single change that
would most improve this project's resilience, and it is the only thing standing
between it and the OpenSSF gold criteria.

## Continuity of access

If the maintainer becomes unavailable:

- **The code cannot be lost.** It is public on GitHub under the MIT licence, and
  every release is a git tag. Any clone is a complete copy of the history, and
  the licence permits anyone to fork and continue without asking permission.
- **The releases can be verified without us.** Every release artifact carries a
  Sigstore build-provenance attestation and a published SHA-256, so a fork can
  prove which commit produced which artifact even if this account disappears.
  See [SECURITY.md](SECURITY.md#supply-chain-assurance).
- **What is genuinely single-owner** is the GitHub repository itself, the
  release-signing identity, and the entry on the plugin marketplaces. If the
  maintainer disappeared without transferring them, the practical continuation
  path is a fork under new ownership publishing under its own identity.

That last point is a real single point of failure, and pretending otherwise
would defeat the purpose of writing this down. It is mitigated in the only ways
available to a one-person project — everything needed to continue is public,
licensed for reuse, and independently verifiable — and it is fully resolved only
by a second maintainer.

## Code of conduct

Participation is governed by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). The
maintainer is responsible for enforcing it.
