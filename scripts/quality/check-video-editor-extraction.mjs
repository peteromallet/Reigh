import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname);
const manifestPath = path.join(repoRoot, 'docs/design/video-editor-oss-extraction.evidence.json');
const packageJsonPath = path.join(repoRoot, 'package.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function fileExists(relativePath) {
  return fs.existsSync(path.join(repoRoot, relativePath));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function walkFiles(directoryPath) {
  const results = [];
  for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
    const nextPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(nextPath));
      continue;
    }
    if (/\.(ts|tsx|js|jsx|json)$/.test(entry.name)) {
      results.push(nextPath);
    }
  }
  return results;
}

const manifest = readJson(manifestPath);
const packageJson = readJson(packageJsonPath);

for (const scriptName of manifest.requiredRootScripts) {
  assert(packageJson.scripts?.[scriptName], `Missing root script: ${scriptName}`);
}

for (const relativePath of manifest.requiredFiles) {
  assert(fileExists(relativePath), `Missing required extraction artifact: ${relativePath}`);
}

for (const anchor of manifest.docAnchors ?? []) {
  const contents = readText(anchor.file);
  for (const requiredSnippet of anchor.mustContain) {
    assert(
      contents.includes(requiredSnippet),
      `Doc anchor ${anchor.id} is missing ${JSON.stringify(requiredSnippet)} in ${anchor.file}`,
    );
  }
}

for (const workflowCheck of manifest.workflowChecks ?? []) {
  const scriptBody = packageJson.scripts?.[workflowCheck.script];
  assert(scriptBody, `Missing workflow script ${workflowCheck.script}`);
  for (const requiredSnippet of workflowCheck.mustContain) {
    assert(
      scriptBody.includes(requiredSnippet),
      `Workflow script ${workflowCheck.script} is missing ${JSON.stringify(requiredSnippet)}`,
    );
  }
}

const workspaceList = spawnSync('corepack', ['pnpm', 'list', '-r', '--depth', '-1', '--json'], {
  cwd: repoRoot,
  encoding: 'utf8',
});
assert(workspaceList.status === 0, `workspace:list command failed: ${workspaceList.stderr || workspaceList.stdout}`);
const workspacePackages = JSON.parse(workspaceList.stdout).map((entry) => entry.name).filter(Boolean);
for (const expectedPackage of manifest.workspaceListPackages ?? []) {
  assert(workspacePackages.includes(expectedPackage), `workspace:list output is missing ${expectedPackage}`);
}

for (const stage of manifest.rollbackStages) {
  assert(stage.evidenceFiles.length > 0, `Rollback stage ${stage.id} has no evidence files`);
  for (const relativePath of stage.evidenceFiles) {
    assert(fileExists(relativePath), `Rollback stage ${stage.id} is missing ${relativePath}`);
  }
  for (const snippetCheck of stage.requiredSnippets ?? []) {
    const contents = readText(snippetCheck.file);
    for (const requiredSnippet of snippetCheck.mustContain ?? []) {
      assert(
        contents.includes(requiredSnippet),
        `Rollback stage ${stage.id} is missing ${JSON.stringify(requiredSnippet)} in ${snippetCheck.file}`,
      );
    }
  }
}

for (const check of manifest.splitChecks) {
  const contents = readText(check.file);
  for (const requiredSnippet of check.mustContain) {
    assert(
      contents.includes(requiredSnippet),
      `Split check ${check.id} is missing required snippet ${JSON.stringify(requiredSnippet)} in ${check.file}`,
    );
  }
  for (const forbiddenSnippet of check.mustNotContain) {
    assert(
      !contents.includes(forbiddenSnippet),
      `Split check ${check.id} still contains forbidden snippet ${JSON.stringify(forbiddenSnippet)} in ${check.file}`,
    );
  }
}

for (const [packageName, allowedDeps] of Object.entries(manifest.dependencyDirection)) {
  const packageDirName = packageName.split('/')[1];
  const packageManifest = readJson(path.join(repoRoot, 'packages', packageDirName, 'package.json'));
  const dependencyNames = [
    ...Object.keys(packageManifest.dependencies ?? {}),
    ...Object.keys(packageManifest.devDependencies ?? {}),
    ...Object.keys(packageManifest.peerDependencies ?? {}),
  ].filter((dependency) => dependency.startsWith('@tbd/'));

  for (const dependencyName of dependencyNames) {
    assert(
      allowedDeps.includes(dependencyName),
      `${packageName} depends on forbidden workspace package ${dependencyName}`,
    );
  }
}

const packageSourceFiles = walkFiles(path.join(repoRoot, 'packages'));
for (const filePath of packageSourceFiles) {
  const contents = fs.readFileSync(filePath, 'utf8');
  for (const forbiddenTerm of manifest.forbiddenPackageTerms) {
    assert(
      !contents.includes(forbiddenTerm),
      `Forbidden host concept ${JSON.stringify(forbiddenTerm)} found in ${path.relative(repoRoot, filePath)}`,
    );
  }
}

for (const check of manifest.routeSmokeChecks ?? []) {
  const contents = readText(check.file);
  for (const requiredSnippet of check.mustContain ?? []) {
    assert(
      contents.includes(requiredSnippet),
      `Route smoke check ${check.id} is missing ${JSON.stringify(requiredSnippet)} in ${check.file}`,
    );
  }
  for (const forbiddenSnippet of check.mustNotContain ?? []) {
    assert(
      !contents.includes(forbiddenSnippet),
      `Route smoke check ${check.id} still contains ${JSON.stringify(forbiddenSnippet)} in ${check.file}`,
    );
  }
}

console.log('Video editor extraction artifacts verified.');
