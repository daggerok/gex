import { join } from "node:path";
export const x = 1;
console.log("dirname", __dirname, "filename", __filename, "main?", require.main === module, process.argv[1] === __filename, typeof module);
