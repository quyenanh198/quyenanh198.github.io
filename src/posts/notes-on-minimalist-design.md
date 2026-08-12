---
layout: post.njk
title: Notes on minimalist design
date: 2026-05-18
excerpt: A few things I keep relearning about designing with less.
tags: [design]
---
Every time I redesign this site, I end up relearning the same lesson: minimalism isn't the absence of decisions, it's the result of a lot of them.

A few things I try to hold onto:

1. **Whitespace is a component.** It carries as much hierarchy as a heading does.
2. **One accent color, used sparingly.** If everything is emphasized, nothing is.
3. **Type does the heavy lifting.** A good type scale and line-height solve problems people usually reach for boxes and borders to fix.
4. **Motion should explain, not decorate.** A hover state that nudges an arrow forward tells you something clickable is there — it isn't there to look "modern."

It's easy to confuse *plain* with *minimal*. Plain is just the default browser stylesheet left alone. Minimal is everything unnecessary removed *on purpose*, with what's left doing more work.

```css
:root {
  --accent: #b1502e;
}

a:hover {
  color: var(--accent);
}
```

Small rules like that, applied consistently, matter more than any single "big" design decision.
