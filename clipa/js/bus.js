// Barramento de eventos global, simples e sem dependências.

const target = new EventTarget();

export function emit(name, detail) {
  target.dispatchEvent(new CustomEvent(name, { detail }));
}

export function on(name, fn) {
  const handler = (e) => fn(e.detail);
  target.addEventListener(name, handler);
  return () => target.removeEventListener(name, handler);
}
