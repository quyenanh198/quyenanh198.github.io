---
layout: post.njk
title: Building this site with Eleventy
date: 2026-07-02
excerpt: Why I rebuilt this site from scratch and how the Eleventy setup is put together.
tags: [eleventy, webdev]
---
I rebuilt this site from an old client-side Markdown blog into a static [Eleventy](https://www.11ty.dev/) project. No client-side rendering, no framework runtime — just HTML and CSS shipped straight from GitHub Pages.

The whole config fits in a single file:

```js
module.exports = function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy({ "src/css": "css" });
  eleventyConfig.addCollection("posts", (api) =>
    api.getFilteredByGlob("src/posts/*.md").sort((a, b) => b.date - a.date)
  );

  return {
    dir: { input: "src", output: "_site" },
  };
};
```

A few things I optimized for:

- **No build-time surprises.** Markdown in, HTML out, nothing else running in the browser except a tiny theme-toggle script.
- **One stylesheet.** Everything is CSS custom properties, so light/dark theming is just swapping variable values.
- **Deploys itself.** A GitHub Actions workflow builds the site and publishes to Pages on every push to `master`.

> The best tooling is the tooling you stop noticing.

Next up: writing more, tuning the design further, and maybe a proper RSS feed.
