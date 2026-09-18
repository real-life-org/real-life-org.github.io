# real-life.org — the Real Life identifier site

Serves the canonical identifiers of the Real Life Trust Protocol:
`/rltp/v1` (vocabulary, context, normative schemas at their `$id`
paths) and `/trust-tasks/<slug>/<version>` (Trust Task type pages
with their payload schemas).

Also serves the term namespaces of the other two parts of Real Life and the
shared register: `/rlnp/v1` (Real Life Network Protocol), `/rls/v1` (Real Life
Stack) and `/meta/v1` (JSON-LD context, mappings between the three, register
fields).

**Canonical sources are [rltp-spec](https://github.com/real-life-org/rltp-spec)**
for `/rltp/v1` and `/trust-tasks`, and **[meta](https://github.com/real-life-org/meta)**
for `/rlnp/v1`, `/rls/v1` and `/meta/v1` — this repository mirrors published
versions for identifier resolution.
Per the offline rule, conforming implementations never resolve these
URLs at runtime; this site is documentation courtesy for the
ecosystem.
