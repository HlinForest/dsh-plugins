import fs from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const read = relative => fs.readFile(new URL(relative, root), 'utf8');
const parts = ['core', 'helpers', 'visuals', 'selection', 'pcb', 'schematic', 'materials', 'manual-reader', 'reference-reader', 'engineering', 'restoration', 'shell'];
const body = [];
body.push('const css = ' + JSON.stringify(await read('client/styles.css')) + ';');
for (const part of parts) body.push(await read(`client/${part}.js`));
await fs.writeFile(new URL('client.js', root), `// Generated from client/*.js and client/styles.css. Run npm run build.\nwindow.__ModuleLoader__.load({id:'dsh-engineering-workbench',factory:require=>{\n${body.join('\n')}\nreturn {name:'engineering-workbench-client',inject:['slots'],apply};\n}});\n`);
