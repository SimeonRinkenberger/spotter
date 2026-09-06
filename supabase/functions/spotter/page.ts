// The page is built, not stitched at import time. build.mjs concatenates the three
// template modules, strips their comments out (they explain the source; nobody needs
// them on a phone) and writes the one result to page.gen.ts and docs/index.html in the
// same pass — so the function-served copy and the GitHub Pages copy are byte-identical
// by construction rather than by two pieces of code agreeing. Nothing imports markup.ts,
// style.ts or app.ts at runtime any more; edit those, then run: node build.mjs
export { PAGE_HTML } from "./page.gen.ts";
