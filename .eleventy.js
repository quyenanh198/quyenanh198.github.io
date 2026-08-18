const { DateTime } = require("luxon");

module.exports = function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy({ "src/css": "css" });
  eleventyConfig.addPassthroughCopy({ "src/js": "js" });
  eleventyConfig.addPassthroughCopy({ "src/img": "img" });
  eleventyConfig.addPassthroughCopy({ "src/api": "api" });

  eleventyConfig.addCollection("posts", (collectionApi) =>
    collectionApi.getFilteredByGlob("src/posts/*.md").sort(
      (a, b) => b.date - a.date
    )
  );

  eleventyConfig.addCollection("reports", (collectionApi) =>
    collectionApi.getFilteredByGlob("src/reports/*.md").sort(
      (a, b) => b.date - a.date
    )
  );

  eleventyConfig.addFilter("ofReportType", (reports, type) =>
    (reports || []).filter((r) => r.data.reportType === type)
  );

  eleventyConfig.addFilter("readableDate", (dateObj) =>
    DateTime.fromJSDate(dateObj, { zone: "utc" }).toFormat("dd LLL yyyy")
  );

  eleventyConfig.addFilter("htmlDateString", (dateObj) =>
    DateTime.fromJSDate(dateObj, { zone: "utc" }).toFormat("yyyy-LL-dd")
  );

  eleventyConfig.addGlobalData("currentYear", () => new Date().getFullYear());

  // Cache-busting token for static assets: changes on every build so browsers
  // pick up fresh CSS/JS after each deploy despite same-URL caching.
  eleventyConfig.addGlobalData("assetVersion", () => Date.now().toString(36));

  eleventyConfig.addFilter("readingTime", (content) => {
    const words = String(content).replace(/<[^>]*>/g, "").split(/\s+/).filter(Boolean).length;
    const minutes = Math.max(1, Math.round(words / 200));
    return `${minutes} min read`;
  });

  return {
    dir: {
      input: "src",
      output: "_site",
      includes: "_includes",
      data: "_data",
    },
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
  };
};
