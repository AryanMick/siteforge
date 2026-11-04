import '@angular/compiler';
import 'zone.js';
import { Component } from '@angular/core';
import { bootstrapApplication, DomSanitizer } from '@angular/platform-browser';

const payload = JSON.parse(document.getElementById('page-data').textContent);

class PageShell {
  constructor(sanitizer) {
    this.content = sanitizer.bypassSecurityTrustHtml(payload[0]);
  }
}

PageShell.ctorParameters = () => [{ type: DomSanitizer }];
Component({
  selector: 'site-app',
  standalone: true,
  template: '<div class="framework-view" [innerHTML]="content"></div>',
})(PageShell);

setTimeout(async () => {
  await bootstrapApplication(PageShell);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    document.querySelector('site-app').removeAttribute('aria-busy');
    document.documentElement.dataset.ready = 'true';
  }));
}, payload[1]);
