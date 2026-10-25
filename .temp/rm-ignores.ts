import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
const files = execSync('git grep -l "@ts-ignore"').toString().trim().split('\n');
for (const f of files) {
  let s = readFileSync(f, 'utf8');
  s = s.replace(/^[ \t]*\/\/ @ts-ignore.*\n/gm, '');
  s = s.replace(/^import React, \{([^}]*)\} from 'react';$/gm, "import * as React from 'react';\nimport {$1} from 'react';");
  s = s.replace(/^import React from 'react';$/gm, "import * as React from 'react';");
  writeFileSync(f, s);
  console.log(f);
}
