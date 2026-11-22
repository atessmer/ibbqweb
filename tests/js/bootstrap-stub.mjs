export class Toast {
  constructor(element) { this.element = element; Toast.instances.push(this); }
  show() { this.shown = true; }
}
Toast.instances = [];
export class Modal {
  constructor(element) { this.element = element; Modal.instances.push(this); }
  show() { this.shown = true; }
}
Modal.instances = [];
