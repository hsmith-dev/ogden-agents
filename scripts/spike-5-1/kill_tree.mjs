// Spike 5.1 (temporary): stop a process tree with story 9.6's helper, unchanged.
// Node 24 strips the TypeScript types when importing the .ts source.
import { killProcessTree } from '../../packages/adapters/src/process-tree.ts';

const pid = Number(process.argv[2]);
killProcessTree(pid);
console.log(JSON.stringify({ killed: pid }));
