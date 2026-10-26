import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { mockBrief, mockEvidence, mockNotes } from './mock-inputs.js';
import { hash, tree } from '../../src/io.js';
import { stages as currentStages } from '../../src/contracts.js';

// Historical projects are test data.  Keep them outside the package runtime so
// a new project can never load these inputs by selecting an old creation mode.
export const legacyFixtureRoot = fileURLToPath(new URL('./legacy/', import.meta.url));
const legacyCaseRoot = path.join(legacyFixtureRoot, 'cases', 'display-board');
const legacyInputsRoot = path.join(legacyCaseRoot, 'inputs');
const legacyLibraryRoot = path.join(legacyFixtureRoot, 'libraries');

const clone = value => structuredClone(value);
const digest = value => createHash('sha256').update(value).digest('hex');

/**
 * Seed a saved project that represents an old release.
 *
 * The public create API intentionally only creates the current text flow.  A
 * compatibility test starts with that blank project, then writes the historical
 * state it needs (old mode, legacy inputs, a copied bundle, or frozen library).
 */
export async function createLegacyProject(flow, options = {}) {
  const {
    label = `Historical project ${Date.now()}`,
    replayOf,
    designMode = 'reconstruction',
    mode = designMode === 'reconstruction' ? 'design' : 'text-mcp',
    caseId = null,
    bundle = caseId === 'display-board',
    fixedLibrary = designMode === 'fixed-redesign',
    controlledLayout = designMode !== 'reconstruction',
    layoutEngine = controlledLayout ? 'native-kicad' : undefined,
    inputs: inputOverrides = {},
  } = options;

  // Deliberately use the supported blank/new-design entry point.  All legacy
  // fields below are persisted only in this test fixture helper.
  const created = await flow.create({ label, designMode: 'new-design', replayOf });
  const p = await flow.load(created.id);
  p.schemaVersion = mode === 'design' ? 2 : 3;
  p.mode = mode;
  p.scope = mode === 'text-mcp' ? 'schematic' : 'full-project';
  p.origin = 'legacy-conversion';
  p.caseId = caseId;
  p.designMode = designMode;
  p.controlledLayout = Boolean(controlledLayout);
  p.layoutEngine = layoutEngine;
  delete p.demoPreset;
  delete p.fixedParts;
  delete p.fixedLibrary;
  delete p.inputsBundle;
  delete p.bundleFiles;
  delete p.bundleHash;
  delete p.caseInputSignature;

  let inputs = { requirements: '', constraints: {}, datasheets: [], stageNotes: {} };
  if (designMode === 'datasheet-demo') {
    inputs = {
      requirements: mockBrief,
      evidence: clone(mockEvidence),
      datasheetText: '',
      constraints: {},
      datasheets: [],
      resources: [],
      stageNotes: { ...mockNotes },
    };
  } else if (designMode === 'fixed-redesign' && caseId === 'display-board') {
    inputs = {
      requirements: await fs.readFile(path.join(legacyLibraryRoot, 'display-board-brief.txt'), 'utf8'),
      datasheetText: '', constraints: {}, datasheets: [], resources: [], stageNotes: {},
    };
  } else if (caseId === 'display-board') {
    inputs = await readJson(path.join(legacyCaseRoot, 'defaults.json'));
    // The old reconstruction entry point carried the long extracted task
    // text; keep that historical payload available only to compatibility tests.
    inputs.requirements = await fs.readFile(path.join(legacyCaseRoot, 'default-text.txt'), 'utf8');
  }
  p.inputs = { ...inputs, ...clone(inputOverrides) };

  // Old design projects executed all seven stages; old text projects skipped
  // PCB in the same way as the current text flow.
  const stageTemplate = mode === 'design' ? currentStages : p.stages;
  p.stages = stageTemplate.map(stage => ({
    ...stage,
    status: mode === 'text-mcp' && stage.id === 6 ? 'skipped' : 'pending',
    source: 'ai', plan: null, confirmed: false, gaps: [], assumptions: [], questions: [],
    output: undefined, outputHash: undefined, result: undefined, confirmation: undefined,
  }));

  const directory = flow.dir(p.id);
  if (bundle) {
    p.inputsBundle = path.join(directory, 'default-inputs');
    await fs.cp(legacyInputsRoot, p.inputsBundle, { recursive: true });
    p.bundleFiles = await tree(p.inputsBundle);
    p.bundleHash = hash(p.bundleFiles);
    p.bundleManifest = await readJson(path.join(legacyInputsRoot, 'manifest.json'));
    p.caseInputSignature = flow.designSignature(p.inputs);
  }
  if (fixedLibrary) {
    const bytes = await fs.readFile(path.join(legacyLibraryRoot, 'display-board-fixed.json'));
    await fs.writeFile(path.join(directory, 'fixed-component-library.json'), bytes);
    p.fixedLibrary = {
      file: 'fixed-component-library.json',
      sha256: digest(bytes),
      originalPageCoordinates: false,
      completeNetlist: false,
    };
  }

  await flow.save(p);
  // Keep the returned shape equivalent to Flow.create() without invoking any
  // migration hooks that are specifically under test for historical states.
  p.inputCatalog = await flow.inputIndex(p, 1);
  return p;
}

// Alias reads naturally at call sites that describe the state rather than the
// migration operation.
export const historicalProject = createLegacyProject;

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}
