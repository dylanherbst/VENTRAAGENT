import test from 'node:test';
import assert from 'node:assert/strict';
import { generateOpenAICourse } from '../lib/openai-course.ts';
const draft = {title:'Fixture course',summary:'A test',lessons:[{id:'one',title:'Intro',content:'Learn this',durationMinutes:'10'}]};
test('OpenAI adapter requires explicit server configuration',async()=>{await assert.rejects(generateOpenAICourse('brief',{key:'',model:''}),/not configured/);});
test('OpenAI fixture uses fixed endpoint and validates returned draft (NOT live provider)',async()=>{
 const request: typeof fetch = async(url,init)=>{assert.equal(url,'https://api.openai.com/v1/chat/completions');assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer fixture');return Response.json({choices:[{message:{content:JSON.stringify(draft)}}]});};
 assert.equal((await generateOpenAICourse('brief',{key:'fixture',model:'fixture',fetch:request})).title,draft.title);
});
test('OpenAI adapter rejects failed provider without leaking response',async()=>{await assert.rejects(generateOpenAICourse('brief',{key:'fixture',model:'fixture',fetch:async()=>new Response('secret',{status:429})}),/provider request failed/);});
test('OpenAI adapter rejects malformed course fixture',async()=>{await assert.rejects(generateOpenAICourse('brief',{key:'fixture',model:'fixture',fetch:async()=>Response.json({choices:[{message:{content:'null'}}]})}),/invalid course/);});
