const {test} = require('node:test');
const assert = require('node:assert/strict');
const {eligible, validateValues, ProcessRunner, Cancelled} = require('../out/core');
const schema = [
  {name:'count',type:'numeric',min:0,max:100},
  {name:'region',type:'select',multiple:true,choices:[{value:'A'},{value:'B'}]},
  {name:'date',type:'date'}, {name:'enabled',type:'checkbox'}, {name:'password',type:'password'}
];
const values = () => ({
  count:{value:1}, region:{value:['A']}, date:{value:'2026-09-17'}, enabled:{value:true}, password:{value:''}
});
test('eligible document extensions only', () => {
  for (const file of ['test.Rmd','report.qmd','REPORT.QMD','space path/a.rMD']) assert.ok(eligible(file));
  for (const file of ['test.R','report.qmd.txt','report.html']) assert.ok(!eligible(file));
});
test('every resolved value, including NULL, is retained explicitly', () => {
  const submitted = values(); submitted.count = {value:null};
  const result = validateValues(submitted,schema);
  assert.deepEqual(result.count,{value:null});
  assert.deepEqual(result.region,{value:['A']});
});
test('typed selections preserve numeric, multi-select and booleans', () => {
  const submitted = values();
  submitted.count = {value:3.5}; submitted.region = {value:[]};
  submitted.enabled = {value:false}; submitted.date = {value:'2026-09-17'};
  const result = validateValues(submitted,schema);
  assert.equal(result.count.value,3.5); assert.deepEqual(result.region.value,[]); assert.equal(result.enabled.value,false);
});
test('reject malformed messages, unknown sets, and entries missing own values', () => {
  for (const value of [null,[],{}, {injected:{value:1}}]) assert.throws(()=>validateValues(value,schema));
  for (const selection of [{}, {value:undefined}, Object.create({value:1}), [], null]) {
    const submitted = values(); submitted.count = selection;
    assert.throws(()=>validateValues(submitted,schema));
  }
});
test('reject invalid typed values without including submitted secrets', () => {
  for (const [name,value] of [['count','secret'],['count',NaN],['count',101],['region',['injected']],['date','2026-02-30'],['enabled',1],['password',{}]]) {
    const submitted = values(); submitted[name] = {value};
    assert.throws(()=>validateValues(submitted,schema),error => !error.message.includes('secret'));
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
