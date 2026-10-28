// What the composer hint and the palette say about a recall hit. DESIGN voice: past tense, numbers, nothing stronger than the check.
// DOM-free so the tests can import it. hit.cites = { total, verified, moved, unverified, missing } or null.

export function recallParts(hit, nbId) {
  const c = hit.cites, bad = c ? (c.unverified || 0) + (c.missing || 0) : 0;
  const status = !c?.total ? null : bad ? 'unverified' : c.moved ? 'moved' : 'verified';
  const what = hit.kind === 'answer' ? `Question ${hit.num}` : hit.title;
  const where = hit.notebook === nbId ? '' : ` in ${hit.notebookTitle}`;
  const noun = c?.total === 1 ? 'citation' : 'citations';
  let cites = 'No citations.';
  if (c?.total) cites = !bad && !c.moved ? `${c.total} ${noun}, ${c.total === 1 ? 'still verified' : 'all still verified'}.`
    : `${c.total} ${noun}: ${[['verified', c.verified], ['moved', c.moved], ['unverified', bad]].filter(([, n]) => n).map(([w, n]) => `${n} ${w}`).join(', ')}.`;
  return { status, text: `Asked before: ${what}${where}. ${cites}` };
}

// palette row subtitle: the notebook when it is not the open one, then the counts
export function recallSub(hit, nbId) {
  const c = hit.cites, bad = c ? (c.unverified || 0) + (c.missing || 0) : 0;
  const what = hit.kind === 'note' ? 'note' : hit.kind === 'sheet' ? 'sheet'
    : !c?.total ? 'no citations' : `${c.verified} verified${c.moved ? `, ${c.moved} moved` : ''}${bad ? `, ${bad} unverified` : ''}`;
  return [hit.notebook === nbId ? '' : hit.notebookTitle, what].filter(Boolean).join(' · ');
}
