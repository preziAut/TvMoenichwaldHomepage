// Keep telemetry out of developer machines and CI; use the locked local LTS runtime.
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const executable=fileURLToPath(new URL(process.platform==='win32'?'../node_modules/node/bin/node.exe':'../node_modules/node/bin/node',import.meta.url));
const child=spawn(executable,['node_modules/astro/bin/astro.mjs',...process.argv.slice(2)],{stdio:'inherit',env:{...process.env,ASTRO_TELEMETRY_DISABLED:'1'}});
child.on('exit',code=>process.exit(code??1));child.on('error',e=>{console.error(e.message);process.exit(1);});
