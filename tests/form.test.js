const {test} = require('node:test');
const assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');
const fs = require('node:fs');
const script = fs.readFileSync('media/form.js','utf8');
function setup() {
  const dom = new JSDOM('<h1 id="title"></h1><p id="status"></p><form id="form"><div id="fields"></div><button id="knit">Knit</button><button id="cancel" type="button">Cancel</button><button id="refresh" type="button">Refresh</button></form>',{runScripts:'outside-only'});
  const messages = [];
  dom.window.acquireVsCodeApi = () => ({postMessage: m => messages.push(m)});
  dom.window.eval(script);
  const send = data => dom.window.dispatchEvent(new dom.window.MessageEvent('message',{data}));
  const parameters = [
    {name:'count',label:'<script>evil()</script>',type:'numeric',value:1.5},
    {name:'tags',label:'Tags',type:'select',multiple:true,value:['A'],choices:[{label:'A',value:'A'},{label:'B',value:'B'}]},
    {name:'password',label:'Password',type:'password',value:''},
    {name:'optional',label:'Optional',type:'text',value:null}
  ];
  send({type:'schema',file:'test.Rmd',parameters});
  return {dom,doc:dom.window.document,messages,send};
}
test('schema attaches visible accessible controls with resolved editable values',()=>{
  const {dom,doc,messages}=setup();
  assert.equal(messages[0].type,'ready');
  assert.equal(doc.querySelectorAll('#fields fieldset').length,4);
  assert.equal(doc.querySelectorAll('#fields script').length,0);
  assert.equal(doc.querySelector('input[type=number]').getAttribute('aria-label'),'<script>evil()</script>');
  assert.equal(doc.querySelector('input[type=number]').step,'any');
  assert.equal(doc.querySelector('input[type=number]').value,'1.5');
  assert.ok(doc.querySelector('option').selected);
  assert.ok(!doc.querySelector('input[type=number]').disabled);
  assert.equal(doc.querySelectorAll('.choice-toggle').length,0);
  assert.ok(!doc.querySelector('#fields').textContent.includes('Use NULL'));
  assert.ok(!doc.querySelector('input[name=optional]').disabled);
  assert.ok(!doc.querySelector('#fields').textContent.includes('Use document default'));
  dom.window.close();
});
test('submits every unchanged resolved value explicitly',()=>{
  const {dom,doc,messages}=setup();
  doc.querySelector('form').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));
  assert.deepEqual(JSON.parse(JSON.stringify(messages.at(-1))),{type:'knit',values:{
    count:{value:1.5}, tags:{value:['A']}, password:{value:''}, optional:{value:null}
  }});
  dom.window.close();
});
test('typed values, empty multiselect, password, and unchanged NULL submit value entries',()=>{
  const {dom,doc,messages}=setup();
  doc.querySelector('input[type=number]').value='2.75';
  for(const option of doc.querySelectorAll('option')) option.selected=false;
  doc.querySelector('input[type=password]').value='temporary';
  doc.querySelector('form').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));
  const values=messages.at(-1).values;
  assert.equal(values.count.value,2.75); assert.equal(values.tags.value.length,0);
  assert.equal(values.password.value,'temporary'); assert.equal(values.optional.value,null);
  dom.window.close();
});
test('NULL defaults stay editable and submit typed values after input or change',()=>{
  const {dom,doc,messages,send}=setup();
  const parameters=[
    {name:'text',type:'text',value:null},
    {name:'number',type:'numeric',value:null},
    {name:'flag',type:'checkbox',value:null},
    {name:'choice',type:'select',value:null,choices:[{label:'A',value:'A'}]},
    {name:'range',type:'slider',value:null,min:0,max:10},
    {name:'date',type:'date',value:null}
  ];
  send({type:'schema',parameters});
  const submit=()=>doc.querySelector('form').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));
  submit();
  for(const parameter of parameters) assert.equal(messages.at(-1).values[parameter.name].value,null);
  const edits={text:'hello',number:'2.5',flag:false,choice:'0',range:'7',date:'2026-09-23'};
  for(const [name,value] of Object.entries(edits)) {
    const control=doc.querySelector(`[name=${name}]`);
    assert.ok(!control.disabled);
    if(name==='flag') control.checked=value;
    else control.value=value;
    control.dispatchEvent(new dom.window.Event(name==='flag'||name==='choice'?'change':'input'));
  }
  submit();
  assert.deepEqual(JSON.parse(JSON.stringify(messages.at(-1).values)),{
    text:{value:'hello'},number:{value:2.5},flag:{value:false},choice:{value:'A'},range:{value:7},date:{value:'2026-09-23'}
  });
  const text=doc.querySelector('[name=text]');
  text.value='';
  text.dispatchEvent(new dom.window.Event('input'));
  submit();
  assert.equal(messages.at(-1).values.text.value,'');
  const number=doc.querySelector('[name=number]');
  number.value='';
  number.dispatchEvent(new dom.window.Event('input'));
  const before=messages.length;
  submit();
  assert.equal(messages.length,before);
  assert.equal(doc.querySelector('#status').textContent,'Enter a number for number.');
  send({type:'schema',parameters});
  submit();
  assert.equal(messages.at(-1).values.text.value,null);
  dom.window.close();
});
test('year sliders show endpoints, step ticks, and live formatted values',()=>{
  const {dom,doc,messages,send}=setup();
  send({type:'schema',parameters:[{name:'year',label:'Year',type:'slider',min:2010,max:2018,step:1,value:2017,sep:''}]});
  const input=doc.querySelector('input[type=range]');
  assert.equal(input.min,'2010');
  assert.equal(input.max,'2018');
  assert.equal(input.step,'1');
  assert.equal(input.getAttribute('aria-label'),'Year');
  assert.equal(doc.querySelector('.slider-min').textContent,'2010');
  assert.equal(doc.querySelector('.slider-max').textContent,'2018');
  assert.equal(doc.querySelector('.slider-value').textContent,'2017');
  assert.equal(doc.querySelector('output').getAttribute('for'),input.id);
  assert.deepEqual(Array.from(doc.querySelectorAll('.slider-tick'),tick=>Number(tick.dataset.value)),[2010,2011,2012,2013,2014,2015,2016,2017,2018]);
  assert.deepEqual(Array.from(doc.querySelectorAll('.slider-tick-label'),tick=>tick.textContent),['2012','2014','2016']);
  input.value='2014';
  input.dispatchEvent(new dom.window.Event('input'));
  assert.equal(doc.querySelector('.slider-value').textContent,'2014');
  assert.equal(input.getAttribute('aria-valuetext'),'2014');
  assert.equal(input.style.getPropertyValue('--slider-progress'),'50%');
  doc.querySelector('form').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));
  assert.equal(messages.at(-1).values.year.value,2014);
  send({type:'status',busy:true});
  assert.ok(input.disabled);
  send({type:'status',busy:false});
  assert.ok(!input.disabled);
  dom.window.close();
});
test('slider labels respect separators, prefixes, suffixes, and hidden ticks',()=>{
  const {dom,doc,messages,send}=setup();
  send({type:'schema',parameters:[{name:'cost',type:'slider',min:1000,max:2000,step:0.25,value:1250.5,ticks:false,pre:'<b>$',post:' USD'}]});
  assert.equal(doc.querySelectorAll('.slider-scale').length,0);
  assert.equal(doc.querySelector('.slider-value').textContent,'<b>$1,250.5 USD');
  assert.equal(doc.querySelector('.slider-min').textContent,'<b>$1,000 USD');
  assert.equal(doc.querySelectorAll('b').length,0);
  const input=doc.querySelector('input[type=range]');
  assert.equal(input.step,'0.25');
  input.value='1500.75';
  input.dispatchEvent(new dom.window.Event('change'));
  assert.equal(input.getAttribute('aria-valuetext'),'<b>$1,500.75 USD');
  doc.querySelector('form').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));
  assert.equal(messages.at(-1).values.cost.value,1500.75);
  send({type:'schema',parameters:[{name:'cost',type:'slider',min:1000,max:2000,value:1500,sep:' '}]});
  assert.equal(doc.querySelector('.slider-value').textContent,'1 500');
  dom.window.close();
});
test('slider scale handles decimal steps, huge ranges, and fixed bounds',()=>{
  const {dom,doc,send}=setup();
  send({type:'schema',parameters:[{name:'ratio',type:'slider',min:-0.3,max:0.3,step:0.1,value:0.1}]});
  assert.deepEqual(Array.from(doc.querySelectorAll('.slider-tick'),tick=>Number(tick.dataset.value)),[-0.3,-0.2,-0.1,0,0.1,0.2,0.3]);
  assert.equal(doc.querySelector('.slider-value').textContent,'0.1');
  send({type:'schema',parameters:[{name:'huge',type:'slider',min:0,max:1e9,step:0.001,value:500}]});
  assert.ok(doc.querySelectorAll('.slider-tick').length<=42);
  send({type:'schema',parameters:[{name:'fixed',type:'slider',min:3,max:3,value:3}]});
  assert.equal(doc.querySelectorAll('.slider-tick').length,0);
  assert.equal(doc.querySelector('.slider-value').textContent,'3');
  assert.ok(!doc.querySelector('output').style.left.includes('NaN'));
  send({type:'schema',parameters:[{name:'fraction',type:'slider',min:0,max:1,value:0.5}]});
  assert.equal(doc.querySelector('input[type=range]').step,'0.01');
  dom.window.close();
});
test('NULL slider values stay labelled NULL until edited and reset on refresh',()=>{
  const {dom,doc,messages,send}=setup();
  const schema={type:'schema',parameters:[{name:'optional',type:'slider',min:0,max:10,step:1,value:null}]};
  send(schema);
  assert.equal(doc.querySelector('.slider-value').textContent,'NULL');
  doc.querySelector('form').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));
  assert.equal(messages.at(-1).values.optional.value,null);
  const input=doc.querySelector('input[type=range]');
  input.value='4';
  input.dispatchEvent(new dom.window.Event('input'));
  assert.equal(doc.querySelector('.slider-value').textContent,'4');
  doc.querySelector('form').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));
  assert.equal(messages.at(-1).values.optional.value,4);
  send(schema);
  assert.equal(doc.querySelectorAll('.slider-value').length,1);
  assert.equal(doc.querySelector('.slider-value').textContent,'NULL');
  dom.window.close();
});
test('NULL file defaults allow browsing and preserve NULL on cancellation',()=>{
  const {dom,doc,messages,send}=setup();
  send({type:'schema',parameters:[{name:'data',type:'file',value:null}]});
  const browse=doc.querySelector('.control-wrap button');
  const submit=()=>doc.querySelector('form').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));
  assert.ok(!browse.disabled);
  browse.click();
  send({...messages.at(-1),type:'filePicked',value:null});
  submit();
  assert.equal(messages.at(-1).values.data.value,null);
  browse.click();
  send({...messages.at(-1),type:'filePicked',value:'chosen.csv'});
  submit();
  assert.equal(messages.at(-1).values.data.value,'chosen.csv');
  dom.window.close();
});
test('file browsing acknowledges requests, prevents duplicates, and applies only current selections',()=>{
  const {dom,doc,messages,send}=setup();
  const schema={type:'schema',parameters:[{name:'data',label:'Input dataset:',type:'file',value:'results.csv'}]};
  send(schema);
  let input=doc.querySelector('input[name=data]');
  let browse=doc.querySelector('.control-wrap button');
  assert.equal(input.type,'text');
  assert.equal(input.value,'results.csv');
  browse.click();
  const first=messages.at(-1);
  assert.deepEqual(JSON.parse(JSON.stringify(first)),{type:'pickFile',name:'data',requestId:first.requestId});
  assert.equal(doc.querySelector('#status').textContent,'Opening file picker…');
  assert.equal(browse.textContent,'Opening…');
  assert.ok(browse.disabled);
  browse.click();
  assert.equal(messages.filter(message=>message.type==='pickFile').length,1);
  send({...first,type:'filePickerOpened'});
  assert.equal(browse.textContent,'Selecting…');
  assert.ok(browse.disabled);
  send({...first,type:'filePicked',requestId:first.requestId+1,value:'wrong.csv'});
  assert.equal(input.value,'results.csv');
  send({...first,type:'filePicked',value:'datasets/my results.csv'});
  assert.equal(input.value,'datasets/my results.csv');
  assert.equal(browse.textContent,'Browse…');
  assert.ok(!browse.disabled);
  assert.equal(doc.querySelector('#status').textContent,'');
  doc.querySelector('form').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));
  assert.equal(messages.at(-1).values.data.value,'datasets/my results.csv');
  dom.window.close();
});
test('file browsing ignores cancellation, errors, and stale replies after manual edits',()=>{
  const {dom,doc,messages,send}=setup();
  const schema={type:'schema',parameters:[{name:'data',type:'file',value:'results.csv'}]};
  send(schema);
  const input=doc.querySelector('input[name=data]');
  const browse=doc.querySelector('.control-wrap button');
  browse.click();
  const cancelled=messages.at(-1);
  send({...cancelled,type:'filePickerOpened'});
  send({...cancelled,type:'filePicked',value:null});
  assert.equal(input.value,'results.csv');
  assert.equal(browse.textContent,'Browse…');
  assert.equal(doc.querySelector('#status').textContent,'');
  browse.click();
  const failed=messages.at(-1);
  send({...failed,type:'filePicked',error:'Picker unavailable'});
  assert.equal(input.value,'results.csv');
  assert.equal(browse.textContent,'Browse…');
  assert.equal(doc.querySelector('#status').textContent,'Picker unavailable');
  browse.click();
  const stale=messages.at(-1);
  input.value='typed.csv';
  input.dispatchEvent(new dom.window.Event('input'));
  assert.equal(browse.textContent,'Browse…');
  send({...stale,type:'filePicked',value:'stale.csv'});
  assert.equal(input.value,'typed.csv');
  send(schema);
  send({...stale,type:'filePicked',value:'also-stale.csv'});
  assert.equal(doc.querySelector('input[name=data]').value,'results.csv');
  assert.ok(!doc.querySelector('.control-wrap button').disabled);
  dom.window.close();
});
test('file picker acknowledgement timeout restores the control and reports recovery guidance',()=>{
  const {dom,doc,messages,send}=setup();
  let timeout;
  dom.window.setTimeout=(callback,delay)=>{
    assert.equal(delay,8000);
    timeout=callback;
    return 42;
  };
  send({type:'schema',parameters:[{name:'data',type:'file',value:'results.csv'}]});
  const input=doc.querySelector('input[name=data]');
  const browse=doc.querySelector('.control-wrap button');
  browse.click();
  const request=messages.at(-1);
  assert.equal(browse.textContent,'Opening…');
  timeout();
  assert.equal(browse.textContent,'Browse…');
  assert.ok(!browse.disabled);
  assert.equal(doc.querySelector('#status').textContent,'File picker did not respond. Reload the editor window and reopen Parameters, then try again.');
  send({...request,type:'filePickerOpened'});
  send({...request,type:'filePicked',value:'late.csv'});
  assert.equal(input.value,'results.csv');
  dom.window.close();
});
test('busy state locks controls but allows cancellation',()=>{
  const {dom,doc,messages,send}=setup();
  send({type:'status',text:'Rendering',busy:true});
  assert.ok(doc.querySelector('#knit').disabled);
  assert.ok(doc.querySelector('input[type=number]').disabled);
  assert.ok(doc.querySelector('input[name=optional]').disabled);
  assert.ok(!doc.querySelector('#cancel').disabled);
  doc.querySelector('#cancel').click(); assert.equal(messages.at(-1).type,'cancel');
  send({type:'error',text:'Failure'});
  assert.ok(!doc.querySelector('#knit').disabled);
  assert.equal(doc.querySelector('#status').textContent,'Failure');
  dom.window.close();
});
