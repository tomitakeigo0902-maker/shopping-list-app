/**
 * desktop.js - PC（Electronウィジェット）で開いたときだけ動く部分
 *
 * ブラウザやスマホでは window.desktopAPI が存在しないため、何もしない。
 * PCではウィンドウに枠が無いので、代わりの操作バー（移動・最前面固定・最小化）を出す。
 */
'use strict';

(function () {
  const api = window.desktopAPI;
  if (!api) return; // スマホ・ブラウザでは何もしない

  document.documentElement.classList.add('is-desktop');

  const bar = document.createElement('div');
  bar.className = 'desk-bar';
  bar.innerHTML = `
    <span class="desk-title">やること &amp; 買い物</span>
    <div class="desk-btns">
      <button class="desk-btn" id="deskPin" title="最前面の固定を切替">📌</button>
      <button class="desk-btn" id="deskDock" title="定位置に戻す（左下）">⇥</button>
      <button class="desk-btn" id="deskMin" title="最小化">—</button>
    </div>`;
  document.body.insertBefore(bar, document.body.firstChild);

  const pinBtn = bar.querySelector('#deskPin');
  const reflectPin = (on) => {
    pinBtn.classList.toggle('off', !on);
    pinBtn.title = on ? '最前面に固定中（クリックで解除）' : '固定なし（クリックで最前面に固定）';
  };

  pinBtn.onclick = async () => reflectPin(await api.toggleTop());
  bar.querySelector('#deskDock').onclick = () => api.dock();
  bar.querySelector('#deskMin').onclick = () => api.minimize();

  api.getTop().then(reflectPin);
  if (api.onTopChanged) api.onTopChanged(reflectPin);
})();
