// 原型入口：先裝好模擬 API，再啟動正式版前端（同一份程式碼）
import './mock.js';
import '../public/js/app.js';

const tag = document.createElement('span');
tag.className = 'proto-tag';
tag.textContent = '示範版';
document.querySelector('.top-right').prepend(tag);
