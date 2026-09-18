const {test} = require('node:test');
const assert = require('node:assert/strict');
const {eligible, validateValues, ProcessRunner, Cancelled} = require('../out/core');
const schema = [
  {name:'count',type:'numeric',min:0,max:100},
  {name:'region',type:'select',multiple:true,choices:[{value:'A'},{value:'B'}]},
  {name:'date',type:'date'}, {name:'enabled',type:'checkbox'}, {name:'password',type:'password'}
];
const defaults = () => Object.fromEntries(schema.map(p => [p.name,{useDefault:true}]));
test('eligible document extensions only', () => {
  for (const file of ['test.Rmd','report.qmd','REPORT.QMD','space path/a.rMD']) assert.ok(eligible(file));
  for (const file of ['test.R','report.qmd.txt','report.html']) assert.ok(!eligible(file));
});
test('default selections omit values; explicit NULL is distinct', () => {
  const values = defaults(); values.count = {useDefault:false,value:null};
  const result = validateValues(values,schema);
  assert.deepEqual(result.count,{useDefault:false,value:null});
  assert.deepEqual(result.region,{useDefault:true});
});
test('typed selections preserve numeric, multi-select and booleans', () => {
  const values = defaults();
  values.count = {useDefault:false,value:3.5}; values.region = {useDefault:false,value:[]};
  values.enabled = {useDefault:false,value:false}; values.date = {useDefault:false,value:'2026-09-17'};
  const result = validateValues(values,schema);
  assert.equal(result.count.value,3.5); assert.deepEqual(result.region.value,[]); assert.equal(result.enabled.value,false);
});
test('reject malformed messages and stale/unknown parameter sets', () => {
  for (const value of [null,[],{}, {injected:{useDefault:true}}]) assert.throws(()=>validateValues(value,schema));
  const values = defaults(); values.count = {useDefault:'true'};
  assert.throws(()=>validateValues(values,schema));
});
test('reject invalid typed values without including submitted secrets', () => {
  for (const [name,value] of [['count','secret'],['count',NaN],['count',101],['region',['injected']],['date','2026-02-30'],['enabled',1],['password',{}]]) {
    const values = defaults(); values[name] = {useDefault:false,value};
    assert.throws(()=>validateValues(values,schema),error => !error.message.includes('secret'));
  }
});
test('process runner passes paths and arguments literally without shell expansion', async () => {
  let text = '';
  await new ProcessRunner().run(process.execPath,['-e','process.stdout.write(process.argv[1])', 'spaces " ; $(echo injected)'],process.cwd(),s=>text+=s);
  assert.equal(text,'spaces " ; $(echo injected)');
});
test('missing executable and nonzero exit reject', async () => {
  await assert.rejects(new ProcessRunner().run('/missing/knit-rscript',[],process.cwd(),()=>{}),/Could not start/);
  await assert.rejects(new ProcessRunner().run(process.execPath,['-e','process.exit(3)'],process.cwd(),()=>{}),/status 3/);
});
test('cancelled process rejects rather than reporting success', async () => {
  const runner = new ProcessRunner();
  const done = runner.run(process.execPath,['-e','setInterval(()=>{},1000)'],process.cwd(),()=>{});
  setTimeout(()=>runner.cancel(),100);
  await assert.rejects(done,Cancelled);
  await assert.rejects(runner.run(process.execPath,[],process.cwd(),()=>{}),Cancelled);
});
