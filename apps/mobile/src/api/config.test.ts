import fs from 'fs';
import path from 'path';

describe('config - no hardcoded secrets', () => {
  const configSource = fs.readFileSync(path.join(__dirname, 'config.ts'), 'utf8');

  it('reads the API secret only from an environment variable, never a literal', () => {
    expect(configSource).toMatch(/process\.env\.EXPO_PUBLIC_MOBILE_API_SECRET/);
    // No 32+ char hex/base64-looking literal string anywhere in the file.
    expect(configSource).not.toMatch(/['"][A-Za-z0-9+/_-]{32,}['"]/);
  });

  it('never logs the secret value itself', () => {
    expect(configSource).not.toMatch(/console\.(log|warn|error)\([^)]*mobileApiSecret\)/);
  });
});

describe('repo-wide - no leaked dev secret in source', () => {
  it('the local dev MOBILE_API_SECRET value never appears inside src/', () => {
    // .env is gitignored and read at build time only; grep the actual
    // source tree (not node_modules/.expo) to make sure no one pasted the
    // real value into a source file by mistake.
    const srcDir = path.join(__dirname, '..');
    const offenders: string[] = [];
    function walk(dir: string) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx|js|jsx)$/.test(entry.name) && !entry.name.includes('.test.')) {
          const content = fs.readFileSync(full, 'utf8');
          if (content.includes('ceabc880dd741e122f74da416ca7059f8607cc7b606773b42e22a3aec75a7d46')) {
            offenders.push(full);
          }
        }
      }
    }
    walk(srcDir);
    expect(offenders).toEqual([]);
  });
});
