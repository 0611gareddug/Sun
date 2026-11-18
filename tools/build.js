/* 배포 빌드: src/ → 저장소 루트 (index.html + game.js)
   - 개발용 코드(DEV 마커 사이) 제거
   - 소스 보호 스크립트 삽입 (우클릭·F12·소스보기 단축키 차단)
   - javascript-obfuscator 난독화 (성능을 해치지 않는 수준의 옵션)
   원본은 src/ 에 그대로 보관됩니다. */
'use strict';
const fs = require('fs');
const path = require('path');
const JO = require('javascript-obfuscator');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');

const guard = `
(function(){
  var d=document,w=window;
  function stop(e){e.preventDefault();e.stopPropagation();return false;}
  d.addEventListener('contextmenu',stop,true);
  d.addEventListener('selectstart',function(e){var t=e.target;if(!(t&&t.closest&&t.closest('input,textarea')))stop(e);},true);
  d.addEventListener('dragstart',stop,true);
  d.addEventListener('copy',stop,true);
  w.addEventListener('keydown',function(e){
    var k=(e.key||'').toLowerCase(),c=e.ctrlKey||e.metaKey;
    if(e.keyCode===123||k==='f12')return stop(e);
    if(c&&e.shiftKey&&['i','j','c','k','e','m'].indexOf(k)>=0)return stop(e);
    if(c&&e.altKey&&['i','j','c','u'].indexOf(k)>=0)return stop(e);
    if(c&&['u','s','p'].indexOf(k)>=0)return stop(e);
  },true);
})();
`;

let js = guard + '\n' + read('core.js') + '\n' + read('levels.js') + '\n' + read('game.js');
js = js.replace(/\/\*DEV\*\/[\s\S]*?\/\*\/DEV\*\//g, '');
js = js.replace(/if \(typeof module !== 'undefined' && module\.exports\) module\.exports = [A-Za-z]+;/g, '');

const out = JO.obfuscate(js, {
  compact: true,
  target: 'browser',
  // 성능: 게임 루프를 느리게 만드는 옵션(제어 흐름 평탄화, 문자열 암호화, 자기방어, 디버거 트랩)은 끔
  controlFlowFlattening: false,
  deadCodeInjection: false,
  selfDefending: false,
  debugProtection: false,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,
  stringArray: true,
  stringArrayEncoding: [],
  stringArrayThreshold: 1,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayWrappersCount: 0,
  stringArrayIndexShift: false,
  // 속성/메서드 이름처럼 짧은 영문 식별자는 그대로 두어 JIT 최적화 유지 (한국어 문구·CSS 등만 숨김)
  reservedStrings: ['^[A-Za-z_$][\\w$]{0,24}$'],
  splitStrings: false,
  transformObjectKeys: false,
  numbersToExpressions: false,
  disableConsoleOutput: true,
  unicodeEscapeSequence: false,
  seed: 20261117,
}).getObfuscatedCode();

fs.writeFileSync(path.join(ROOT, 'game.js'), out);

let html = read('index.html');
html = html.replace(/<script src="core\.js"><\/script>\s*<script src="levels\.js"><\/script>\s*<script src="game\.js"><\/script>/,
  '<script src="game.js?v=' + Date.now().toString(36) + '"></script>');
html = html.replace(/\n\s*\n/g, '\n');
fs.writeFileSync(path.join(ROOT, 'index.html'), html);
fs.writeFileSync(path.join(ROOT, '.nojekyll'), '');
fs.mkdirSync(path.join(ROOT, 'fonts'), { recursive: true });
for (const f of fs.readdirSync(path.join(SRC, 'fonts'))) fs.copyFileSync(path.join(SRC, 'fonts', f), path.join(ROOT, 'fonts', f));
console.log('빌드 완료: index.html, game.js (' + (out.length / 1024).toFixed(1) + ' KB)');
