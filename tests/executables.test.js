const {test} = require('node:test');
const assert = require('node:assert/strict');
const {resolveExecutable} = require('../out/executables');
function options(files, extra = {}) {
  return {platform:'darwin', env:{PATH:'/custom/bin'},home:'/Users/test',appRoot:'/Applications/Positron.app/Contents/Resources/app',executable:async file=>files.includes(file),directories:async()=>[],...extra};
}
test('PATH wins over bundled Quarto and standard R installations', async()=>{
  assert.equal(await resolveExecutable('quarto','',options(['/custom/bin/quarto','/Applications/Positron.app/Contents/Resources/app/quarto/bin/quarto'])),'/custom/bin/quarto');
  assert.equal(await resolveExecutable('Rscript','',options(['/custom/bin/Rscript','/Library/Frameworks/R.framework/Resources/bin/Rscript'])),'/custom/bin/Rscript');
});
test('find bundled Quarto even with legacy default setting and empty PATH',async()=>{
  const bundled='/Applications/Positron.app/Contents/Resources/app/quarto/bin/quarto';
  assert.equal(await resolveExecutable('quarto','quarto',options([bundled],{env:{PATH:''}})),bundled);
});
test('macOS R framework and Homebrew discovery',async()=>{
  const framework='/Library/Frameworks/R.framework/Resources/bin/Rscript';
  assert.equal(await resolveExecutable('Rscript','Rscript',options([framework])),framework);
  assert.equal(await resolveExecutable('Rscript','',options(['/opt/homebrew/bin/Rscript'])),'/opt/homebrew/bin/Rscript');
});
test('explicit paths override discovery; expand home and preserve spaces',async()=>{
  const file='/Users/test/my R/bin/Rscript';
  assert.equal(await resolveExecutable('Rscript','~/my R/bin/Rscript',options([file,'/custom/bin/Rscript'])),file);
  await assert.rejects(resolveExecutable('Rscript','/invalid/Rscript',options(['/custom/bin/Rscript'])),/Configured Rscript/);
});
test('explicit command names resolve through PATH without executing shell',async()=>{
  assert.equal(await resolveExecutable('Rscript','my-r',options(['/custom/bin/my-r'])),'/custom/bin/my-r');
  await assert.rejects(resolveExecutable('Rscript','Rscript --vanilla',options(['/custom/bin/Rscript'])),/Configured/);
});
test('Windows handles Path casing, bundled executable and versioned R',async()=>{
  const base={platform:'win32',env:{Path:'C:\\tools;.;relative',ProgramFiles:'C:\\Program Files'},home:'C:\\Users\\test',appRoot:'C:\\Positron\\resources\\app'};
  const r='C:\\Program Files\\R\\R-4.10.0\\bin\\Rscript.exe';
  assert.equal(await resolveExecutable('Rscript','',options([r],{...base,directories:async()=>['R-4.9.0','R-4.10.0']})),r);
  const q='C:\\Positron\\resources\\app\\quarto\\bin\\quarto.exe';
  assert.equal(await resolveExecutable('quarto','',options([q],base)),q);
  assert.equal(await resolveExecutable('quarto','',options(['C:\\tools\\quarto.exe'],base)),'C:\\tools\\quarto.exe');
});
test('Linux /opt R discovery and host-relative Quarto bundle',async()=>{
  const base={platform:'linux',env:{PATH:''},appRoot:'/remote/server',directories:async()=>['4.2.2','4.10.0']};
  assert.equal(await resolveExecutable('Rscript','',options(['/opt/R/4.10.0/bin/Rscript'],base)),'/opt/R/4.10.0/bin/Rscript');
  assert.equal(await resolveExecutable('quarto','',options(['/remote/server/quarto/bin/quarto'],base)),'/remote/server/quarto/bin/quarto');
});
test('missing tools give actionable messages and exclude relative PATH entries',async()=>{
  const seen=[];
  await assert.rejects(resolveExecutable('quarto','',options([],{env:{PATH:':.:relative:/safe'},executable:async file=>{seen.push(file);return false;}})),/Could not locate quarto/);
  assert.ok(seen.every(file=>file.startsWith('/')));
});
