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
    {name:'password',label:'Password',type:'password',value:''}
  ];
  send({type:'schema',file:'test.Rmd',parameters});
  return {dom,doc:dom.window.document,messages,send};
}
test('schema attaches visible accessible controls with escaped labels',()=>{
  const {dom,doc,messages}=setup();
  assert.equal(messages[0].type,'ready');
  assert.equal(doc.querySelectorAll('#fields fieldset').length,3);
  assert.equal(doc.querySelectorAll('#fields script').length,0);
  assert.equal(doc.querySelector('input[type=number]').getAttribute('aria-label'),'<script>evil()</script>');
  assert.equal(doc.querySelector('input[type=number]').step,'any');
  dom.window.close();
});
test('typed overrides, empty multiselect, and password messages',()=>{
  const {dom,doc,messages}=setup();
  const rows=doc.querySelectorAll('fieldset');
  for(const row of rows) {
    const toggle=row.querySelector('.choice-toggle input'); toggle.checked=false;
    toggle.dispatchEvent(new dom.window.Event('change'));
  }
  doc.querySelector('input[type=number]').value='2.75';
  for(const option of doc.querySelectorAll('option')) option.selected=false;
  doc.querySelector('input[type=password]').value='temporary';
  doc.querySelector('form').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));
  const values=messages.at(-1).values;
  assert.equal(values.count.value,2.75); assert.equal(values.tags.value.length,0);
  assert.equal(values.password.value,'temporary');
  dom.window.close();
});
test('busy state locks default toggles but allows cancellation',()=>{
  const {dom,doc,messages,send}=setup();
  send({type:'status',text:'Rendering',busy:true});
  assert.ok(doc.querySelector('#knit').disabled);
  assert.ok(doc.querySelector('.choice-toggle input').disabled);
  assert.ok(!doc.querySelector('#cancel').disabled);
  doc.querySelector('#cancel').click(); assert.equal(messages.at(-1).type,'cancel');
  send({type:'error',text:'Failure'});
  assert.ok(!doc.querySelector('#knit').disabled);
  assert.equal(doc.querySelector('#status').textContent,'Failure');
  dom.window.close();
});
