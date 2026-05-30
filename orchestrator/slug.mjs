/**
 * slug.mjs — turn a Build Card title into a GitHub repo slug (SPEC.md §8.3
 * `gh repo create {GITHUB_ORG}/{slug}`). Pure.
 */

const MAX_LEN = 60;

/** @param {string} title @returns {string} */
export function slugFromTitle(title) {
  const slug = String(title ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')   // any run of non-alphanumerics → single hyphen
    .replace(/^-+|-+$/g, '')        // trim edge hyphens
    .slice(0, MAX_LEN)
    .replace(/-+$/g, '');           // re-trim if the slice cut mid-separator
  return slug || 'devtool';
}
