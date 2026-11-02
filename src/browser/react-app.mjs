import React from 'react';
import { createRoot } from 'react-dom/client';

const host = document.querySelector('site-app');
const payload = JSON.parse(document.getElementById('page-data').textContent);

function PageShell() {
  return React.createElement('div', {
    className: 'framework-view',
    dangerouslySetInnerHTML: { __html: payload[0] },
  });
}

setTimeout(() => {
  createRoot(host).render(React.createElement(PageShell));
  requestAnimationFrame(() => requestAnimationFrame(() => {
    host.removeAttribute('aria-busy');
    document.documentElement.dataset.ready = 'true';
  }));
}, payload[1]);
