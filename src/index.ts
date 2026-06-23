import { run } from './cli/create-program';

const code = await run(process.argv.slice(2));
if (code !== 0) process.exit(code);
