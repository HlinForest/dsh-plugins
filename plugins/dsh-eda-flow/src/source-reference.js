// A bare placeholder in a datasheet is not an assigned board reference.
// Do not infer a new reference or alter actual names such as DISP or J1.
export const assignedSourceReference=value=>/^[*?]+$/.test(String(value||'').trim())?'':String(value||'').trim();
export function normalizeSourceReference(fact){
  const reference=assignedSourceReference(fact.reference);
  return reference===fact.reference?fact:{...fact,reference,sourceReference:fact.sourceReference??fact.reference};
}
