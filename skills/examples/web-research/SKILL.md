---
name: web-research
description: Run a careful multi-source web lookup with the web_fetch tool when a question needs current or primary-source information.
---

# Web research procedure

Use this playbook when a request needs facts that are current, disputed, or unlikely
to be in your training data.

1. Restate the question as one or two precise lookup targets before fetching anything.
   Know what would count as a good answer before you start.
2. Fetch 2–3 independent sources with the `web_fetch` tool. Prefer primary sources —
   official docs, standards bodies, vendor changelogs — over aggregators and mirrors.
3. Cross-check every claim you intend to repeat. If two sources disagree, fetch a
   third and state which version you trust and why.
4. Quote the deciding detail in your answer: version number, date, config key, exact
   command output — the one artifact a reader could verify themselves.
5. End with the source URLs you actually used, and say plainly what you could NOT
   verify.

Never guess: a fast answer with unverified claims is worse than a slower, sourced one.