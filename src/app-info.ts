import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The project's name, in one place (also in `package.json` and the README title). */
export const APP_NAME = 'passpad';

/** From package.json, so bug reports say exactly which build they came from. */
export const VERSION: string = (() => {
  try {
    return String(JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8')).version);
  } catch {
    return 'unknown';
  }
})();

/** Where "Report on GitHub" sends people (prefilled new issue). */
export const ISSUES_URL = 'https://github.com/ianmadez/passpad/issues/new';
