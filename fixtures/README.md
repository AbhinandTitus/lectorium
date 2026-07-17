# Test fixtures

All fixtures are either **original works created for this repository** or **public domain**, so they are legal to redistribute with the source. Nothing here is DRM-protected.

Planned layout (populated in Milestone 1–2; see docs/TESTING.md):

```
epub/    english-novel.epub, malayalam.epub, rtl.epub, malicious-*.epub
pdf/     english-text.pdf, malayalam-text.pdf, malayalam-broken-encoding.pdf, scanned.pdf
misc/    sample.txt, sample.md, malformed.bin
```

Generated fixtures are built by `scripts/` in this folder (checked-in, deterministic). Scripts that download public-domain sources run **only** when explicitly invoked — never as part of install, build, or test runs.
