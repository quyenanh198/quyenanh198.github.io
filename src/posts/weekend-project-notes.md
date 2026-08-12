---
layout: post.njk
title: "A weekend project: a tiny CLI habit tracker"
date: 2026-03-03
excerpt: A small terminal tool I put together over a weekend, and what I'd change next time.
tags: [projects, notes]
---
I wanted a way to track a handful of daily habits without opening an app, so I spent a weekend building a tiny CLI tool instead.

The whole thing boils down to one command:

```bash
$ habit done "read 20 minutes"
✓ logged for 2026-03-03
```

It writes to a plain text file, one line per entry, so the "database" is just something I can `cat` or `grep`. No sync, no accounts, no dashboard — on purpose.

What I'd change next time:

- Store timestamps in a consistent format from day one (I didn't, and paid for it later).
- Add a `--summary` flag earlier instead of grepping the log file by hand.
- Resist the urge to add a web UI. The constraint was the point.

Small, disposable projects like this are a good reminder that not everything needs to be built to last.
