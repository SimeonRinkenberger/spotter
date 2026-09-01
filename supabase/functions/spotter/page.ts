// The app is authored as three template modules and stitched together here.
// build.mjs performs the identical concatenation to produce docs/index.html,
// so the GitHub Pages copy and the function-served copy are byte-identical.
import { STYLE } from "./style.ts";
import { MARKUP_HEAD, MARKUP_BODY } from "./markup.ts";
import { APP } from "./app.ts";

export const PAGE_HTML = MARKUP_HEAD + STYLE + MARKUP_BODY + APP;
