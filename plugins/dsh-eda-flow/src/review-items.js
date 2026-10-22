// Shared by the service and UI; original issue text is retained for audit.
export const issueKey = text => String(text).normalize('NFKC').replace(/[\s。！？!?；;，,：:]+/g, '').toLowerCase();
export function reviewRecord(project, question) {
  return (project.clarifications || []).find(r => issueKey(r.question) === issueKey(question));
}
export const isResolved = (p, question) => {
  const r = reviewRecord(p, question);
  return r?.status === 'resolved' && r.contextRevision === (p.clarificationRevision || 0);
};
export function pendingIssues(p, stage) {
  return [...new Map([...(stage.questions || []), ...(stage.gaps || []), ...(stage.assumptions || [])]
    .filter(q => !isResolved(p, q)).map(q => [issueKey(q), q])).values()];
}
export function resolvedAnswers(p) {
  return (p.clarifications || []).filter(r => isResolved(p,r.question)).map(({question,answer,feedback,stage})=>({question,answer,feedback,stage}));
}
