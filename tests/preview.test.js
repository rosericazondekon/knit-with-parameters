const {test} = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
function load(positron=true) {
  const calls=[];
  const modulePath=require.resolve('../out/preview');
  delete require.cache[modulePath];
  const original=Module._load;
  Module._load=function(name,parent,isMain){
    if(name==='vscode') return {Uri:{file:f=>f},env:{openExternal:async f=>{calls.push(['external',f]);return true;}},commands:{executeCommand:async(...args)=>calls.push(args)}};
    if(name==='@posit-dev/positron') return {tryAcquirePositronApi:()=>positron ? {window:{previewHtml:f=>calls.push(['html',f])}} : undefined};
    return original.call(this,name,parent,isMain);
  };
  try{return {api:require(modulePath),calls};}finally{Module._load=original;}
}
test('Quarto output paths handle colors, custom directories, quotes, spaces and duplicates',()=>{
  const {api}=load();
  const log='other output\n\x1b[32mOutput created: _site/custom report.html\x1b[0m\r\nOutput created: "other.pdf"\nOutput created: other.pdf\n';
  assert.deepEqual(api.quartoOutputPaths(log,'/project'),[path.resolve('/project/_site/custom report.html'),path.resolve('/project/other.pdf')]);
  assert.deepEqual(api.quartoOutputPaths('render failed','/project'),[]);
});
test('HTML previews the existing artifact in Positron without rendering again',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'preview-test-'));
  try{
    const file=path.join(dir,'report.html');await fs.writeFile(file,'<p>17</p>');
    const {api,calls}=load();await api.previewOutput(file);
    assert.deepEqual(calls,[['html',file]]);
    const fallback=load(false);await fallback.api.previewOutput(file);
    assert.deepEqual(fallback.calls,[['external',file]]);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('Markdown and other outputs use appropriate installed viewers; missing files never preview',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'preview-test-'));
  try{
    const {api,calls}=load();
    for(const ext of ['md','pdf']){const file=path.join(dir,`report.${ext}`);await fs.writeFile(file,'test');await api.previewOutput(file);}
    assert.equal(calls[0][0],'markdown.showPreview');assert.equal(calls[1][0],'vscode.open');
    await assert.rejects(api.previewOutput(path.join(dir,'missing.html')));assert.equal(calls.length,2);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
