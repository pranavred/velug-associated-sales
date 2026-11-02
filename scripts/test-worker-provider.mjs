import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
const source=`import {OpenAIProvider,researchInput} from './app/provider.ts';import {configuration} from './app/config.ts';export default {async fetch(){try{const provider=new OpenAIProvider(configuration({OPENAI_API_KEY:'fixture-only'}));return Response.json(await provider.research(researchInput({name:'Example Manufacturing'})));}catch(e){return Response.json({error:e.message},{status:500});}}}`;
const bundle=await build({stdin:{contents:source,resolveDir:process.cwd(),loader:'ts'},bundle:true,format:'esm',platform:'browser',write:false});
let calls=0;
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,compatibilityDate:'2026-10-24',script:bundle.outputFiles[0].text,outboundService:async request=>{
 assert.equal(new URL(request.url).hostname,'api.openai.com');calls++;
 return Response.json({id:'fixture-response',model:'fixture',status:'completed',output:[{type:'web_search_call',status:'completed'},{type:'message',content:[{type:'output_text',text:'Example manufacturing source.',annotations:[{type:'url_citation',url:'https://example.com/manufacturing',title:'Example source'}]}]}]});
}}));
try{const response=await mf.dispatchFetch('http://localhost');const result=await response.json();assert.equal(response.status,200,result.error);assert.equal(result.sources.length,1);assert.equal(calls,1);console.log('Worker-native provider transport passed with intercepted external HTTP.');}finally{await mf.dispose();}
