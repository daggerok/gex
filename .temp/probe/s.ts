#!/usr/bin/env bun
console.log(process.argv[1], __filename, process.argv[1] === __filename, require.main === module);
