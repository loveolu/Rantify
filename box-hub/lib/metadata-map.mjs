/**
 * metadata-map.mjs — pure mapping between the contract's CardMetadata and the Box
 * `devtool_build_card` instance (SPEC.md §5.3). Box enum/string fields can't store null,
 * so unset builder fields are OMITTED on write and read back as null (Open Question §10.1
 * in the Box Content Hub design).
 */

const BUILDER_FIELDS = ['builder_session_id', 'repo_url', 'pr_url', 'box_task_id'];
const ALL_FIELDS = ['status', 'theme', 'pain_score', 'card_id', ...BUILDER_FIELDS];

/** Contract CardMetadata → Box instance values (drop nulls/undefined). */
export function toInstanceValues(meta) {
  const out = {};
  for (const k of ALL_FIELDS) {
    if (meta[k] !== null && meta[k] !== undefined) out[k] = meta[k];
  }
  return out;
}

/** Box instance values → contract CardMetadata (absent builder fields → null). */
export function toContractMetadata(values) {
  const out = {
    status: values.status,
    theme: values.theme,
    pain_score: values.pain_score,
    card_id: values.card_id,
  };
  for (const k of BUILDER_FIELDS) out[k] = values[k] ?? null;
  return out;
}

/**
 * Partial CardMetadata → Box JSON-patch ops.
 * Without `current`: replace for values, remove for nulls (simple form).
 * With `current` (contract metadata): pick add vs replace per field — Box needs `add` for a
 * field that has no value yet and `replace` for one that does — and skips removing an
 * already-absent field.
 */
export function toPatchOps(partial, current = null) {
  const ops = [];
  for (const [k, v] of Object.entries(partial)) {
    if (!ALL_FIELDS.includes(k)) continue;
    if (v === null) {
      if (!current || current[k] != null) ops.push({ op: 'remove', path: `/${k}` });
    } else if (current && current[k] == null) {
      ops.push({ op: 'add', path: `/${k}`, value: v });
    } else {
      ops.push({ op: 'replace', path: `/${k}`, value: v });
    }
  }
  return ops;
}
