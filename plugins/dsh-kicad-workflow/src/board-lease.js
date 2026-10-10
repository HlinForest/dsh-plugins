// A KiCad MCP process has a single mutable active board. Keep its ownership
// across tool calls, not just while one call is running.
export class BoardLease {
  owner = null;
  before(name, owner) {
    if (!name.startsWith('mcp__kicad__')) return;
    if (this.owner !== null && this.owner !== owner) throw new Error('KiCad board is owned by another chat. Finish/save/close it in that chat before switching.');
    if (['mcp__kicad__open_project', 'mcp__kicad__create_project'].includes(name)) this.owner = owner;
  }
  after(name, owner, result) {
    if (name !== 'mcp__kicad__close_project' || owner !== this.owner || result.isError) return;
    const text = result.value?.content?.find(block => block.type === 'text')?.text;
    try { if (JSON.parse(text).success === true) this.owner = null; } catch { /* Unproven close retains ownership. */ }
  }
}
