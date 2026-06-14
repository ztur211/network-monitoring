export interface LocationTokens { site: string; building: string; floor: string; area: string; role: string; }

const SEQ = '{seq}';

/** Substitute every token except {seq}; collapse separator runs left by empty tokens; trim edges. */
export function renderTemplate(template: string, tokens: LocationTokens): string {
  let out = template
    .replace(/\{site\}/g, tokens.site)
    .replace(/\{building\}/g, tokens.building)
    .replace(/\{floor\}/g, tokens.floor)
    .replace(/\{area\}/g, tokens.area)
    .replace(/\{role\}/g, tokens.role);
  // Protect {seq} from separator-collapsing.
  const guarded = out.split(SEQ);
  const cleaned = guarded.map((seg) => seg.replace(/[-_]{2,}/g, (m) => m[0]));
  out = cleaned.join(SEQ).replace(/^[-_]+/, '').replace(/[-_]+$/, '');
  return out;
}

export function hasSeqToken(rendered: string): boolean { return rendered.includes(SEQ); }
export function fillSeq(rendered: string, seq: string): string { return rendered.replace(SEQ, seq); }
