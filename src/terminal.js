// 画面下のターミナル風パネル。コマンドを受け取って onCommand に渡し、結果を出力する。
const SPIN = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢'];

export class Terminal {
  constructor({ out, form, input, chips, onCommand }) {
    this.out = out;
    this.input = input;
    this.onCommand = onCommand;
    this.history = [];
    this.hIndex = -1;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = input.value.trim();
      input.value = '';
      if (v) this.run(v);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        if (!this.history.length) return;
        e.preventDefault();
        const dir = e.key === 'ArrowUp' ? 1 : -1;
        this.hIndex = Math.max(-1, Math.min(this.history.length - 1, this.hIndex + dir));
        input.value = this.hIndex < 0 ? '' : this.history[this.history.length - 1 - this.hIndex];
      }
    });
    chips.forEach((b) => b.addEventListener('click', () => this.run(b.dataset.cmd)));
  }

  run(cmd) {
    this.history.push(cmd);
    this.hIndex = -1;
    this.line(cmd, 'cmd');
    this.onCommand(cmd);
  }

  line(content, cls = '') {
    const el = document.createElement('div');
    el.className = 'ln ' + cls;
    if (content instanceof Node) el.append(content);
    else el.textContent = content;
    this.out.append(el);
    while (this.out.children.length > 80) this.out.firstChild.remove();
    this.out.scrollTop = this.out.scrollHeight;
    return el;
  }

  clear() {
    this.out.textContent = '';
  }

  spinner(verbs) {
    const el = this.line('', 'spin');
    let i = 0;
    const t0 = performance.now();
    const draw = () => {
      const v = verbs[Math.floor((performance.now() - t0) / 900) % verbs.length];
      el.textContent = `${SPIN[i++ % SPIN.length]} ${v}…`;
    };
    draw();
    const id = setInterval(draw, 110);
    return {
      stop() {
        clearInterval(id);
        el.remove();
      },
    };
  }
}
