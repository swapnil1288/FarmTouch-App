import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
const config=JSON.parse(readFileSync('dist/server/wrangler.json','utf8'));
config.d1_databases=config.d1_databases.map(d=>({...d,migrations_dir:resolve('drizzle')}));
config.main=resolve('dist/server/index.js');config.assets.directory=resolve('dist/client');
mkdirSync('.sites-runtime',{recursive:true});writeFileSync('.sites-runtime/local-migrations.json',JSON.stringify(config));
const r=spawnSync(process.execPath,['--import','./scripts/sites-env.mjs','./node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','DB','--local','--config','.sites-runtime/local-migrations.json','--persist-to',process.argv[2]||'.wrangler/state'],{stdio:'inherit'});process.exit(r.status??1);
